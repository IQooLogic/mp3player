// Music Player - Main JavaScript
const { invoke, convertFileSrc } = window.__TAURI__.core;
const { open } = window.__TAURI__.dialog;
const { getCurrentWindow, LogicalSize, LogicalPosition } = window.__TAURI__.window;

// State
let currentTrack = null;
let playlist = [];
let currentIndex = -1;
let isPlaying = false;
let isPaused = false;
let shuffle = false;
let repeat = false;
let duration = 0;
let elapsed = 0;
let timeInterval = null;

// DOM Elements
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');
const trackTitle = document.getElementById('track-title');
const trackArtist = document.getElementById('track-artist');
const plTrackTitle = document.getElementById('pl-track-title');
const plTrackArtist = document.getElementById('pl-track-artist');
const progressRing = document.getElementById('progress-ring');
const progressKnob = document.getElementById('progress-knob');
const volumeSlider = document.getElementById('volume-slider');
const playlistItems = document.getElementById('playlist-items');
const visualizer = document.getElementById('visualizer');
const vizCtx = visualizer.getContext('2d');
const albumArt = document.getElementById('album-art');
const playerBgCover = document.getElementById('player-bg-cover');
const playerPanel = document.querySelector('.player-panel');
const btnCoverMode = document.getElementById('btn-cover-mode');
let coverBgMode = localStorage.getItem('winamp-cover-bg-mode') === 'true';
let currentCoverUrl = null;

// Buttons
const btnPlay = document.getElementById('btn-play');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const btnShuffle = document.getElementById('btn-shuffle');
const btnRepeat = document.getElementById('btn-repeat');
const btnEject = document.getElementById('btn-eject');
const btnFavorite = document.getElementById('btn-favorite');
const btnClose = document.getElementById('btn-close');
const btnMinimize = document.getElementById('btn-minimize');
const btnPlAdd = document.getElementById('btn-pl-add');
const btnPlClear = document.getElementById('btn-pl-clear');
const btnPlaylistToggle = document.getElementById('btn-playlist-toggle');
const playlistPanel = document.querySelector('.playlist-panel');

// Constants for circular progress
const CIRCUMFERENCE = 2 * Math.PI * 90; // radius = 90

// Playlist persistence
function savePlaylist() {
    localStorage.setItem('winamp-playlist', JSON.stringify(playlist));
    localStorage.setItem('winamp-currentIndex', currentIndex.toString());
}

function loadPlaylist() {
    try {
        const saved = localStorage.getItem('winamp-playlist');
        const savedIndex = localStorage.getItem('winamp-currentIndex');
        if (saved) {
            playlist = JSON.parse(saved);
            currentIndex = savedIndex ? parseInt(savedIndex, 10) : -1;
            renderPlaylist();
        }
    } catch (e) {
        console.error('Failed to load playlist:', e);
    }
}

// Window position persistence
async function saveWindowPosition() {
    try {
        const appWindow = getCurrentWindow();
        const position = await appWindow.outerPosition();
        localStorage.setItem('winamp-window-x', position.x.toString());
        localStorage.setItem('winamp-window-y', position.y.toString());
    } catch (e) {
        console.error('Failed to save window position:', e);
    }
}

async function restoreWindowPosition() {
    try {
        const x = localStorage.getItem('winamp-window-x');
        const y = localStorage.getItem('winamp-window-y');
        if (x !== null && y !== null) {
            const appWindow = getCurrentWindow();
            await appWindow.setPosition(new LogicalPosition(parseInt(x, 10), parseInt(y, 10)));
        }
    } catch (e) {
        console.error('Failed to restore window position:', e);
    }
}

// Format time as M:SS
function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Update progress ring
function updateProgressRing(percent) {
    const offset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE;
    progressRing.style.strokeDashoffset = offset;

    // Update knob position
    const angle = (percent / 100) * 360 - 90; // Start from top
    const radians = (angle * Math.PI) / 180;
    const radius = 90;
    const centerX = 100;
    const centerY = 100;
    const knobX = centerX + radius * Math.cos(radians);
    const knobY = centerY + radius * Math.sin(radians);

    // Convert from viewBox coordinates (0-200) to percentage (0-100%)
    progressKnob.style.left = `${knobX / 2}%`;
    progressKnob.style.top = `${knobY / 2}%`;
    progressKnob.style.transform = 'translate(-50%, -50%)';
}

