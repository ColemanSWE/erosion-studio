# Adding an Effect

An effect is one file. This walks through a GPU-accelerated effect with a CPU fallback.

## 1. Register the type

Add the id to the `EffectType` union in `src/lib/effects/types.ts`:

```ts
  | "posterize-glow"
```

## 2. Create the file

Put it in the group that fits best, e.g. `src/lib/effects/processors/color/posterize-glow.ts`:

```ts
import { registerEffect } from "../../effect-registry";
import { clamp } from "../shared";

registerEffect({
  type: "posterize-glow",
  label: "Posterize Glow",
  category: "color",
  defaultParams: { levels: 6, glow: 0.4 },
  paramsConfig: [
    { key: "levels", label: "Levels", type: "slider", min: 2, max: 16, step: 1, default: 6 },
    { key: "glow", label: "Glow", type: "slider", min: 0, max: 1, step: 0.01, default: 0.4 },
  ],

  // GPU path. The preamble provides u_source, u_resolution, u_time, v_texCoord,
  // fragColor and helpers (pseudoRandom, hash2, perlinNoise, rgbToHsl, …).
  // Each key in `uniforms` is bound from params as u_<key>.
  glsl: {
    fragment: `
uniform float u_levels;
uniform float u_glow;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  vec3 p = floor(c.rgb * u_levels) / (u_levels - 1.0);
  fragColor = vec4(mix(p, p * p * 2.0, u_glow), c.a);
}`,
    uniforms: { levels: "float", glow: "float" },
  },

  // CPU path: used without WebGL2, inside regions on the CPU path, and in tests.
  // Mutate `data` (RGBA, row 0 = top) in place. `params` has defaults merged in.
  processor: (data, _config, params) => {
    const levels = params.levels as number;
    const glow = params.glow as number;
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const p = (Math.floor((data[i + c] / 255) * levels) / (levels - 1)) * 255;
        data[i + c] = clamp(p + ((p * p) / 255 * 2 - p) * glow, 0, 255);
      }
    }
  },
});
```

## 3. Import it

Add a line to the group's `index.ts` (order = registration order):

```ts
import "./posterize-glow";
```

## 4. Check it

```bash
npm test               # params have controls, slider defaults in range
npm run check:shaders  # your GLSL compiles in real WebGL2
npm run dev            # try it on a video, a still image and the camera
```

## Options worth knowing

| Field | Use it when |
| --- | --- |
| `glsl.uniformMapper(params)` | uniform values differ from params (scaling, string → int for selects) |
| `glsl.skipGL(params)` | some param values need the CPU path (e.g. a mode the shader can't do) |
| `glsl.multiPass(resolution, params)` | the effect needs N passes; read `u_pass` in the shader |
| `glsl.needsPrevFrame` | sample last frame's *output* as `u_prevFrame` (feedback) |
| `glsl.historyFrames(params)` | sample N past *input* frames: prepend `HISTORY_GLSL` and call `historyFrame(age)`; check `age < u_historyCount` |
| `animated` | the automatic still-image animation guess is wrong |
| `experimental` | slow or unfinished; hidden behind "Show experimental effects" |

Select params map to strings in `params`; GLSL has no strings, so map them in `uniformMapper`:

```ts
uniforms: { mode: "int" },
uniformMapper: (p) => ({ ...p, mode: p.mode === "soft" ? 0 : 1 }),
```

## CPU performance rules

- No full-frame allocations per frame. For temporaries use `scratchCopy(data, "<type>/<name>")` or `scratchFloats(width * height, "<type>/<name>")`.
- State that must survive between frames (previous frames, particles) is module-level and keyed by size; reset it when `width`/`height` change.
- CPU-only effects run in the effects worker: no DOM access except `document.createElement("canvas")` (an `OffscreenCanvas` there).
- Prefer a GLSL path. A CPU effect in a GPU chain costs a full readback and upload per frame.
