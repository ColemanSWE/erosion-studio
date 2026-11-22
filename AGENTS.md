# Agent instructions

Guidance for AI coding agents (and humans) working in this repo. Human-oriented docs: [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md), [docs/](docs/).

## Commands

```bash
npm run dev             # app with hot reload
npm run typecheck       # tsc (renderer + electron)
npm run lint            # eslint
npm test                # vitest (node environment, no DOM/WebGL)
npx vite build          # production bundle
npm run check:shaders   # compile all GLSL in real WebGL2 (needs a display)
```

Run typecheck, lint and tests after every change; run `check:shaders` after touching any `glsl` fragment.

## Architecture invariants

- **No per-frame React state.** Live playback time is `playbackClock` (`src/lib/engine/clock.ts`). Use `useClockSelector` for derived values; never write `currentTime` to the store during playback.
- **All drawing goes through `RenderEngine`** (`src/lib/engine/render-engine.ts`). Do not add new render loops or WebGL contexts in components or hooks.
- **The engine resolves time-dependent state** (active clips/overlays, keyframes, effect windows) itself, so playback and offline export agree.
- **Local files load via `media://`** (`src/lib/media-url.ts`). Never re-enable `webSecurity: false` or use `file://` URLs in the renderer. Set `crossOrigin = "anonymous"` on media elements.
- **Effects live one per file** in `src/lib/effects/processors/<group>/`, registered from the group's `index.ts`. Every user-facing param needs a `paramsConfig` entry (tested).
- **CPU processors** mutate RGBA in place, must not allocate full frames per call (use `scratchCopy` / `scratchFloats`), and must work in a Web Worker.
- **Store actions called continuously** (drag, scrub) pass a coalesce key to `withHistory`.

## UI conventions

- Use primitives from `src/components/ui/` (Button, IconButton, Slider, Select, SegmentedControl, Checkbox, Dialog, toast, ErrorBoundary).
- SCSS modules only; font sizes and colors must be tokens from `src/styles/_variables.scss` (enforced by `src/styles/tokens.test.ts`).
- Icons from `lucide-react`. Icon-only buttons need a `label`.
- Errors the user should know about go to `toast.error(...)`.

## Gotchas

- Vitest aliases `node:fs` for the Electron renderer build; tests that need the filesystem use `process.getBuiltinModule("fs")`.
- `e.key` is upper-case when Shift is held; compare `e.key.toLowerCase()` in shortcuts.
- GLSL fragments are in template strings; text there is not TypeScript (watch imports that only appear inside shaders).
