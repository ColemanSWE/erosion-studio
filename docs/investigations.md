# Architecture Investigations

Design notes on larger changes that were evaluated but not yet built. Written before the render-engine refactor; file references to `useVideoPlayer` etc. describe the old structure — see [architecture.md](architecture.md) for the current one.

### Native FFmpeg Module (Rust / N-API) for Export

**Current situation:** `useExport.ts` encodes MP4/WebM by calling `canvas.getImageData()` every frame and piping raw RGBA bytes to a `ffmpeg-static` child process over IPC. For a 1080p 30fps clip this is ~8 MB/frame transferred from renderer → main process → stdin. The GIF path is even heavier: it writes PNG files to a temp directory, then runs two FFmpeg passes.

**Benefit of a native module:** A Rust `napi-rs` (or C++ N-API) module bundled into the Electron main process could:
- Accept a `SharedArrayBuffer` reference to the canvas pixels rather than copying bytes over IPC.
- Drive FFmpeg's `libavcodec` directly in-process (no child process, no stdin pipe).
- Use hardware encoders (`VideoToolbox` on macOS, `NVENC`, `VAAPI`) via `libavcodec` AVOptions.

**Expected gain:** IPC round-trip + stdin copy is ~2-5× the frame-encode time for software h264. Eliminating it could cut peak export RAM usage by ~50% and wall-clock time by ~30-60% depending on resolution.

**Integration points:**
- Replace `window.electron.ffmpeg.startStreamExport` / `writeFrame` / `endStreamExport` in `useExport.ts`.
- Expose a single `encodeVideo({ width, height, fps, pixelsBuf, outputPath, codec })` call.
- GIF: replace the PNG-file round-trip with a palette-compute + encode pass in the same native call.

**Blockers:**
- `ffmpeg-static` is a pre-built binary; a native module would need to link against `libav*` headers. A prebuilt `ffmpeg-dev` package or vendored static libs are needed per platform (macOS / Windows / Linux).
- Electron requires native modules to be compiled against the exact Electron headers (`electron-rebuild`). The `electron-builder.yml` `asarUnpack` list would need to include the `.node` file.
- `SharedArrayBuffer` requires `crossOriginIsolated` headers, which means setting `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on the Electron BrowserWindow's loaded content — currently these headers are not set.

**Verdict:** Worth doing for export quality/speed once the codebase is otherwise stable. Not needed for playback performance.

**Update (measured):** IPC is ~5 ms/frame at 1080p against ~13 ms of libx264 encode, not 2–5× the encode time, so the expected gain doesn't materialize. See the measurements in [architecture.md](architecture.md#native-export-module). Overlapping render and encode was implemented instead.

---

### OffscreenCanvas Render Worker

**Current situation:** The entire render pipeline (decode, effects, compositing, blit) runs on the main renderer thread. Heavy effect chains cause the UI (timeline scrubbing, panel interactions) to stutter because RAF-driven rendering competes with React's event loop on the same thread.

**What an OffscreenCanvas worker would change:**
- The visible canvas's control is transferred to a Worker via `canvas.transferControlToOffscreen()`.
- The Worker owns the `GLPipeline`, the buffer canvas, and the RAF loop.
- The main thread sends lightweight messages: `{ type: "seek", time }`, `{ type: "setEffects", effects }`, `{ type: "play" | "pause" }`.
- `HTMLVideoElement` decode stays on the main thread (video elements cannot be created in workers). Each decoded frame is transferred to the worker as a `VideoFrame` (zero-copy on Chrome/Electron) or `ImageBitmap`.

**Architecture sketch:**

```
Main thread                        Render Worker
──────────                         ──────────────
HTMLVideoElement (decode)
  │ VideoFrame (transferable)─────►  GLPipeline.renderEffects(...)
setCurrentTime(t) ──────────────►  render() RAF loop
setEffects(fx) ─────────────────►  effect chain
                                   OffscreenCanvas (GPU)
                                      │
                    ◄── postMessage({ type: "rendered", time }) ──
```

**Gains:**
- UI interactions (timeline drag, effect parameter sliders) never block on render work.
- RAF runs at display refresh without competing with React reconciliation.

**Complexity:**
- `VideoFrame` API requires Chrome 94+ / Electron 15+. The app targets Electron 29, so this is available.
- Zustand store updates (effects, regions, overlays) must be serialised and sent to the worker; large effect param objects are fine as structured-clone.
- Export (`useExport.ts`) uses `canvas.getImageData()` on each seek — this would need a synchronisation handshake with the worker to get each rendered frame.
- `MediaPipe` (face/hand detection) also runs in the main-thread render loop — it would need to be moved to a separate worker or run results forwarded to the render worker.

**Verdict:** High value for perceived UI responsiveness. Recommended after the WebGPU migration stabilises, so the worker ships with the new pipeline from the start.
