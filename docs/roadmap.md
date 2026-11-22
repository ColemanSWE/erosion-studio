# Roadmap and Known Issues

Good first issues are marked ★.

## Effects

- **Curate the catalog.** 100+ effects is a lot; several overlap (e.g. RGB Channel Separation / Chromatic Aberration, the various glitch variants). Pick a strong default set and move the rest behind `experimental`.
- **GPU ports for the remaining CPU effects:** pixel sort, datamosh, blob tracking, flow field, particles, slit-scan, posterize-time, face effects. Face effects could take face rects as uniforms; pixel sort and datamosh need compute (WebGPU) or multi-pass tricks.
- **Effect-level caching** — skip recomputing an effect when its input and params are unchanged (paused, static images with non-animated stacks already skip whole frames, but not individual effects).
- **3D mesh renderer** recomputes vertex normals and re-uploads its texture every frame even when nothing changed (`mesh-renderer.ts`).
- ★ **Effect thumbnails / previews** in the catalog.

## Timeline

- **Drag ghost** — no preview of where a dropped or moved clip will land.
- ★ **Memoize clip/overlay items** so a drag re-renders only the dragged item.
- ★ **Keyframe deletion** is double-click only; add Delete/Backspace on the selected keyframe.

## UI

- ★ Move the remaining hand-rolled controls (`ActiveEffectsStack`, `OverlayProperties`, timeline headers) onto the shared primitives in `src/components/ui/`.
- ★ **Preview resize handles** have no labels or keyboard support.
- **Settings panel** for defaults (export format, frame rate, projects folder).
- **Confirm dialogs** use `window.confirm`; replace with an in-app dialog.
- ★ A short demo GIF for the README (there's a screenshot; motion sells the video effects better).

## Platform and release

- **Code signing / notarization** for macOS and Windows builds; release workflow that publishes `electron-builder` artifacts.
- Test packaged builds on Windows and Linux (media paths, `media://` and `app://` protocols, FFmpeg binary unpacking). CI runs the unit tests on all three platforms.
- **Bundle Google Fonts** so the app makes no network requests at all (they are the only remote resource left).
- **React Compiler lint rules.** `eslint-plugin-react-hooks` 7 ships rules like `set-state-in-effect` and `immutability`; they're off for now (13 findings) — fix those and switch to its `recommended` preset.

## Export

- **Sequential decode for offline export.** Export seeks the `<video>` element once per output frame; a WebCodecs `VideoDecoder` reading frames in order would be much faster for long clips.
- ★ **Hardware encoder option** (`h264_videotoolbox` / `hevc_videotoolbox` on macOS — already in the bundled FFmpeg).
- **GIF export** encodes a PNG per frame and writes temp files; stream frames instead.

## Bigger projects

See [investigations.md](investigations.md): native (Rust/N-API) export with hardware encoders, rendering in a worker via `OffscreenCanvas`, and a WebGPU pipeline.
