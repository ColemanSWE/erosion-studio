import { registerEffect } from "../../effect-registry";
import { scratchCopy } from "../shared";

registerEffect({
  type: "fragment-glitch",
  label: "Fragment Glitch",
  category: "glitch",
  defaultParams: { intensity: 50, fragmentSize: 8 },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 100, default: 50 },
    { key: "fragmentSize", label: "Fragment Size", type: "slider", min: 2, max: 64, default: 8 },
  ],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform float u_fragmentSize;
void main() {
  float seed = floor(u_time * 0.5);
  float fsize = u_fragmentSize;
  float bx = floor(v_texCoord.x * u_resolution.x / fsize);
  float by = floor(v_texCoord.y * u_resolution.y / fsize);
  float blockId = bx + by * ceil(u_resolution.x / fsize);
  vec2 lxy = vec2(
    mod(v_texCoord.x * u_resolution.x, fsize),
    mod(v_texCoord.y * u_resolution.y, fsize)
  );
  float corruptProb = (u_intensity / 100.0) * 0.6;
  if (pseudoRandom(seed + blockId * 2.9) < corruptProb) {
    float effect = pseudoRandom(seed + blockId * 5.1);
    if (effect < 0.3) {
      float srcBx = floor(pseudoRandom(seed + blockId * 7.3) * ceil(u_resolution.x / fsize));
      float srcBy = floor(pseudoRandom(seed + blockId * 8.7) * ceil(u_resolution.y / fsize));
      vec2 srcUV = (vec2(srcBx, srcBy) * fsize + lxy) / u_resolution;
      fragColor = sampleClamped(srcUV);
    } else if (effect < 0.5) {
      int channel = int(floor(pseudoRandom(seed + blockId * 9.1) * 3.0));
      float val = pseudoRandom(seed + blockId * 11.3) > 0.5 ? 1.0 : 0.0;
      vec4 c = texture(u_source, v_texCoord);
      if (channel == 0) c.r = val;
      else if (channel == 1) c.g = val;
      else c.b = val;
      fragColor = c;
    } else if (effect < 0.85) {
      float repeatX = pseudoRandom(seed + blockId * 13.7) * u_resolution.x;
      float repeatY = pseudoRandom(seed + blockId * 17.1) * u_resolution.y;
      fragColor = texture(u_source, vec2(repeatX, repeatY) / u_resolution);
    } else {
      vec4 c = texture(u_source, v_texCoord);
      fragColor = vec4(1.0 - c.rgb, c.a);
    }
  } else {
    fragColor = texture(u_source, v_texCoord);
  }
}`,
    uniforms: { intensity: "float", fragmentSize: "float" },
  },
  processor: (data, { width, height }, params) => {
    const intensity = (params.intensity as number) ?? 50;
    const fragmentSize = (params.fragmentSize as number) ?? 8;
    if (intensity === 0) return;

    const source = scratchCopy(data, "fragment-glitch/source");
    const numPasses = Math.ceil(intensity / 25);

    for (let pass = 0; pass < numPasses; pass++) {
      const numFragments = Math.floor(
        50 + Math.random() * 100 * (intensity / 50),
      );

      for (let f = 0; f < numFragments; f++) {
        const size = Math.floor(fragmentSize * (0.5 + Math.random() * 2));
        const fx = Math.floor(Math.random() * (width - size));
        const fy = Math.floor(Math.random() * (height - size));

        const effect = Math.random();

        if (effect < 0.3) {
          const srcFx = Math.floor(Math.random() * (width - size));
          const srcFy = Math.floor(Math.random() * (height - size));
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              if (
                fy + y < height &&
                fx + x < width &&
                srcFy + y < height &&
                srcFx + x < width
              ) {
                const srcIdx = ((srcFy + y) * width + (srcFx + x)) * 4;
                const dstIdx = ((fy + y) * width + (fx + x)) * 4;
                data[dstIdx] = source[srcIdx];
                data[dstIdx + 1] = source[srcIdx + 1];
                data[dstIdx + 2] = source[srcIdx + 2];
              }
            }
          }
        } else if (effect < 0.5) {
          const channel = Math.floor(Math.random() * 3);
          const val = Math.random() > 0.5 ? 255 : 0;
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              if (fy + y < height && fx + x < width) {
                const idx = ((fy + y) * width + (fx + x)) * 4;
                data[idx + channel] = val;
              }
            }
          }
        } else if (effect < 0.7) {
          for (let y = 0; y < size; y++) {
            const srcY = Math.floor(Math.random() * height);
            for (let x = 0; x < size; x++) {
              if (fy + y < height && fx + x < width) {
                const srcIdx = (srcY * width + ((fx + x) % width)) * 4;
                const dstIdx = ((fy + y) * width + (fx + x)) * 4;
                data[dstIdx] = source[srcIdx];
                data[dstIdx + 1] = source[srcIdx + 1];
                data[dstIdx + 2] = source[srcIdx + 2];
              }
            }
          }
        } else if (effect < 0.85) {
          const repeatX = Math.floor(Math.random() * width);
          const repeatY = Math.floor(Math.random() * height);
          const srcIdx = (repeatY * width + repeatX) * 4;
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              if (fy + y < height && fx + x < width) {
                const dstIdx = ((fy + y) * width + (fx + x)) * 4;
                data[dstIdx] = source[srcIdx];
                data[dstIdx + 1] = source[srcIdx + 1];
                data[dstIdx + 2] = source[srcIdx + 2];
              }
            }
          }
        } else {
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              if (fy + y < height && fx + x < width) {
                const idx = ((fy + y) * width + (fx + x)) * 4;
                data[idx] = data[idx] ^ 0xff;
                data[idx + 1] = data[idx + 1] ^ 0xff;
                data[idx + 2] = data[idx + 2] ^ 0xff;
              }
            }
          }
        }
      }
    }
  },
});
