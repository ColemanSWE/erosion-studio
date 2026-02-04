# Getting Started with Erosion Studio

## Installation

1. Install dependencies:

```bash
cd /Users/coleman/devStuff/erosion-studio
npm install
```

2. Run in development mode:

```bash
npm run dev
```

The app will open in an Electron window with:

- **Left sidebar**: Media browser for importing photos/videos
- **Center**: Preview canvas showing effects in real-time
- **Right sidebar**: Effects panel with 55+ effects
- **Bottom**: Timeline for video playback and scrubbing

## Quick Start

### Photo Editing

1. Click **Import** in the Media Browser
2. Select a photo (JPG, PNG, GIF, WebP)
3. Click an effect category in the Effects Panel (Glitch, Distortion, Color, etc.)
4. Click an effect to add it (e.g., "Codec Damage", "JPEG Artifacts")
5. Expand the effect to adjust parameters with sliders
6. Click **Export** in the toolbar to save

### Video Editing

1. Click **Import** and select a video (MP4, MOV, WebM)
2. Use the timeline controls to play/pause and scrub
3. Add effects from the Effects Panel
4. Effects apply to the entire video in real-time
5. Click **Export** to save (format selection coming soon)

## Keyboard Shortcuts

- **Cmd+Z** (Mac) / **Ctrl+Z** (Windows): Undo
- **Cmd+Shift+Z** / **Ctrl+Shift+Z**: Redo
- **Cmd+S** / **Ctrl+S**: Save project
- **Cmd+E** / **Ctrl+E**: Export
- **Space**: Play/Pause (when not in input fields)

## Effects Categories

### Glitch (13 effects)

- glitch, motion-smear, block-corrupt, pixel-sort
- datamosh, jpeg-artifacts, codec-damage
- rgb-channel-separation, block-shoving, screen-tear
- fragment-glitch, data-destroy, chaos

### Distortion (9 effects)

- displacement, wave-distortion, twirl, ripple
- heavy-distortion, melt, perlin-distort

### Color (10 effects)

- invert, posterize, solarize, duotone
- color-shift, channel-swap, thermal, vignette
- chromatic-aberration, bloom

### Retro (6 effects)

- vhs, crt, film-grain, scanlines
- dither, scan-sweep

### Noise (2 effects)

- noise, bitcrush

### Style (7 effects)

- pixelate, emoji, ascii, matrix
- halftone, 3d-mesh

### Face (6 effects)

- face-pixelate, face-blur, face-color-replace
- face-eye-censor, face-mouth-censor
- face-landmark-glitch, detection-labels

## Project Management

- **Save**: Cmd+S creates a `.erosion` project file with all media references and effects
- **Load**: File > Open to load a saved project
- Projects store effect parameters but reference media by file path

## Tips

1. **Stack effects**: Add multiple effects for complex looks
2. **Adjust parameters**: Expand effects to fine-tune intensity, block size, etc.
3. **Reorder effects**: Drag effects in the Active Effects list to change processing order
4. **Toggle effects**: Use checkboxes to enable/disable effects without removing them
5. **Real-time preview**: All effects render in real-time for instant feedback

## Troubleshooting

### "Electron API not available"

- Make sure you're running the app via `npm run dev`, not in a browser

### Effects not showing

- Check that the effect is enabled (checkbox checked)
- Try adjusting the intensity parameter
- Some effects are subtle at low intensity values

### Video not playing

- Ensure the video format is supported (MP4, MOV, WebM)
- Check that the file path is accessible
- Try reimporting the video

### Export not working

- Make sure a media file is imported and selected
- Check that you have write permissions to the save location
- For videos, export currently saves the current frame as an image

## Next Steps

- Explore all 55 effects to create unique looks
- Combine multiple effects for complex visuals
- Save your favorite effect combinations as projects
- Share your creations!

## Development

To modify or extend Erosion Studio:

1. **Add new effects**: Edit `src/lib/effects/processors.ts`
2. **Modify UI**: Components are in `src/components/`
3. **Add features**: Create new hooks in `src/hooks/`
4. **Update styles**: Edit SCSS files with brutalist design variables

See `.cursorrules` for detailed coding conventions.
