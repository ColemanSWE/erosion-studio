# Architecture

Erosion Studio is an Electron app. Everything visual happens in the renderer process; the main process handles windows, menus, file IO, the `media://` protocol and FFmpeg export.

```
                 React UI (components/)
                        │  state via Zustand stores
                        ▼
  ┌──────────────── useRenderEngine (hooks/) ─────────────────┐
  │  setTimeline / setEffects / setRegions / play / pause …   │
  └──────────────────────────┬────────────────────────────────┘
                             ▼
  PlaybackClock ──────►  RenderEngine (lib/engine/)
  (live time)            ├── MediaPool      videos · images · GIFs
                         ├── frame loop     rVFC / RAF, load shedding
                         └── renderWithEffects (lib/effects/)
                               ├── GLPipeline (WebGL2)  GPU effects
                               │     └── CPU batches ──► effects worker
                               ├── overlay compositor
                               └── style renderers (ASCII, emoji, 3D)
                                        │
                                        ▼
                                 display <canvas>  ──►  export (useExport → FFmpeg)
```

## Rules of thumb

1. **React never re-renders per frame.** Live time lives in the `PlaybackClock`; the canvas is drawn by the `RenderEngine`. React passes in *state changes* only.
2. **One engine, one GL context.** Video, still image and live camera are just different *primary sources* for the same engine.
3. **The engine owns time-dependent decisions** — which clips are on screen, keyframe values, effect windows — so playback, scrubbing and offline export all resolve them the same way.

## Playback clock — `src/lib/engine/clock.ts`

`playbackClock` holds the playhead time.

- While playing, `usePlayback` advances it every animation frame with `advance(t)`. Nothing is written to the store mid-playback.
- The project store's `currentTime` is the *committed* time: it changes on seek, pause, stop and load, and every change is mirrored into the clock with `seek(t)` (see `stores/projectStore.ts`).
- Consumers subscribe directly: the engine, the timeline playhead line, the ruler, auto-scroll. Components that need a *derived* value use `useClockSelector(fn)`, which re-renders only when `fn(time)` changes — e.g. the formatted time display, or App's "is the source at the playhead a camera/video" flags.

## Render engine — `src/lib/engine/render-engine.ts`

The engine is a plain class created by `useRenderEngine`. It holds:

- the display canvas context, a scratch buffer canvas, and the single `GLPipeline`;
- a `MediaPool` with every decoded element, keyed by clip/overlay id;
- the current timeline model, effects, keyframe tracks, regions, source transform;
- the frame loop.

**Sources.** `setTimeline({ clips, media, overlays, selectedMediaId })` gives the engine the timeline; it calls `resolveRenderSources` (`lib/engine/sources.ts`) at the clock time and syncs the pool whenever the set of active clips/overlays changes — a cheap check that runs on every clock tick, so clip boundaries are crossed without React. The primary source is, in order: the live camera, the first active video, the first active image.

**Frame loop.** `requestRender()` coalesces redraw requests into one animation frame. Only one frame renders at a time (`inFlight`); requests arriving mid-frame are queued. After a frame the loop continues only while there is something to animate:

| Primary | Keeps running while | Scheduled with |
| --- | --- | --- |
| Video | playing | `requestVideoFrameCallback` (fires per decoded frame) |
| Image | playing, or an active effect is animated | `requestAnimationFrame` |
| Camera | always | `requestAnimationFrame` |

Whether an effect animates on a still source is inferred by `isAnimatedEffectType` (`lib/engine/effect-traits.ts`) and can be overridden with `animated` on the definition.

**Per frame:** resolve effects at the frame's time (keyframes, time windows) → correct overlay-video drift → run face detection if a face effect is active (fire-and-forget, results used next frame) → collect secondary frames for transition effects → `renderWithEffects` → update the frame-time EMA.

**Load shedding.** While frames are flowing (video playing, camera), an EMA of frame cost drives two levels: above 2× the 33 ms budget every other frame is dropped; above 4× effects are skipped and the raw source plus overlays are drawn. Paused scrubbing never sheds — you always see the frame you asked for.

