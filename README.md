# Erosion Studio

A desktop photo and video editor with 55+ glitch, compression, and distortion effects.

## Features

- **Photo Editing**: Import and edit images with stackable effects
- **Video Timeline**: Timeline-based video editing with per-clip effects
- **55+ Effects**: Glitch, distortion, color, retro, and style effects
- **Export**: PNG, JPG, WebP, GIF, MP4, WebM

## Tech Stack

- Electron + React 19 + TypeScript
- Vite (build tool)
- Three.js (3D effects)
- FFmpeg (video processing)
- Zustand (state management)

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
```

## Effects Categories

- **Glitch** (13): glitch, motion-smear, block-corrupt, pixel-sort, datamosh, jpeg-artifacts, codec-damage, etc.
- **Distortion** (9): wave, twirl, ripple, melt, displacement, etc.
- **Color** (10): invert, posterize, duotone, thermal, etc.
- **Retro** (6): vhs, crt, film-grain, scanlines, etc.
- **Style** (7): pixelate, ascii, emoji, matrix, halftone, 3d-mesh
- **Face** (6): face-pixelate, face-blur, detection-labels, etc.