// Update time display
function updateTimeDisplay() {
    timeCurrent.textContent = formatTime(elapsed);
    timeTotal.textContent = formatTime(duration);

    if (duration > 0) {
        const percent = (elapsed / duration) * 100;
        updateProgressRing(percent);
    }
}

// Start time tracking
function startTimeTracking() {
    stopTimeTracking();
    timeInterval = setInterval(() => {
        if (isPlaying && !isPaused) {
            elapsed += 0.1;
            if (duration > 0 && elapsed >= duration) {
                handleTrackEnd();
            } else {
                updateTimeDisplay();
            }
        }
    }, 100);
}

// Stop time tracking
function stopTimeTracking() {
    if (timeInterval) {
        clearInterval(timeInterval);
        timeInterval = null;
    }
}

// Handle track end
async function handleTrackEnd() {
    if (repeat) {
        elapsed = 0;
        await invoke('play');
    } else if (currentIndex < playlist.length - 1 || shuffle) {
        await playNext();
    } else {
        await stop();
    }
}

// Extract artist from filename (basic heuristic)
function extractArtist(filename) {
    // Try to extract "Artist - Title" format
    const match = filename.match(/^(.+?)\s*[-–]\s*(.+)$/);
    if (match) {
        return { artist: match[1].trim(), title: match[2].replace(/\.[^/.]+$/, '').trim() };
    }
    return { artist: 'Unknown Artist', title: filename.replace(/\.[^/.]+$/, '') };
}

// Load a track
const defaultAlbumArt = `
    <svg class="default-art" viewBox="0 0 100 100">
        <rect width="100" height="100" fill="#1e1b4b"/>
        <circle cx="50" cy="50" r="30" fill="none" stroke="#4c1d95" stroke-width="2"/>
        <circle cx="50" cy="50" r="10" fill="#7c3aed"/>
    </svg>`;

function updateCoverDisplay() {
    if (currentCoverUrl) {
        playerBgCover.style.backgroundImage = `url("${currentCoverUrl}")`;
        if (coverBgMode) {
            albumArt.innerHTML = '';
        } else {
            albumArt.innerHTML = `<img src="${currentCoverUrl}" alt="Album Art">`;
        }
    } else {
        playerBgCover.style.backgroundImage = '';
        albumArt.innerHTML = defaultAlbumArt;
    }
    playerPanel.classList.toggle('cover-bg-mode', coverBgMode && currentCoverUrl);
    btnCoverMode.classList.toggle('active', coverBgMode);
}

async function loadTrack(path) {
    try {
        const info = await invoke('load_track', { path });
        currentTrack = info;
        duration = info.duration_secs;
        elapsed = 0;

        // Parse artist and title
        const { artist, title } = extractArtist(info.filename);

        // Update display
        trackTitle.textContent = title;
        trackArtist.textContent = artist;
        plTrackTitle.textContent = title;
        plTrackArtist.textContent = artist;

        // Load cover image
        const coverPath = await invoke('get_cover_path', { audioPath: path });
        if (coverPath) {
            currentCoverUrl = convertFileSrc(coverPath);
        } else {
            currentCoverUrl = null;
        }
        updateCoverDisplay();

        updateTimeDisplay();
        updateProgressRing(0);

        return true;
    } catch (err) {
        console.error('Failed to load track:', err);
        trackTitle.textContent = 'Error loading track';
        trackArtist.textContent = '';
        currentCoverUrl = null;
        updateCoverDisplay();
        return false;
    }
}

// Play current track
async function play() {
    if (!currentTrack && playlist.length > 0) {
        currentIndex = 0;
        await loadTrack(playlist[0].path);
    }

    if (!currentTrack) {
        await openFile();
        return;
    }

    try {
        await invoke('play');
        isPlaying = true;
        isPaused = false;
        updatePlayButton();
        startTimeTracking();
        startVisualizer();
        updatePlaylistHighlight();
    } catch (err) {
        console.error('Failed to play:', err);
    }
}

// Pause/Resume
async function togglePause() {
    if (!isPlaying) {
        await play();
        return;
    }

    try {
        if (isPaused) {
            await invoke('resume');
            isPaused = false;
        } else {
            await invoke('pause');
            isPaused = true;
        }
        updatePlayButton();
    } catch (err) {
        console.error('Failed to toggle pause:', err);
    }
}

