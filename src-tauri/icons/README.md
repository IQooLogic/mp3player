#!/bin/bash
# Generate placeholder icons for Tauri build
# In production, replace these with actual Winamp-style icons

# You can use ImageMagick to create placeholder icons:
# convert -size 32x32 xc:#1a3a1a icons/32x32.png
# convert -size 128x128 xc:#1a3a1a icons/128x128.png
# convert -size 256x256 xc:#1a3a1a icons/128x128@2x.png

echo "Please add icons to src-tauri/icons/"
echo "Required files:"
echo "  - 32x32.png"
echo "  - 128x128.png"
echo "  - 128x128@2x.png"
echo "  - icon.icns (macOS)"
echo "  - icon.ico (Windows)"
