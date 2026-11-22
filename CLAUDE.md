# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Erosion Studio is an Electron + React 18 + TypeScript desktop editor for glitch art: 100+ stackable effects (WebGL2 with CPU fallbacks) on photos, video timelines or the webcam, exported via FFmpeg. Human docs: [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md), [docs/](docs/).

## Commands

```bash
npm run dev             # Vite + Electron with hot reload
npm run typecheck       # tsc --noEmit (renderer + electron)
npm run lint            # eslint src electron
npm test                # vitest run (node env, no DOM/WebGL)
npx vite build          # production bundle (what CI builds)
npm run build           # tsc + vite build + electron-builder installers (out/)
npm run check:shaders   # compile every effect's GLSL in real WebGL2 (needs a display)

npx vitest run src/lib/timeline.test.ts     # one test file
npx vitest run -t "partial test name"       # tests matching a name
```

Run typecheck, lint and tests after every change; run `check:shaders` after touching any GLSL.

- Tests are `src/**/*.test.ts` and `electron/**/*.test.ts`. There is no DOM or WebGL in them, so GPU code is checked only by `check:shaders`.
- Requires Node 22.12+. Electron 45 has no postinstall: the binary downloads the first time `electron` runs (`npm run dev`, `check:shaders`).
- CI (`.github/workflows/`) runs plain `npm ci`, then typecheck, lint, test and `npx vite build` on Ubuntu, Windows and macOS. It does not run `check:shaders`.

## Architecture

Read [docs/architecture.md](docs/architecture.md) before changing playback, rendering or export, and [docs/effects-system.md](docs/effects-system.md) / [docs/adding-an-effect.md](docs/adding-an-effect.md) before touching effects.

- **Process split.** `electron/` is the main process: windows, menus, file IPC, the `app://` protocol that serves the built renderer (`app-protocol.ts`), the `media://` protocol (`media-protocol.ts`) and FFmpeg export (`ffmpeg.ts`). `preload.ts` is bundled separately to CJS by esbuild (`buildPreload()` in `vite.config.ts`), because vite-plugin-electron emits ESM, which the preload loader can't run. Everything visual happens in the renderer.
- **Renderer security.** The renderer is sandboxed and treated as untrusted (see "Renderer security" in docs/architecture.md). Every path crossing IPC or `media://` is checked by `PathPolicy` (`electron/path-policy.ts`). The CSP is injected by `contentSecurityPolicy()` in `vite.config.ts`, not written in `index.html`.
- **State.** `src/stores/projectStore.ts` is one Zustand store composed from `stores/slices/` (media, effects, timeline, history, projectIO). Its `currentTime` is the *committed* time (seek, pause, stop, load), and a store subscription mirrors it into `playbackClock`. `uiStore` holds UI preferences and `toastStore` holds toasts.
- **Render flow.** Components → `useRenderEngine` → `RenderEngine` (`src/lib/engine/render-engine.ts`). The engine owns a `MediaPool` (video/img/GIF elements keyed by clip/overlay id), the frame loop (rVFC for video, RAF otherwise, with load shedding) and `renderWithEffects` (`lib/effects/effects-renderer.ts`). That function picks a path per frame: GPU chain, GPU overlays-only, hybrid, CPU, or a style renderer (ASCII/emoji/3D via Three.js).
- **GPU/CPU mix.** `lib/effects/gl/pipeline.ts` ping-pongs two FBOs, running each effect's fragment shader. Consecutive CPU-only effects are batched into one readback and run in the single persistent effects worker (`worker-pool.ts` / `effects-worker.ts`). It is kept to one worker on purpose: stateful effects keep cross-frame state in module memory.
- **Effect registration** happens by side-effect import. `processors/index.ts` imports each group's `index.ts`, which imports each effect file, which calls `registerEffect`. A new effect also needs its id added to the `EffectType` union in `lib/effects/types.ts`.
- **Undo.** Mutating store actions call `withHistory(state, coalesceKey?)` (`stores/projectUtils.ts`), which keeps up to 50 snapshots. Calls with the same key within 750 ms fold into one undo step.
- **Export** calls `engine.renderAt(t)` once per output frame (`hooks/useExport.ts`). For MP4/WebM it streams RGBA over IPC to `ffmpeg-static`. GIF writes PNG frames, then runs palettegen/paletteuse.

## Invariants

- **No per-frame React state.** Live playback time lives in `playbackClock` (`src/lib/engine/clock.ts`). Use `useClockSelector` (`src/hooks/useClock.ts`) for derived values. Never write `currentTime` to the store during playback.
- **All drawing goes through `RenderEngine`.** Don't add render loops or WebGL contexts in components or hooks.
- **The engine resolves time-dependent state** (active clips/overlays, keyframes, effect windows) itself, so playback, scrubbing and offline export agree.
- **New IPC handlers check paths with `PathPolicy`.** Writes go only to save-dialog paths (`takeWriteGrant`), `.eron` projects or our own temp dirs; never accept an arbitrary path from the renderer.
- **No remote code.** Scripts and wasm load only from the app bundle (the CSP enforces it); vendor assets like MediaPipe's are bundled (`mediapipeAssets()` / `public/mediapipe/`), not fetched from a CDN.
- **Local files load via `media://`** (`src/lib/media-url.ts`). Never re-enable `webSecurity: false` or use `file://` URLs in the renderer. Set `crossOrigin = "anonymous"` on media elements, or reading pixels back from a tainted canvas breaks effects and export.
- **Effects live one per file** in `src/lib/effects/processors/<group>/`, registered from the group's `index.ts`. Every user-facing param needs a `paramsConfig` entry (enforced by `params-config.test.ts`).
- **CPU processors** mutate RGBA in place (row 0 = top), must not allocate full frames per call (use `scratchCopy` / `scratchFloats` from `processors/shared.ts`), and must work in a Web Worker.
- **Store actions called continuously** (drag, scrub) pass a coalesce key to `withHistory` (e.g. `clip:<id>`, `overlay:<id>`, `effect:<id>`).

## UI conventions

- Use the primitives exported from `src/components/ui/` (Button, IconButton, Slider, Select, SegmentedControl, Checkbox, ColorInput, TextInput, Dialog, toast, ErrorBoundary).
- SCSS modules only. Font sizes and colors must be tokens from `src/styles/_variables.scss` (enforced by `src/styles/tokens.test.ts`).
- Icons come from `lucide-react`. Icon-only buttons need a `label`.
- Errors the user should know about go to `toast.error(message, detail?)`.

## Gotchas

- `vite-plugin-electron-renderer` aliases Node built-ins (`node:fs`, `node:path`, …) for the renderer build, and the alias also applies in Vitest. Tests that need a real built-in use `process.getBuiltinModule("fs")` / `("path")`, and code under test should take such modules as parameters (see `PathPolicy`).
- `check:shaders` uses `cross-env`, so it runs from any shell.
- `e.key` is upper-case when Shift is held, so shortcuts should compare `e.key.toLowerCase()`.
- GLSL lives in template strings, and text there is not TypeScript. Watch out for imports that are only used inside shaders.