// Stop playback
async function stop() {
    try {
        await invoke('stop');
        isPlaying = false;
        isPaused = false;
        elapsed = 0;
        updateTimeDisplay();
        updateProgressRing(0);
        updatePlayButton();
        stopTimeTracking();
    } catch (err) {
        console.error('Failed to stop:', err);
    }
}

// Update play button icon
function updatePlayButton() {
    const playIcon = btnPlay.querySelector('.play-icon');
    const pauseIcon = btnPlay.querySelector('.pause-icon');

    if (isPlaying && !isPaused) {
        playIcon.classList.add('hidden');
        pauseIcon.classList.remove('hidden');
    } else {
        playIcon.classList.remove('hidden');
        pauseIcon.classList.add('hidden');
    }
}

// Play next track
async function playNext() {
    if (playlist.length === 0) return;

    if (shuffle) {
        currentIndex = Math.floor(Math.random() * playlist.length);
    } else {
        currentIndex = (currentIndex + 1) % playlist.length;
    }

    await loadTrack(playlist[currentIndex].path);
    await play();
}

// Play previous track
async function playPrev() {
    if (playlist.length === 0) return;

    if (elapsed > 3) {
        elapsed = 0;
        await invoke('seek', { positionSecs: 0 });
        updateTimeDisplay();
        return;
    }

    currentIndex = (currentIndex - 1 + playlist.length) % playlist.length;
    await loadTrack(playlist[currentIndex].path);
    await play();
}

// Open file dialog
async function openFile() {
    try {
        const selected = await open({
            multiple: true,
            filters: [{
                name: 'Audio Files',
                extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a']
            }]
        });

        if (selected) {
            const files = Array.isArray(selected) ? selected : [selected];
            for (const path of files) {
                addToPlaylist(path);
            }

            if (playlist.length > 0 && currentIndex === -1) {
                currentIndex = 0;
                await loadTrack(playlist[0].path);
                await play();
            }
        }
    } catch (err) {
        console.error('Failed to open file:', err);
    }
}

// Add to playlist
async function addToPlaylist(path) {
    const filename = path.split(/[/\\]/).pop();
    const { artist, title } = extractArtist(filename);

    // Add with null duration initially
    const trackInfo = { path, filename, artist, title, duration: null };
    playlist.push(trackInfo);

    // Get the index of the newly added track
    const trackIndex = playlist.length - 1;

    // Initial render
    renderPlaylist();
    savePlaylist();

    // Fetch metadata asynchronously
    try {
        const metadata = await invoke('get_track_metadata', { path });
        if (metadata && playlist[trackIndex] && playlist[trackIndex].path === path) {
            playlist[trackIndex].duration = metadata.duration_secs;
            // Update UI for this track
            renderPlaylist();
            savePlaylist();
        }
    } catch (err) {
        console.error('Failed to get track metadata:', err);
    }
}

