import { registerEffect } from "../../effect-registry";
import { clamp, scratchCopy } from "../shared";

registerEffect({
  type: "displacement",
  label: "Displacement",
  category: "distortion",
  defaultParams: { scale: 20, animated: true },
  paramsConfig: [
    { key: "scale", label: "Scale", type: "slider", min: 0, max: 100, default: 20 },
    { key: "animated", label: "Animated", type: "checkbox", default: true },
  ],
  glsl: {
    fragment: `
uniform float u_scale;
uniform bool u_animated;
void main() {
  vec4 s = texture(u_source, v_texCoord);
  float lum = (s.r + s.g + s.b) / 3.0 - 0.5;
  float wave = u_animated ? sin(u_time * 0.05 + v_texCoord.y * u_resolution.y * 0.05) * u_scale * 0.3 : 0.0;
  float offsetX = (lum * u_scale + wave) / u_resolution.x;
  fragColor = sampleClamped(vec2(v_texCoord.x + offsetX, v_texCoord.y));
}`,
    uniforms: { scale: "float", animated: "bool" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const scale = (params.scale as number) ?? 20;
    const animated = (params.animated as boolean) ?? true;

    const source = scratchCopy(data, "displacement/source");

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const lum = (source[i] + source[i + 1] + source[i + 2]) / 3 / 255;

        let wave = 0;
        if (animated) {
          wave = Math.sin(time * 0.05 + y * 0.05) * (scale * 0.3);
        }

        const offsetX = Math.floor((lum - 0.5) * scale + wave);
        const srcX = clamp(x + offsetX, 0, width - 1);

        const src = (y * width + srcX) * 4;
        data[i] = source[src];
        data[i + 1] = source[src + 1];
        data[i + 2] = source[src + 2];
      }
    }
  },
});
