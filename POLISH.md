# Polish Issues

Known areas that need UX, performance, or correctness polish. Organized by domain.

---

## 1. Timeline UX

Files: `src/components/Timeline/`

### Drag & Drop

- **No drag preview/ghost** — dropping a clip from the media browser or moving an existing clip gives no visual indication of where it will land. `isDragOver` only toggles a dashed outline on the track; there is no "ghost" at the cursor position. (`MediaTrack.tsx`, `OverlayTrack.tsx`)
- **No snap-to-grid** — `snapTime()` exists in `src/lib/timeline.ts` but is never called. Drops and resizes use raw float time values; there is no snapping to frame boundaries or time intervals.

### Resize / Scrub Performance

- **No debounce or throttle on drag/resize/seek** — every `mousemove` calls `onUpdateClip` or `onSeek`, which triggers a Zustand `set` and a full React re-render. At 60 fps this is a lot of work for what is just a live preview. Consider using `requestAnimationFrame` or a 16 ms throttle, and committing the final value only on `mouseup`. Affected: `MediaTrack.tsx`, `OverlayTrack.tsx`, `EffectTrack.tsx`, `TimelineRuler.tsx`.
- **`setScrollLeft` on every scroll event** — `Timeline.tsx` calls `setScrollLeft` in `onScroll`, which causes a state update (and re-render) on every pixel of scroll. The ruler needs scroll position, but this could be tracked in a ref and only flushed to state when the ruler actually needs to repaint.

### Re-render Overhead

- **No `React.memo` on clip/overlay items** — the entire track re-renders on every resize/drag tick. Memoizing individual clip and overlay elements would limit updates to the item being dragged.

### Correctness

- **Off-by-one in `OverlayTrack.tsx`** — `yToTrackIndex` clamps to `numTracks` instead of `numTracks - 1`, meaning it can return an index one past the last valid track. `MediaTrack.tsx` handles this correctly with `numTracks - 1`.
- **Stale listener risk in `TimelineRuler.tsx`** — `handleMouseUp` is listed in the `useCallback` dependency array of `handleMouseMove`, and both depend on `seekFromEvent`. If `seekFromEvent` changes during a drag (e.g. due to a zoom update), the listeners attached to `window` will be stale.
- **`getMediaDuration` not memoized in `MediaTrack.tsx`** — it is a plain function reference in the `handleDrop` dependency array, so `handleDrop` is recreated on every render.

### UX Details

- **Double-click to delete clips** — the same gesture used to zoom in many tools will delete a clip here. There is no confirmation, and the action is only reversible if undo is working. Consider moving delete to the Delete/Backspace key only, or adding a confirmation.

---

## 2. Effect Performance

Files: `src/lib/effects/`, `src/lib/effects-renderer.ts`, `src/lib/gl/`

### Heaviest Effects (no GPU path, expensive CPU loops)

- **`motion-smear`, `block-shoving`** — block matching with a ~33×33 search window, 16×16 sample blocks, repeated per frame. These are the slowest effects in the app. No GLSL path exists.
- **`melt`** — per-pixel `Math.random()` in a full-image nested loop plus a mutable state buffer. No GLSL path.
- **`heavy-distortion`** — per-pixel `Math.random()` with turbulence. No GLSL path.
- **`reaction-diffusion`** — runs 8–20 full simulation steps per frame on CPU.
- **`voronoi-mosaic`** — brute-force nearest-seed search: `O(width × height × seeds)` per frame.
- **`flow-field`** — gradient field computation plus thousands of `ctx.stroke()` calls per frame via Canvas 2D.
- **`neon-wireframe`** — Sobel edge detect + multi-pass blur + full-image composite, all on CPU.
- **`particle-disintegration`** — many particles each drawn with `ctx.fillRect` per frame.
- **`pixel-sort`** — `Array.sort` called per segment across the full image width or height.
- **`vhs degrade`**

### Face Effects

