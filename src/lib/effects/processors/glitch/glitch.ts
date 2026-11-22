import { registerEffect } from "../../effect-registry";
import { pseudoRandom, scratchCopy } from "../shared";

registerEffect({
  type: "glitch",
  label: "Digital Glitch",
  category: "glitch",
  defaultParams: { intensity: 50, speed: 10 },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 100, default: 50 },
    { key: "speed", label: "Speed", type: "slider", min: 0, max: 30, default: 10 },
  ],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform float u_speed;
void main() {
  if (u_intensity == 0.0) { fragColor = texture(u_source, v_texCoord); return; }
  float t = u_time * (u_speed / 10.0);
  float seed = floor(t / 5.0);
  int numSlices = int(floor(3.0 + u_intensity / 20.0));
  vec2 uv = v_texCoord;
  float py = floor(uv.y * u_resolution.y);
  int channelShiftApplied = -1;
  float shiftXApplied = 0.0;
  for (int s = 0; s < 10; s++) {
    if (s >= numSlices) break;
    float sliceY = floor(pseudoRandom(seed + float(s) * 1000.0) * u_resolution.y);
    float sliceH = floor(2.0 + pseudoRandom(seed + float(s) * 2000.0) * (u_intensity / 3.0));
    if (py >= sliceY && py < sliceY + sliceH) {
      shiftXApplied = floor((pseudoRandom(seed + float(s) * 3000.0) - 0.5) * u_intensity * 2.0);
      channelShiftApplied = int(floor(pseudoRandom(seed + float(s) * 4000.0) * 3.0));
      break;
    }
  }
  float shiftUV = shiftXApplied / u_resolution.x;
  vec4 original = texture(u_source, uv);
  if (channelShiftApplied == 0) {
    float r = sampleClamped(vec2(uv.x + shiftUV, uv.y)).r;
    fragColor = vec4(r, original.g, original.b, original.a);
  } else if (channelShiftApplied == 1) {
    float g = sampleClamped(vec2(uv.x + shiftUV, uv.y)).g;
    fragColor = vec4(original.r, g, original.b, original.a);
  } else if (channelShiftApplied == 2) {
    float b = sampleClamped(vec2(uv.x + shiftUV, uv.y)).b;
    fragColor = vec4(original.r, original.g, b, original.a);
  } else {
    fragColor = original;
  }
}`,
    uniforms: { intensity: "float", speed: "float" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) ?? 50;
    const speed = (params.speed as number) ?? 10;
    if (intensity === 0) return;

    const source = scratchCopy(data, "glitch/source");
    const t = time * (speed / 10);
    const seed = Math.floor(t / 5);

    const numSlices = Math.floor(3 + intensity / 20);
    for (let s = 0; s < numSlices; s++) {
      const sliceY = Math.floor(pseudoRandom(seed + s * 1000) * height);
      const sliceHeight = Math.floor(
        2 + pseudoRandom(seed + s * 2000) * (intensity / 3),
      );
      const shiftX = Math.floor(
        (pseudoRandom(seed + s * 3000) - 0.5) * (intensity * 2),
      );
      const channelShift = Math.floor(pseudoRandom(seed + s * 4000) * 3);

      for (let y = sliceY; y < Math.min(sliceY + sliceHeight, height); y++) {
        for (let x = 0; x < width; x++) {
          const srcX = (((x - shiftX) % width) + width) % width;
          const srcIdx = (y * width + srcX) * 4;
          const dstIdx = (y * width + x) * 4;

          if (channelShift === 0) {
            data[dstIdx] = source[srcIdx];
            data[dstIdx + 1] = source[(y * width + x) * 4 + 1];
            data[dstIdx + 2] = source[(y * width + x) * 4 + 2];
          } else if (channelShift === 1) {
            data[dstIdx] = source[(y * width + x) * 4];
            data[dstIdx + 1] = source[srcIdx + 1];
            data[dstIdx + 2] = source[(y * width + x) * 4 + 2];
          } else {
            data[dstIdx] = source[(y * width + x) * 4];
            data[dstIdx + 1] = source[(y * width + x) * 4 + 1];
            data[dstIdx + 2] = source[srcIdx + 2];
          }
        }
      }
    }

    if (intensity > 30) {
      const corruptLines = Math.floor(intensity / 20);
      for (let c = 0; c < corruptLines; c++) {
        const y = Math.floor(pseudoRandom(seed + c * 5000 + t) * height);
        const corruptType = Math.floor(pseudoRandom(seed + c * 6000) * 3);

        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          if (corruptType === 0) {
            data[i] =
              data[i + 1] =
              data[i + 2] =
                pseudoRandom(seed + x) > 0.5 ? 255 : 0;
          } else if (corruptType === 1) {
            const repeat =
              data[(y * width + Math.floor(x / 8) * 8) * 4 + (x % 3)];
            data[i] = data[i + 1] = data[i + 2] = repeat;
          } else {
            data[i + Math.floor(pseudoRandom(seed + x) * 3)] = 255;
          }
        }
      }
    }
  },
});
