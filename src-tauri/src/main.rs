#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::thread;
use tauri::State;

// Commands sent to the audio thread
enum AudioCommand {
    Load(String),
    Play,
    Pause,
    Resume,
    Stop,
    SetVolume(f32),
    Seek(f64),
}

// Thread-safe state that only holds Send types
struct AppState {
    audio_tx: Mutex<Option<Sender<AudioCommand>>>,
    current_file: Mutex<Option<String>>,
    duration_secs: Mutex<f64>,
    is_playing: Mutex<bool>,
    volume: Mutex<f32>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            audio_tx: Mutex::new(None),
            current_file: Mutex::new(None),
            duration_secs: Mutex::new(0.0),
            is_playing: Mutex::new(false),
            volume: Mutex::new(0.75),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct TrackInfo {
    path: String,
    filename: String,
    duration_secs: f64,
}

// Audio thread function - runs in its own thread, owns the non-Send types
fn audio_thread(rx: mpsc::Receiver<AudioCommand>, volume: Arc<Mutex<f32>>) {
    use rodio::{Decoder, OutputStream, Sink};
    use std::fs::File;
    use std::io::BufReader;
    use std::time::Duration;

    let (_stream, stream_handle) = match OutputStream::try_default() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Failed to create audio stream: {}", e);
            return;
        }
    };

    let mut sink: Option<Sink> = None;
    let mut current_path: Option<String> = None;

    while let Ok(cmd) = rx.recv() {
        match cmd {
            AudioCommand::Load(path) => {
                current_path = Some(path);
            }
            AudioCommand::Play => {
                if let Some(ref path) = current_path {
                    // Stop existing playback
                    if let Some(s) = sink.take() {
                        s.stop();
                    }

                    // Create new sink and play
                    match File::open(path) {
                        Ok(file) => {
                            match Decoder::new(BufReader::new(file)) {
                                Ok(source) => {
                                    match Sink::try_new(&stream_handle) {
                                        Ok(new_sink) => {
                                            new_sink.set_volume(*volume.lock());
                                            new_sink.append(source);
                                            sink = Some(new_sink);
                                        }
                                        Err(e) => eprintln!("Failed to create sink: {}", e),
                                    }
                                }
                                Err(e) => eprintln!("Failed to decode: {}", e),
                            }
                        }
                        Err(e) => eprintln!("Failed to open file: {}", e),
                    }
                }
            }
            AudioCommand::Pause => {
                if let Some(ref s) = sink {
                    s.pause();
                }
            }
            AudioCommand::Resume => {
                if let Some(ref s) = sink {
                    s.play();
                }
            }
            AudioCommand::Stop => {
                if let Some(s) = sink.take() {
                    s.stop();
                }
            }
            AudioCommand::SetVolume(vol) => {
                *volume.lock() = vol;
                if let Some(ref s) = sink {
                    s.set_volume(vol);
                }
            }
            AudioCommand::Seek(position_secs) => {
                if let Some(ref s) = sink {
                    let _ = s.try_seek(Duration::from_secs_f64(position_secs));
                }
            }
        }
    }
}

fn ensure_audio_thread(state: &AppState) {
    let mut tx_guard = state.audio_tx.lock();
    if tx_guard.is_none() {
        let (tx, rx) = mpsc::channel();
        let volume = Arc::new(Mutex::new(*state.volume.lock()));
        let volume_clone = Arc::clone(&volume);
        
        thread::spawn(move || {
            audio_thread(rx, volume_clone);
        });
        
        *tx_guard = Some(tx);
    }
}

#[tauri::command]
fn load_track(path: String, state: State<AppState>) -> Result<TrackInfo, String> {
    ensure_audio_thread(&state);
    
    // Get duration
    let duration = mp3_duration::from_path(&path)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);

    // Extract filename
    let filename = std::path::Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    // Store current file info
    *state.current_file.lock() = Some(path.clone());
    *state.duration_secs.lock() = duration;

    // Send load command to audio thread
    if let Some(ref tx) = *state.audio_tx.lock() {
        let _ = tx.send(AudioCommand::Load(path.clone()));
    }

    Ok(TrackInfo {
        path,
        filename,
        duration_secs: duration,
    })
}

#[tauri::command]
fn get_track_metadata(path: String) -> TrackInfo {
    // Get duration
    let duration = mp3_duration::from_path(&path)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);

    // Extract filename
    let filename = std::path::Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    TrackInfo {
        path,
        filename,
        duration_secs: duration,
    }
}

#[tauri::command]
fn get_cover_path(audio_path: String) -> Option<String> {
    let path = std::path::Path::new(&audio_path);
    let parent = path.parent()?;
    let stem = path.file_stem()?.to_str()?;

    // Check for common image extensions
    let extensions = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];
    for ext in extensions {
        let cover_path = parent.join(format!("{}.{}", stem, ext));
        if cover_path.exists() {
            return Some(cover_path.to_string_lossy().to_string());
        }
    }
    None
}

#[tauri::command]
fn play(state: State<AppState>) -> Result<(), String> {
    ensure_audio_thread(&state);
    
    if let Some(ref tx) = *state.audio_tx.lock() {
        tx.send(AudioCommand::Play).map_err(|e| e.to_string())?;
        *state.is_playing.lock() = true;
    }
    Ok(())
}

#[tauri::command]
fn pause(state: State<AppState>) {
    if let Some(ref tx) = *state.audio_tx.lock() {
        let _ = tx.send(AudioCommand::Pause);
        *state.is_playing.lock() = false;
    }
}

#[tauri::command]
fn resume(state: State<AppState>) {
    if let Some(ref tx) = *state.audio_tx.lock() {
        let _ = tx.send(AudioCommand::Resume);
        *state.is_playing.lock() = true;
    }
}

#[tauri::command]
fn stop(state: State<AppState>) {
    if let Some(ref tx) = *state.audio_tx.lock() {
        let _ = tx.send(AudioCommand::Stop);
        *state.is_playing.lock() = false;
    }
}

#[tauri::command]
fn set_volume(volume: f32, state: State<AppState>) {
    let vol = volume.clamp(0.0, 1.0);
    *state.volume.lock() = vol;
    
    if let Some(ref tx) = *state.audio_tx.lock() {
        let _ = tx.send(AudioCommand::SetVolume(vol));
    }
}

#[tauri::command]
fn seek(position_secs: f64, state: State<AppState>) -> Result<(), String> {
    if let Some(ref tx) = *state.audio_tx.lock() {
        tx.send(AudioCommand::Seek(position_secs)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_position(_state: State<AppState>) -> f64 {
    0.0
}

#[tauri::command]
fn is_playing(state: State<AppState>) -> bool {
    *state.is_playing.lock()
}

fn main() {
    let app_state = AppState::default();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            load_track,
            get_track_metadata,
            play,
            pause,
            resume,
            stop,
            set_volume,
            seek,
            get_position,
            is_playing,
            get_cover_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
