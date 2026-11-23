# Effects System

Every effect is a registry entry: metadata, default parameters, UI controls, a CPU processor, and optionally a GLSL fragment shader. The renderer decides per frame whether each effect runs on the GPU or the CPU.

To write one, see [adding-an-effect.md](adding-an-effect.md). This document covers how they run.

## Layout

```
src/lib/effects/
├── effect-registry.ts     registerEffect(), lookups, EffectDefinition type
├── effects-renderer.ts    renderWithEffects(): picks a render path per frame
├── gl/
│   ├── pipeline.ts        GLPipeline — WebGL2 FBO ping-pong, CPU batching, history rings
│   ├── shaders.ts         preamble, helpers, HISTORY_GLSL, uniform binding
│   └── shader-dump.test.ts  feeds `npm run check:shaders`
├── processors/
│   ├── index.ts           imports every group (registration side effects)
│   ├── shared.ts          math helpers, cross-frame state, scratch buffers
│   └── <group>/           one file per effect + index.ts
│        glitch/ distortion/ color/ retro/ noise/ style/ face/
│        standard/ creative/ experimental/ datamosh/
├── worker-pool.ts         the effects worker (single, persistent)
├── effects-worker.ts      worker entry: applyEffects() on transferred buffers
├── overlay-compositor.ts  overlay drawing, region and effect-zone masking (CPU)
├── style-renderer.ts      style effects (pixelate, emoji, ascii, matrix, halftone, 3D)
├── *-renderer.ts          Three.js renderers for the 3D style effects
└── face-detector.ts       MediaPipe face landmarks
```

Groups are about where code lives; the catalog groups effects by each definition's `category`.

## Definition

```ts
interface EffectDefinition {
  type: EffectType;            // id, also in the EffectType union (types.ts)
  label: string;               // shown in the catalog and effect stack
  category: "glitch" | "distortion" | "color" | "retro" | "noise" | "style" | "face" | "standard";
  defaultParams: Record<string, unknown>;
  paramsConfig: EffectParamConfig[];   // UI controls; one per user-facing param
  processor: (data, config, params) => void;   // CPU path, mutates RGBA in place
  glsl?: GLSLEffect;           // GPU path
  animated?: boolean;          // override animation inference (see below)
  experimental?: boolean;      // hidden unless "Show experimental effects" is on
}
```

`EffectParams.tsx` renders controls straight from `paramsConfig` (slider, checkbox, select, color, text), grouped by the optional `group` field.

## Render paths — `effects-renderer.ts`

Each frame the active effects are split into **global** (no target), **region** (`regionId`) and **overlay** (`overlayId`) effects. Then one path is chosen:

| Path | When | What happens |
| --- | --- | --- |
| Style | a style effect (pixelate, emoji, ascii, matrix, halftone, 3D) is active | effects before it run first, the style renderer draws, effects after it run on the result |
| GPU chain | WebGL2 available, no overlay masks | the GL pipeline runs global effects, then each region/effect-zone with a scissor rect, composites image/video overlays, blits to the canvas; text overlays are drawn on top |
| GPU overlays only | no effects, only overlays | upload source, composite overlays on the GPU |
| Hybrid | effects target a (non-zone) overlay | GPU chain into the buffer, CPU masking per overlay, GPU composite of the rest |
| CPU | no WebGL2 | everything on 2D canvas; global effects run in the effects worker |

## GL pipeline — `gl/pipeline.ts`

- **Ping-pong.** The source is uploaded into one FBO; each GPU effect renders a full-screen pass into the other, then they swap. Multi-pass effects declare `multiPass`.
- **CPU effects inside a GPU chain.** Consecutive effects without a usable shader (no `glsl`, or `skipGL(params)` true) are *batched*: one `readPixels`, the whole batch runs in the effects worker, one upload. GPU work never waits on the main thread's JS.
- **Previous frame.** `needsPrevFrame` binds the last rendered output as `u_prevFrame` (feedback effects).
- **History rings.** `historyFrames(params)` gives an effect its own ring of up to 16 past *input* frames in a `TEXTURE_2D_ARRAY`, read through `historyFrame(age)` from `HISTORY_GLSL` (age 0 = this frame). Rings are per effect instance (stacked trails don't interfere) and freed after 120 unused frames.
- **Orientation.** All GPU passes use `u_flipY = -1`; the final blit corrects orientation, and CPU readbacks are flipped so processors always see row 0 as the image top.

## CPU processors

Processors receive `(data: Uint8ClampedArray, config, params)` with `config = { width, height, time, mediaTime, faceBounds, timelineFrames, … }` and mutate `data`. `params` already has defaults merged in. `time` is the render tick (it also advances on paused re-renders); `mediaTime` is the frame's timeline time in seconds (undefined for the webcam). Stateful effects should key their state off `mediaTime`, so that an unchanged time (a paused re-render) holds the frame and a jump (seek, loop, export start, effect window start) resets it. Datamosh (`processors/datamosh/datamosh.ts`) is the reference implementation.

- **The worker.** CPU batches run in one persistent worker (`worker-pool.ts`). It's deliberately a single worker: stateful effects keep their cross-frame state in module memory, and every frame must reach the same copy. That includes frames with `timelineFrames` (the other clips active during an overlap), which are cloned over rather than run inline, so a stateful effect never ends up with two copies of its state.
- **Scratch buffers.** Per-frame temporaries use `scratchCopy(data, "<effect>/<name>")` and `scratchFloats(length, key)` from `shared.ts`, which reuse a buffer per call site instead of allocating megabytes per frame. Never keep a scratch buffer across frames — allocate state you need to keep.
- **Datamosh** is CPU-only on purpose: block matching on a quarter-res luma copy, then a block warp of its previous output plus a residual. It runs in the worker at roughly 30 ms per 1080p frame. A GPU port needs compute shaders (see the roadmap).
- **Frame history.** `storeFrame` / `getFrameFromHistory` (`shared.ts`) keep the CPU-path history; buffers are recycled once the ring is full.

## Animation inference

On a still image the engine only keeps rendering if some active effect changes over time. `isAnimatedEffectType` (`lib/engine/effect-traits.ts`) decides: `animated` if set; else the shader uses `u_time` or `needsPrevFrame`; else the CPU processor's source mentions `time`, `Math.random`, `performance.now`, `Date.now`, `prevFrame` or `history`. Set `animated` explicitly if that guess is wrong for your effect.

## Face effects

`face-detector.ts` lazily loads MediaPipe's face landmarker. The engine runs detection only while a face effect is active — every 10th frame for video/camera, once per still image — and passes the results as `config.faceBounds`.

## Guards

- `params-config.test.ts` — every user-facing param has a control; slider defaults are in range; configs only reference real params.
- `engine.test.ts` — animation inference on known effects.
- `npm run check:shaders` — compiles and links every shader in a real WebGL2 context.
