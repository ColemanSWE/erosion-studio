import { registerEffect } from "../../effect-registry";
import { scratchCopy } from "../shared";

registerEffect({
  type: "screen-tear",
  label: "Screen Tear",
  category: "glitch",
  defaultParams: { intensity: 50, count: 3, offset: 20 },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 100, default: 50 },
    { key: "count", label: "Tears", type: "slider", min: 1, max: 12, default: 3 },
    { key: "offset", label: "Offset", type: "slider", min: 0, max: 100, default: 20 },
  ],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform float u_count;
uniform float u_offset;
void main() {
  float seed = floor(u_time * 3.0);
  float numTears = u_count + floor(pseudoRandom(seed) * u_count * (u_intensity / 30.0));
  float maxOff = u_offset * (u_intensity / 30.0);
  float py = v_texCoord.y * u_resolution.y;
  vec2 uv = v_texCoord;
  for (int t = 0; t < 20; t++) {
    if (float(t) >= numTears) break;
    float tearY = floor(pseudoRandom(seed + float(t) * 100.0) * u_resolution.y);
    float tearH = floor(1.0 + pseudoRandom(seed + float(t) * 200.0) * 40.0 * (u_intensity / 50.0));
    if (py >= tearY && py < tearY + tearH) {
      float tearOff = (pseudoRandom(seed + float(t) * 300.0) - 0.5) * maxOff * 4.0;
      float newX = mod(v_texCoord.x * u_resolution.x + tearOff + u_resolution.x, u_resolution.x);
      uv = vec2(newX / u_resolution.x, v_texCoord.y);
      break;
    }
  }
  fragColor = texture(u_source, uv);
}`,
    uniforms: { intensity: "float", count: "float", offset: "float" },
  },
  processor: (data, { width, height }, params) => {
    const intensity = (params.intensity as number) ?? 50;
    const count = (params.count as number) ?? 3;
    const offset = (params.offset as number) ?? 20;
    if (intensity === 0) return;

    const source = scratchCopy(data, "screen-tear/source");
    const _chaos = Date.now() % 10000;
    const numTears = Math.floor(
      count + Math.random() * count * (intensity / 30),
    );
    const maxOffset = offset * (intensity / 30);

    for (let t = 0; t < numTears; t++) {
      const tearY = Math.floor(Math.random() * height);
      const tearHeight = Math.floor(
        1 + Math.random() * Math.random() * 40 * (intensity / 50),
      );
      const tearOffset = Math.floor((Math.random() - 0.5) * maxOffset * 4);
      const channelOffset =
        Math.random() > 0.7 ? Math.floor(Math.random() * 3) : -1;
      const smearChance = Math.random();
      const repeatPixel = Math.random() > 0.8;

      for (let y = tearY; y < Math.min(tearY + tearHeight, height); y++) {
        const rowOffset =
          tearOffset +
          (repeatPixel ? 0 : Math.floor((Math.random() - 0.5) * 10));
        let lastPixel = [0, 0, 0];

        for (let x = 0; x < width; x++) {
          const dstIdx = (y * width + x) * 4;

          if (smearChance > 0.85 && x > 0) {
            data[dstIdx] = lastPixel[0];
            data[dstIdx + 1] = lastPixel[1];
            data[dstIdx + 2] = lastPixel[2];
          } else {
            const srcX = (((x + rowOffset) % width) + width) % width;
            const srcIdx = (y * width + srcX) * 4;

            if (channelOffset >= 0) {
              const shiftedX = (((x + rowOffset + 15) % width) + width) % width;
              const shiftedIdx = (y * width + shiftedX) * 4;
              data[dstIdx] =
                channelOffset === 0 ? source[shiftedIdx] : source[srcIdx];
              data[dstIdx + 1] =
                channelOffset === 1
                  ? source[shiftedIdx + 1]
                  : source[srcIdx + 1];
              data[dstIdx + 2] =
                channelOffset === 2
                  ? source[shiftedIdx + 2]
                  : source[srcIdx + 2];
            } else {
              data[dstIdx] = source[srcIdx];
              data[dstIdx + 1] = source[srcIdx + 1];
              data[dstIdx + 2] = source[srcIdx + 2];
            }

            lastPixel = [data[dstIdx], data[dstIdx + 1], data[dstIdx + 2]];
          }
        }
      }
    }
  },
});