**Export.** `renderAt(time)` resolves sources at `time`, waits for new videos to load and all seeks to land (with timeouts), then renders exactly one frame. `useExport` calls it once per output frame.

## Media pool — `src/lib/engine/media-pool.ts`

Creates and destroys `<video>`, `<img>` and `GifDecoder` instances as sources come and go. A video whose clip id changes but whose file doesn't (e.g. after a split) is re-keyed instead of reloaded. GIFs are decoded with `ImageDecoder` and advanced on a 33 ms timer that triggers a redraw when a frame changes.

## Local media — `media://`

The renderer runs with Electron's default web security. Local files are loaded through a privileged `media://local/<path>` protocol (`electron/media-protocol.ts`) that:

- only serves paths that pass `isAllowedPath` (home, temp, external volumes);
- supports HTTP Range requests, which video seeking needs;
- sends `Access-Control-Allow-Origin: *`, and the pool sets `crossOrigin="anonymous"`, so drawing frames doesn't taint the canvas (effects and export read pixels back).

`src/lib/media-url.ts` converts paths to URLs and back; both processes share it.

## Effects rendering

See [effects-system.md](effects-system.md). In brief: `renderWithEffects` picks a path (GPU chain, GPU overlay-only, hybrid with CPU masking, pure CPU, or a style renderer); `GLPipeline` ping-pongs between two FBOs running each effect's fragment shader; runs of CPU-only effects are batched into one readback, processed in the effects worker, and uploaded again.

## Undo

Historical state (effects, regions, overlays, clips, media, keyframe tracks) is snapshotted by `withHistory` in each mutating store action (`stores/projectUtils.ts`), capped at 50 entries. Actions called continuously during a gesture pass a coalesce key (`clip:<id>`, `overlay:<id>`, `effect:<id>`, …): updates with the same key within 750 ms fold into one undo step.

## Export — `src/hooks/useExport.ts`, `electron/ffmpeg.ts`

All video formats render offline: for each output frame the engine renders `renderAt(t)`, the renderer reads the canvas, and

- **MP4 / WebM** stream raw RGBA over IPC to an `ffmpeg-static` child process (`libx264` / `libvpx-vp9`, CRF chosen by the quality setting). Rendering the next frame overlaps encoding of the previous one (one write in flight);
- **GIF** writes PNG frames to a temp directory, then runs FFmpeg's two-pass `palettegen` / `paletteuse`.

Stills use `canvas.toBlob`.

## Future work

Detailed write-ups: [investigations.md](investigations.md).

### Native export module

Measured on an Apple Silicon Mac at 1080p (Electron 29, `ffmpeg-static` 6.0):

| Stage | Per frame |
| --- | --- |
| Canvas readback (`getImageData`) | ~5 ms |
| IPC to the main process | ~5 ms |
| FFmpeg `libx264 -preset fast` encode | ~13 ms (39 fps end-to-end) |
| FFmpeg `h264_videotoolbox` (hardware) | ~12 ms (46 fps end-to-end) |

A native module (Rust / N-API, in-process `libavcodec`) would only remove the ~5 ms IPC copy, at the cost of per-platform `libav` builds and Electron-specific native compilation for every contributor. Not worth it today. The export loop instead overlaps rendering of frame N+1 with encoding of frame N (+35% throughput with a 15 ms render). With effects active, rendering — especially seeking `<video>` frame by frame — is the real bottleneck; a sequential decoder (WebCodecs `VideoDecoder`) for export would be the next lever. VideoToolbox is in the bundled FFmpeg if a "fast/hardware" export option is wanted.

### Rendering in a worker

Moving the whole engine into a worker with `transferControlToOffscreen()` would isolate the UI from GPU-path work too. Video still decodes on the main thread (frames would cross as `VideoFrame`s), and export reads the display canvas, so it needs a frame handshake with the worker. The CPU-effects worker already removes the biggest main-thread cost, so this is lower priority than it was.

### WebGPU

A prototype lives on a separate branch. Compute shaders would let the remaining CPU-only effects (pixel sort, datamosh, blob tracking) stay on the GPU.
