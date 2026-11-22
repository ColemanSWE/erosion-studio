import { registerEffect } from "../../effect-registry";
import { meltState, setMeltState, scratchCopy } from "../shared";

registerEffect({
  type: "melt",
  label: "Melt",
  category: "distortion",
  defaultParams: { intensity: 50, direction: "down" },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 100, default: 50 },
    { key: "direction", label: "Direction", type: "select", options: ["down", "up"], default: "down" },
  ],
  glsl: {
    needsPrevFrame: true,
    uniforms: { intensity: "float", dirMode: "int" },
    uniformMapper: (params) => ({
      intensity: params.intensity,
      dirMode: (params.direction as string) === "up" ? 1 : 0,
    }),
    fragment: `
uniform float u_intensity;
uniform int u_dirMode;
uniform sampler2D u_prevFrame;

void main() {
  if (u_intensity == 0.0) {
    fragColor = texture(u_source, v_texCoord);
    return;
  }

  float meltSpeed = u_intensity / 20.0;
  float colFrac = v_texCoord.x;
  float colNoise = sin(colFrac * u_resolution.x * 0.1 + u_time) * 0.5 + 0.5;
  float randN = pseudoRandom(colFrac * 137.5 + floor(u_time * 60.0) * 0.001);
  float meltAmt = (meltSpeed * (1.0 + colNoise * 2.0) + randN * 3.0) / u_resolution.y;

  vec2 meltUV = u_dirMode == 0
    ? v_texCoord - vec2(0.0, meltAmt)
    : v_texCoord + vec2(0.0, meltAmt);

  vec3 cur  = texture(u_source,   v_texCoord).rgb;
  vec3 melt = texture(u_prevFrame, clamp(meltUV, vec2(0.0), vec2(1.0))).rgb;

  float blend = 0.7 + pseudoRandom(v_texCoord.x * 234.5 + v_texCoord.y * 78.9 + u_time * 0.01) * 0.3;
  fragColor = vec4(mix(cur, melt, blend), 1.0);
}`,
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) ?? 50;
    const direction = (params.direction as string) ?? "down";
    if (intensity === 0) return;

    const key = `${width}x${height}`;
    let meltBuffer = meltState.get(key);

    if (!meltBuffer || meltBuffer.length !== data.length) {
      meltBuffer = new Uint8ClampedArray(data);
      setMeltState(key, meltBuffer);
    }

    const source = scratchCopy(data, "melt/source");
    const meltSpeed = intensity / 20;
    const drip = intensity / 100;

    for (let x = 0; x < width; x++) {
      const columnNoise = Math.sin(x * 0.1 + time) * 0.5 + 0.5;
      const meltAmount = Math.floor(
        meltSpeed * (1 + columnNoise * 2) + Math.random() * 3
      );

      if (direction === "down") {
        for (let y = height - 1; y >= meltAmount; y--) {
          const dstIdx = (y * width + x) * 4;
          const srcY = y - meltAmount;
          const srcIdx = (srcY * width + x) * 4;

          const blend = 0.7 + Math.random() * 0.3;
          data[dstIdx] =
            meltBuffer[srcIdx] * blend + source[dstIdx] * (1 - blend);
          data[dstIdx + 1] =
            meltBuffer[srcIdx + 1] * blend + source[dstIdx + 1] * (1 - blend);
          data[dstIdx + 2] =
            meltBuffer[srcIdx + 2] * blend + source[dstIdx + 2] * (1 - blend);
        }

        for (let y = 0; y < meltAmount && y < height; y++) {
          const idx = (y * width + x) * 4;
          const blend = 0.3 + Math.random() * 0.4;
          data[idx] = source[idx] * blend + meltBuffer[idx] * (1 - blend);
          data[idx + 1] =
            source[idx + 1] * blend + meltBuffer[idx + 1] * (1 - blend);
          data[idx + 2] =
            source[idx + 2] * blend + meltBuffer[idx + 2] * (1 - blend);
        }
      } else {
        for (let y = 0; y < height - meltAmount; y++) {
          const dstIdx = (y * width + x) * 4;
          const srcY = y + meltAmount;
          const srcIdx = (srcY * width + x) * 4;

          const blend = 0.7 + Math.random() * 0.3;
          data[dstIdx] =
            meltBuffer[srcIdx] * blend + source[dstIdx] * (1 - blend);
          data[dstIdx + 1] =
            meltBuffer[srcIdx + 1] * blend + source[dstIdx + 1] * (1 - blend);
          data[dstIdx + 2] =
            meltBuffer[srcIdx + 2] * blend + source[dstIdx + 2] * (1 - blend);
        }
      }
    }

    if (Math.random() < drip) {
      const dripX = Math.floor(Math.random() * width);
      const dripLen = Math.floor(20 + Math.random() * 100);
      const dripColor = [
        data[(Math.floor(Math.random() * height) * width + dripX) * 4],
        data[(Math.floor(Math.random() * height) * width + dripX) * 4 + 1],
        data[(Math.floor(Math.random() * height) * width + dripX) * 4 + 2],
      ];

      const startY = direction === "down" ? 0 : height - 1;
      for (let i = 0; i < dripLen; i++) {
        const y = direction === "down" ? startY + i : startY - i;
        if (y >= 0 && y < height) {
          const idx = (y * width + dripX) * 4;
          const fade = 1 - (i / dripLen) * 0.5;
          data[idx] = dripColor[0] * fade;
          data[idx + 1] = dripColor[1] * fade;
          data[idx + 2] = dripColor[2] * fade;
        }
      }
    }

    for (let i = 0; i < data.length; i++) {
      meltBuffer[i] = data[i];
    }
  },
});