- **`face-blur`** — 3-pass box blur over an expanded face region; cost scales with blur radius squared.
- **`face-eye-censor`, `face-mouth-censor`** (blurred mode) — 2D Gaussian blur over eye/mouth region per frame.
- **`face-pixelate`** — calls `isPointInFaceBounds` in a nested per-pixel loop for every block.
- **Face detection runs when no face effects are active** — detection fires every 10 frames unconditionally. It should be skipped entirely when no face effect is in the active effect stack.

### Pipeline-Level Issues

- **No effect-level caching** — the same effect with identical params and identical input pixels still recomputes every frame. A simple hash of `(effectId, params, sourceHash)` could skip unchanged effects.
- **Buffer allocations every frame** — many effects call `new Uint8ClampedArray(data.length)` or `new Float32Array(...)` inside the per-frame path. These should be allocated once and reused.
- **Video disables the worker** — when `timelineFrames` is present, effects run on the main thread, blocking UI. The worker is only used for single-image (photo) mode.
- **CPU fallback inside the GL pipeline** — effects that have no GLSL shader or set `skipGL: true` force a GPU→CPU readback, a CPU pass, then a CPU→GPU upload inside the otherwise-GPU pipeline. Each such effect adds a full round-trip.
- **3D mesh (`mesh-renderer.ts`)** — `computeVertexNormals()` is called every frame even when the mesh shape hasn't changed. `texture.needsUpdate = true` is set every frame even when the source image hasn't changed.

---

## 3. General UI / UX

### Undo / Redo

- **Non-functional** — `useHistory.ts` maintains its own internal state but is never wired to the Zustand project store. `undo()` and `redo()` update the history object, but the store state (and therefore the UI) never changes. This is the highest-priority correctness issue on this list.

### Feedback & Error Handling

- **`alert()` for export results** — `App.tsx` uses `window.alert()` to report export success and failure. This should be an in-app notification or toast.
- **Save/load failures are silent** — `projectStore.ts` only calls `console.error` when `saveProject` or `loadProject` fails. No user-facing message is shown.
- **Import errors are swallowed** — `handleImport` in `App.tsx` has an empty `catch {}` block for video duration errors. Unsupported or corrupt files fail silently.
- **No loading states** — import, save, export, and project load are async but show no spinner or disabled state on the triggering button. The UI looks idle while work is in progress.
- **No error boundaries** — an uncaught error anywhere in the component tree crashes the whole app. At minimum, the timeline and effects panel should be wrapped in an error boundary.

### Keyboard Shortcuts

- **Space bar fires on nearly all keypresses** — the condition in `useKeyboardShortcuts.ts` is:
  ```ts
  (e.key === " " && !e.target) || (e.target as HTMLElement).tagName !== "INPUT";
  ```
  The second clause is `true` for every element that isn't an `<input>`, so play/pause triggers on any key when focus is outside an input. The intended logic is probably:
  ```ts
  e.key === " " && (e.target as HTMLElement).tagName !== "INPUT";
  ```
  and should also exclude `TEXTAREA` and `[contenteditable]`.
- **No Escape to close ExportDialog** — the export dialog has no `keydown` handler for Escape.

### Accessibility

- **ExportDialog** — missing `role="dialog"`, `aria-modal`, `aria-labelledby`; no focus trap; close button has no `aria-label`; export progress has no `aria-live` region.
- **MediaBrowser** — list items are plain `div` elements with `onClick`; not keyboard-focusable, not navigable with arrow keys. Remove buttons lack descriptive `aria-label`.
- **Toolbar** — icon-only buttons have `title` attributes but no `aria-label`.
- **Preview resize handles** — no `aria-label` and no keyboard support.

### Other

- **No settings/preferences panel** — resolution is in the toolbar but there is no central place to configure defaults (output format, frame rate, etc.).
- **`handleImport` has an unused `type` parameter** — `App.tsx` accepts `type?: "image" | "video"` but never uses it to filter which files to offer in the system dialog.
