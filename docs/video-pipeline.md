# Video Playback Pipeline

## Overview

Video playback is driven by native `HTMLVideoElement` decoding combined with a Canvas 2D render loop. Each frame, the current video frame is drawn into an offscreen buffer, effects are applied (on GPU via WebGL2 or on CPU), and the result is composited onto the display canvas. Everything runs on the renderer process (browser context inside Electron).

## Key Files

```
src/hooks/useVideoPlayer.ts    main video playback hook
src/hooks/usePhotoEditor.ts    photo / still image equivalent
src/hooks/useCameraPlayer.ts   live camera feed equivalent
src/components/App.tsx         playback time loop (separate RAF from render)
src/components/Preview/        display canvas component
electron/ffmpeg.ts             native FFmpeg (export only, not used for playback)
```

## Data Flow

```
App.tsx (playback time RAF)
  │  setCurrentTime(next)
  ▼
useVideoPlayer
  ├── videosMapRef  Map<id, HTMLVideoElement>
  ├── render() ─── async RAF loop
  │     │  detectFaces() every 10 frames
  │     │  renderWithEffects(context, effects, regions, overlays)
  │     └──► effects-renderer.ts  (see effects-system.md)
  └── display canvas (Preview.tsx)
```

## Dual RAF Architecture

There are **two separate** `requestAnimationFrame` loops:

| Loop | Location | Purpose |
|---|---|---|
| Playback time | `App.tsx` | Advances `currentTime` at wall-clock speed, calls `setCurrentTime` |
| Render | `useVideoPlayer` `render()` | Reads current video frame, applies effects, paints canvas |

The time loop only runs while playing and does not know about effects. The render loop drives the visual output. Seeking (`currentTime` prop change) triggers a single non-looping `render()` call so the canvas always stays in sync even when paused.

## `useVideoPlayer` Internals

### Setup

```ts
// Created once on mount
bufferRef         HTMLCanvasElement  offscreen buffer (willReadFrequently: true)
bufferCtxRef      CanvasRenderingContext2D
glPipelineRef     GLPipeline | null  lazily imported
animationFrameRef number             current RAF handle
```

The GL pipeline is loaded via dynamic `import()` so it doesn't block the initial render.

### Per-frame `render()` sequence

1. Guard: skip if canvas / video / buffer not ready → re-schedule RAF
2. For each secondary video (transition overlays): `getImageData` into `secondaryFrames[]`
3. Face detection every 10 frames (async, MediaPipe)
4. Frame budget check: if last frame took > 66 ms, skip effects this frame and draw raw video
5. `renderWithEffects(...)` — see effects-system.md
6. Measure elapsed time, set `skipEffectsRef` if over budget
7. Re-schedule RAF if still playing

### Video element lifecycle

Video elements are stored in `videosMapRef` (a `Map<id, HTMLVideoElement>`). The video lifecycle effect runs when `activeVideos` changes:

- Videos no longer in the list are paused and `src` cleared
- New videos are created, `crossOrigin` set for remote URLs, `file://` scheme used for local paths
- `oncanplay` triggers a single `render()` call so the first frame appears immediately

### Seeking

When `currentTime` changes externally (scrubbing, jump-to), the seek effect fires: if a video's `currentTime` differs by more than 100 ms from the desired `localTime`, it is seeked. A single `render()` is triggered if not currently playing.

## Photo Editor (`usePhotoEditor`)

Same architecture as `useVideoPlayer` but with `HTMLImageElement` instead of `HTMLVideoElement`. Face detection runs once per image load rather than every 10 frames. The animation loop only runs when `isAnimating` is true (certain effects like datamosh or slit-scan need continuous ticking even on still images).

## Camera Feed (`useCameraPlayer`)

Uses `getUserMedia` → `HTMLVideoElement.srcObject`. The render loop is the same as video playback. The canvas context is pre-flipped (`ctx.scale(-1, 1)`) so the user sees a mirror image. Face/hand/pose detection runs every 10 frames.

## Export

Export does **not** use the playback pipeline. It runs via the Electron main process:

- `electron/ffmpeg.ts` wraps the `ffmpeg-static` native binary
- The renderer process sends frames (as PNG blobs) via IPC
- FFmpeg encodes them into MP4 / WebM / GIF
- Temp directories are created and cleaned up around each export

For photo export, `canvas.toDataURL` / `canvas.toBlob` is used directly from the renderer process with no FFmpeg involvement.

## Performance Characteristics

| Scenario | Bottleneck | Mitigation |
|---|---|---|
| Effects with GLSL | GPU bound | WebGL2 FBO ping-pong, no readback |
| CPU effects (blob-track, pixel-sort) | JS main thread | Web Worker for global-only CPU effects; blob detection throttled to 1-in-3 frames |
| Many region effects with overlay masks | `getImageData` / `putImageData` per region | Cached temp canvas; GL scissor path for GLSL region effects |
| High-resolution source | Memory bandwidth | All buffers preallocated and reused; GC pressure minimised |
| Progressive lag over time | Memory leaks | Undo history capped at 50; blob URLs revoked on removal; resolution-keyed caches evicted |

## Frame Budget / Adaptive Skipping

The render loop tracks how long each frame takes with `performance.now()`. If a frame exceeds **66 ms** (2× the 30 fps budget), the next frame skips effect processing and draws the raw video directly. This prevents the playback from falling further and further behind under heavy load.

The skip is one frame only — the subsequent frame resumes normal processing. Under sustained overload the effect is that roughly every other frame skips, halving the effect complexity while keeping the video playing smoothly.
