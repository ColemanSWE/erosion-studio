# Effects System

## Overview

The effects system processes `Uint8ClampedArray` pixel buffers through a stack of registered effects. Every effect is pure data: a registry entry with a CPU processor function, optional GLSL shader, and default parameters. The renderer (`effects-renderer.ts`) decides whether to use the GL pipeline or the CPU path, and handles compositing.

## Architecture

```
effects-renderer.ts        orchestrates everything
├── effect-registry.ts     holds the Map of all registered effects
├── gl/pipeline.ts         WebGL2 FBO ping-pong for GPU effects
├── gl/shaders.ts          GLSL preamble, vertex shader, utilities
├── processors/            one file per category, each calls registerEffect()
│   ├── index.ts           imports all processor files (side-effect only)
│   ├── glitch.ts          glitch, pixel-sort, rgb-split, datamosh, …
│   ├── distortion.ts      chromatic aberration, wave, melt, perlin, …
│   ├── color.ts           invert, vignette, bloom, duotone, …
│   ├── retro.ts           VHS, scanlines, CRT, dither, …
│   ├── noise.ts           film grain, noise
│   ├── style.ts           blob-track, detection labels, pixelate, emoji, …
│   ├── face.ts            face-aware effects using MediaPipe landmarks
│   ├── standard.ts        standard utility effects
│   ├── creative.ts        creative / experimental effects
│   ├── experimental.ts    slit-scan, droste, …
│   └── shared.ts          shared state, math helpers, frame history
├── worker-pool.ts         Web Worker wrapper for CPU effects
├── effects-worker.ts      Worker entry point (runs applyEffects off-thread)
├── renderers.ts           style-effect renderers (pixelate, emoji, ascii, …)
├── mesh-renderer.ts       Three.js 3D-mesh effect renderer
├── emoji-map.ts           emoji palette bitmap cache
└── face-detector.ts       MediaPipe face/hand/pose detection
```

## Registering an Effect

Every effect is registered with `registerEffect()` from `effect-registry.ts`. The minimal shape:

```ts
registerEffect({
  type: "my-effect", // must match EffectType union in types.ts
  label: "My Effect",
  category: "glitch", // "glitch" | "distortion" | "color" | "retro" | "noise" | "style" | "face" | "standard"
  defaultParams: { intensity: 50 },
  paramsConfig: [
    {
      key: "intensity",
      label: "Intensity",
      type: "slider",
      min: 0,
      max: 100,
      step: 1,
    },
  ],
  processor: (data, { width, height, time }, params) => {
    // mutate data in-place
  },
});
```

To add a GPU path, add a `glsl` property:

```ts
  glsl: {
    fragment: `
uniform float u_intensity;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  fragColor = mix(c, vec4(1.0 - c.rgb, c.a), u_intensity / 100.0);
}`,
    uniforms: { intensity: "float" },
  },
```

The fragment shader automatically gets the preamble from `shaders.ts` which includes `u_source`, `u_resolution`, `u_time`, `v_texCoord`, and helpers like `pseudoRandom`, `perlinNoise`, `sampleClamped`.

When a `uniformMapper` is provided, it transforms the raw `params` object before binding uniforms. Use this when param names or scales differ between the CPU and GPU paths:

```ts
  glsl: {
    fragment: `...`,
    uniforms: { speed: "float" },
    uniformMapper: (p) => ({ speed: (p.speed as number) / 100.0 }),
  },
```

To add a new `EffectType`, add it to the union in `src/lib/effects/types.ts`.

## Processing Pipeline

### Render entry point

`renderWithEffects(context, effects, regions?, overlays?)` in `effects-renderer.ts` is the single entry point called every frame by the hooks (`useVideoPlayer`, `usePhotoEditor`, `useCameraPlayer`).

### Effect splitting

Effects are split into three buckets each frame:

| Bucket          | Condition                             | Processed by                                 |
| --------------- | ------------------------------------- | -------------------------------------------- |
| `globalEffects` | active, no `regionId`, no `overlayId` | Applied to the full frame                    |
| `regionEffects` | active, has `regionId`                | Applied only inside a user-drawn region      |
| overlay effects | active, has `overlayId`               | Applied inside an overlay with alpha masking |

### GL path (fast)

When `GLPipeline` is available and there are no overlay masks, all effects route through WebGL2:

1. Source frame uploaded to a texture via `texImage2D` / `texSubImage2D`
2. Each effect with a `glsl` shader runs as a full-screen FBO pass (ping-pong between two FBOs)
3. Effects without `glsl` fall back to CPU: `readPixels` → CPU processor → `texSubImage2D` upload
4. Region effects run with `gl.scissor` so pixels outside the region are untouched
5. Final FBO blit to the display canvas

### CPU path (fallback)

Used when `GLPipeline` is unavailable or overlay masks are present:

1. `drawImage(source)` into an offscreen buffer canvas
2. `getImageData` → `applyEffects(data, globalEffects)` → `putImageData`
3. For each region: `getImageData(rx, ry, rw, rh)` → `applyEffects` → `putImageData`
4. For overlay effects: extract region, apply effects, composite back with `destination-in` masking

### Worker path

When global effects are running on the CPU path and there are no timeline frames, the pixel buffer is transferred (zero-copy) to a Web Worker. The worker runs `applyEffects`, then transfers the result back. This keeps the main thread free during the CPU processing.

### Style effects

Effects in the "style" category that have a dedicated visual renderer (pixelate, emoji, ascii, matrix, halftone, 3d-mesh) bypass the pixel processor path. Instead:

1. Pre-style effects (all active non-style effects before the style effect in the stack) are applied first
2. The style renderer runs (downsample, render character grid or mesh, etc.)
3. Post-style effects are applied to the output

The 3D mesh effect uses a separate Three.js `WebGLRenderer` (`mesh-renderer.ts`) and is not part of the FBO pipeline.

## Shared State and Caching

`processors/shared.ts` holds cross-frame state used by temporal effects:

- `motionSmearState`, `datamoshState`, `blockShovingState` — previous-frame buffers for motion effects
- `meltState` — persistent melt columns keyed by `"WxH"` (max 3 entries, LRU-evicted)
- `posterizeTimeCache` — cached frozen frames for posterize-time keyed by `"WxH"` (max 3 entries)
- `frameHistoryStore` — rolling buffer of the last 16 frames for temporal effects
- `storeFrame` / `getFrameFromHistory` — helpers to write/read frame history

## Performance Notes

- All `Uint8ClampedArray` allocations in hot effects (pixel-sort, GL pipeline readback) use module-level pools that are reused when dimensions match
- Blob-track detection (connected-component labeling) runs at most every 3 frames; intermediate frames reuse the last detected blob positions
- The region effects temp canvas is cached at module level rather than created each frame
- GL pipeline CPU-fallback buffers (`cpuBufFull`, `cpuBufRegion`) are preallocated on the pipeline instance
