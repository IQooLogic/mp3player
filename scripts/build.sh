#!/bin/bash

# WinampClone Build Script
# Usage: ./scripts/build.sh [target]
# Targets: linux, windows, mac, all, current (default)

set -e

cd "$(dirname "$0")/.."

TARGET=${1:-current}
TAURI_DIR="src-tauri"

echo "==================================="
echo "  WinampClone Build Script"
echo "==================================="

build_linux() {
    echo ""
    echo "Building for Linux..."
    echo "-----------------------------------"
    cd "$TAURI_DIR"
    cargo tauri build --target x86_64-unknown-linux-gnu
    cd ..
    echo "Linux build complete!"
    echo "Output: src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/"
}

build_windows() {
    echo ""
    echo "Building for Windows..."
    echo "-----------------------------------"

    # Check if cross-compilation tools are available
    if ! command -v x86_64-w64-mingw32-gcc &> /dev/null; then
        echo "Warning: MinGW not found. Install with:"
        echo "  Ubuntu/Debian: sudo apt install mingw-w64"
        echo "  Arch: sudo pacman -S mingw-w64-gcc"
        echo ""
        echo "Attempting build anyway..."
    fi

    cd "$TAURI_DIR"
    cargo tauri build --target x86_64-pc-windows-msvc
    cd ..
    echo "Windows build complete!"
    echo "Output: src-tauri/target/x86_64-pc-windows-msvc/release/bundle/"
}

build_mac() {
    echo ""
    echo "Building for macOS..."
    echo "-----------------------------------"

    if [[ "$OSTYPE" != "darwin"* ]]; then
        echo "Error: macOS builds must be done on macOS"
        echo "Cross-compilation to macOS is not supported by Apple."
        return 1
    fi

    cd "$TAURI_DIR"
    # Build for both Intel and Apple Silicon
    cargo tauri build --target x86_64-apple-darwin
    cargo tauri build --target aarch64-apple-darwin
    cd ..
    echo "macOS build complete!"
    echo "Output: src-tauri/target/*/release/bundle/"
}

build_current() {
    echo ""
    echo "Building for current platform..."
    echo "-----------------------------------"
    cd "$TAURI_DIR"
    cargo tauri build
    cd ..
    echo "Build complete!"
    echo "Output: src-tauri/target/release/bundle/"
}

install_targets() {
    echo "Installing Rust targets..."
    rustup target add x86_64-unknown-linux-gnu
    rustup target add x86_64-pc-windows-msvc

    if [[ "$OSTYPE" == "darwin"* ]]; then
        rustup target add x86_64-apple-darwin
        rustup target add aarch64-apple-darwin
    fi

    echo "Targets installed!"
}

case $TARGET in
    linux)
        build_linux
        ;;
    windows)
        build_windows
        ;;
    mac|macos)
        build_mac
        ;;
    all)
        build_linux
        build_windows
        if [[ "$OSTYPE" == "darwin"* ]]; then
            build_mac
        fi
        ;;
    current)
        build_current
        ;;
    install-targets)
        install_targets
        ;;
    *)
        echo "Usage: $0 [target]"
        echo ""
        echo "Targets:"
        echo "  current  - Build for current platform (default)"
        echo "  linux    - Build for Linux (x86_64)"
        echo "  windows  - Build for Windows (x86_64)"
        echo "  mac      - Build for macOS (Intel + Apple Silicon)"
        echo "  all      - Build for all platforms"
        echo "  install-targets - Install Rust cross-compilation targets"
        echo ""
        echo "Note: Cross-compilation has limitations:"
        echo "  - macOS builds require macOS"
        echo "  - Windows builds from Linux require additional setup"
        echo "  - For best results, build on each target platform"
        exit 1
        ;;
esac

echo ""
echo "==================================="
echo "  Build finished!"
echo "==================================="