// Render playlist
function renderPlaylist() {
    if (playlist.length === 0) {
        playlistItems.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 18V5l12-2v13"/>
                    <circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                </svg>
                <p>No tracks in playlist</p>
                <p style="font-size: 12px; margin-top: 5px;">Click "Add Files" to get started</p>
            </div>
        `;
        return;
    }

    playlistItems.innerHTML = '';
    playlist.forEach((track, index) => {
        const li = document.createElement('li');
        li.className = index === currentIndex ? 'active' : '';
        li.innerHTML = `
            <div class="track-icon">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    ${index === currentIndex && isPlaying && !isPaused
                ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'
                : '<path d="M8 5v14l11-7z"/>'}
                </svg>
            </div>
            <div class="track-details">
                <div class="track-name">${track.title}</div>
                <div class="track-artist-name">${track.artist}</div>
            </div>
            <div class="track-duration">${track.duration ? formatTime(track.duration) : '--:--'}</div>
        `;
        li.addEventListener('dblclick', async () => {
            currentIndex = index;
            await loadTrack(track.path);
            await play();
        });
        playlistItems.appendChild(li);
    });
}

// Update playlist highlight
function updatePlaylistHighlight() {
    const items = playlistItems.querySelectorAll('li');
    items.forEach((li, index) => {
        li.className = index === currentIndex ? 'active' : '';
        const icon = li.querySelector('.track-icon svg');
        if (icon) {
            icon.innerHTML = index === currentIndex && isPlaying && !isPaused
                ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'
                : '<path d="M8 5v14l11-7z"/>';
        }
    });
    savePlaylist();
}

// Clear playlist
function clearPlaylist() {
    playlist = [];
    currentIndex = -1;
    currentTrack = null;
    stop();
    trackTitle.textContent = 'No Track Loaded';
    trackArtist.textContent = 'Select a file to play';
    plTrackTitle.textContent = 'Hello';
    plTrackArtist.textContent = 'Adele';
    renderPlaylist();
    savePlaylist();
}

// Set volume
async function setVolume(value) {
    try {
        await invoke('set_volume', { volume: value / 100 });
    } catch (err) {
        console.error('Failed to set volume:', err);
    }
}

// Waveform visualizer
let vizAnimationId = null;
const wavePoints = [];
const numPoints = 100;

// Initialize wave points
for (let i = 0; i < numPoints; i++) {
    wavePoints.push({
        x: i,
        y: 0,
        targetY: 0,
        velocity: 0
    });
}

function startVisualizer() {
    if (vizAnimationId) return;

    function animate() {
        const width = visualizer.width;
        const height = visualizer.height;
        const centerY = height / 2;

        // Clear canvas
        // vizCtx.fillStyle = 'rgba(15, 13, 26, 0.3)';
        vizCtx.clearRect(0, 0, width, height);
        // vizCtx.fillRect(0, 0, width, height);

        // Update wave points
        for (let i = 0; i < numPoints; i++) {
            const point = wavePoints[i];

            if (isPlaying && !isPaused) {
                // Generate new target based on "audio"
                point.targetY = (Math.random() - 0.5) * 40 * Math.sin(i * 0.1 + Date.now() * 0.005);
            } else {
                point.targetY = 0;
            }

            // Spring physics for smooth motion
            const spring = 0.1;
            const damping = 0.8;
            const acceleration = (point.targetY - point.y) * spring;
            point.velocity = (point.velocity + acceleration) * damping;
            point.y += point.velocity;
        }

        // Draw multiple colored waves
        const colors = [
            { color: '#f97316', opacity: 0.6, amplitude: 1.2, phase: 0 },
            { color: '#eab308', opacity: 0.5, amplitude: 1.0, phase: 0.5 },
            { color: '#22c55e', opacity: 0.4, amplitude: 0.8, phase: 1 },
            { color: '#06b6d4', opacity: 0.5, amplitude: 1.0, phase: 1.5 },
            { color: '#ec4899', opacity: 0.6, amplitude: 1.1, phase: 2 },
        ];

        colors.forEach(({ color, opacity, amplitude, phase }) => {
            vizCtx.beginPath();
            vizCtx.moveTo(0, centerY);

            for (let i = 0; i < numPoints; i++) {
                const x = (i / numPoints) * width;
                const waveOffset = Math.sin(i * 0.15 + Date.now() * 0.003 + phase) * 5;
                const y = centerY + wavePoints[i].y * amplitude + waveOffset;

                if (i === 0) {
                    vizCtx.moveTo(x, y);
                } else {
                    const prevX = ((i - 1) / numPoints) * width;
                    const prevY = centerY + wavePoints[i - 1].y * amplitude +
                        Math.sin((i - 1) * 0.15 + Date.now() * 0.003 + phase) * 5;
                    const cpX = (prevX + x) / 2;
                    vizCtx.quadraticCurveTo(prevX, prevY, cpX, (prevY + y) / 2);
                }
            }

            vizCtx.strokeStyle = color;
            vizCtx.lineWidth = 2;
            vizCtx.globalAlpha = opacity;
            vizCtx.stroke();
            vizCtx.globalAlpha = 1;
        });

        vizAnimationId = requestAnimationFrame(animate);
    }

    animate();
}

function stopVisualizer() {
    // Don't stop - let it decay naturally
}

// Event Listeners
btnPlay.addEventListener('click', togglePause);
btnPrev.addEventListener('click', playPrev);
btnNext.addEventListener('click', playNext);
btnEject.addEventListener('click', openFile);

btnShuffle.addEventListener('click', () => {
    shuffle = !shuffle;
    btnShuffle.classList.toggle('active', shuffle);
});

btnRepeat.addEventListener('click', () => {
    repeat = !repeat;
    btnRepeat.classList.toggle('active', repeat);
});

btnFavorite.addEventListener('click', () => {
    btnFavorite.classList.toggle('active');
});

btnCoverMode.addEventListener('click', () => {
    coverBgMode = !coverBgMode;
    localStorage.setItem('winamp-cover-bg-mode', coverBgMode.toString());
    updateCoverDisplay();
});

btnPlAdd.addEventListener('click', openFile);
btnPlClear.addEventListener('click', clearPlaylist);

btnPlaylistToggle.addEventListener('click', async () => {
    const isHidden = playlistPanel.classList.toggle('hidden');
    btnPlaylistToggle.classList.toggle('active', !isHidden);
    document.querySelector('.player-panel').classList.toggle('playlist-hidden', isHidden);

    const appWindow = getCurrentWindow();
    if (isHidden) {
        await appWindow.setSize(new LogicalSize(500, 835));
    } else {
        await appWindow.setSize(new LogicalSize(960, 835));
    }
});

volumeSlider.addEventListener('input', (e) => {
    setVolume(parseInt(e.target.value));
});

btnClose.addEventListener('click', async () => {
    await saveWindowPosition();
    const appWindow = getCurrentWindow();
    await appWindow.close();
});

btnMinimize.addEventListener('click', async () => {
    const window = getCurrentWindow();
    await window.minimize();
});

// Window dragging
const dragRegion = document.querySelector('.drag-region');
dragRegion.addEventListener('mousedown', async (e) => {
    if (e.button === 0) { // Left mouse button
        const appWindow = getCurrentWindow();
        await appWindow.startDragging();
        // Save position after drag completes
        setTimeout(saveWindowPosition, 100);
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    switch (e.key) {
        case ' ':
            e.preventDefault();
            togglePause();
            break;
        case 'ArrowLeft':
            if (duration > 0) {
                elapsed = Math.max(0, elapsed - 5);
                invoke('seek', { positionSecs: elapsed });
                updateTimeDisplay();
            }
            break;
        case 'ArrowRight':
            if (duration > 0) {
                elapsed = Math.min(duration, elapsed + 5);
                invoke('seek', { positionSecs: elapsed });
                updateTimeDisplay();
            }
            break;
        case 'ArrowUp':
            volumeSlider.value = Math.min(100, parseInt(volumeSlider.value) + 5);
            setVolume(parseInt(volumeSlider.value));
            break;
        case 'ArrowDown':
            volumeSlider.value = Math.max(0, parseInt(volumeSlider.value) - 5);
            setVolume(parseInt(volumeSlider.value));
            break;
    }
});

// Seek via progress ring click/drag
const albumContainer = document.querySelector('.album-container');
let isSeeking = false;

function getSeekPositionFromEvent(e) {
    const rect = albumContainer.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Calculate angle from center (0 = top, clockwise)
    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    let angle = Math.atan2(dx, -dy); // -dy to start from top
    if (angle < 0) angle += 2 * Math.PI;

    // Convert angle to percentage (0-100)
    const percent = (angle / (2 * Math.PI)) * 100;
    return percent;
}

async function seekToPercent(percent) {
    if (duration <= 0) return;
    const newElapsed = (percent / 100) * duration;
    elapsed = Math.max(0, Math.min(duration, newElapsed));
    await invoke('seek', { positionSecs: elapsed });
    updateTimeDisplay();
}

albumContainer.addEventListener('mousedown', (e) => {
    if (!currentTrack || duration <= 0) return;
    isSeeking = true;
    const percent = getSeekPositionFromEvent(e);
    seekToPercent(percent);
});

document.addEventListener('mousemove', (e) => {
    if (!isSeeking) return;
    const percent = getSeekPositionFromEvent(e);
    seekToPercent(percent);
});

document.addEventListener('mouseup', () => {
    isSeeking = false;
});

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await restoreWindowPosition();
    setVolume(75);
    loadPlaylist();
    startVisualizer();
    updateProgressRing(0);
    updateCoverDisplay();
});
