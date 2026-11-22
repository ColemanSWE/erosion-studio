# Contributing to Erosion Studio

Thanks for helping out! Bug reports, effects, performance work and UI polish are all welcome.

## Setup

Requires Node.js 22.12+.

```bash
npm install
npm run dev
```

Before opening a pull request, make sure these pass (CI runs the first four):

```bash
npm run typecheck
npm run lint
npm test
npx vite build
npm run check:shaders   # if you touched any GLSL — needs a display, so it isn't in CI
```

## Project layout

```
electron/                 Electron main process: windows, menus, file IPC
                          (checked by path-policy.ts), FFmpeg export,
                          app:// and media:// protocols
src/
  components/             React UI
    ui/                   shared primitives (Button, Slider, Dialog, Toast, …)
  hooks/                  React glue (playback, render engine, import, export)
  stores/                 Zustand stores (project state, UI prefs, toasts)
  lib/
    engine/               render engine, playback clock, media pool
    effects/
      processors/<group>/ one file per effect
      gl/                 WebGL2 pipeline and shader helpers
  styles/                 design tokens (_variables.scss) and global styles
docs/                     architecture and contributor guides
```

Read [docs/architecture.md](docs/architecture.md) before changing playback, rendering or export.

## Adding an effect

The most common contribution. See [docs/adding-an-effect.md](docs/adding-an-effect.md) — in short: add a file under `src/lib/effects/processors/<group>/`, import it from that group's `index.ts`, add the type to `EffectType`, and give it `paramsConfig` controls. Tests check that every parameter has a control and every slider default is in range.

## Code guidelines

- **TypeScript strict**, functional React components.
- **Don't put per-frame state in React.** Live playback time comes from `playbackClock`; rendering belongs to `RenderEngine`. A component that re-renders every frame is a bug.
- **Styles use tokens.** Font sizes and colors come from `src/styles/_variables.scss` (a test enforces this). Reach for the primitives in `src/components/ui/` before writing a new button or slider.
- **User-facing errors go to `toast`** (`src/stores/toastStore.ts`), not `alert()` or only `console.error`.
- **Continuous edits must coalesce in undo.** Store actions called on every drag/scrub tick pass a coalesce key to `withHistory` (see `timelineSlice.updateClip`).
- Icons come from `lucide-react`.

## Pull requests

- Keep PRs focused; one effect or one fix per PR is ideal.
- Include a screenshot or short clip for visual changes.
- Describe how you tested it (which media, which effects).

## Reporting bugs

Open an issue with the OS, what you did, what you expected, and what happened. For rendering bugs, the effect stack and source media type (video / image / camera) help a lot; console output from View → Toggle Developer Tools is even better.
