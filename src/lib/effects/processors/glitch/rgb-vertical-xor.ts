import { registerEffect } from "../../effect-registry";
import { scratchCopy } from "../shared";

registerEffect({
  type: "rgb-vertical-xor",
  label: "RGB Vertical XOR",
  category: "glitch",
  defaultParams: { speed: 2, amplitude: 1.0 },
  paramsConfig: [
    { key: "speed", label: "Speed", type: "slider", min: 0, max: 10, step: 0.1, default: 2 },
    { key: "amplitude", label: "Amplitude", type: "slider", min: 0, max: 3, step: 0.1, default: 1 },
  ],
  glsl: {
    fragment: `
uniform float u_speed;
uniform float u_amplitude;
void main() {
  float t = u_time * u_speed * 0.1;
  float y = v_texCoord.y * u_resolution.y;
  float offR = sin(y * 0.1 + t) * 10.0 * u_amplitude / u_resolution.x;
  float offG = sin(y * 0.1 + t + 2.094) * 10.0 * u_amplitude / u_resolution.x;
  float offB = sin(y * 0.1 + t + 4.189) * 10.0 * u_amplitude / u_resolution.x;
  float r = sampleClamped(vec2(v_texCoord.x + offR, v_texCoord.y)).r;
  float g = sampleClamped(vec2(v_texCoord.x + offG, v_texCoord.y)).g;
  float b = sampleClamped(vec2(v_texCoord.x + offB, v_texCoord.y)).b;
  fragColor = vec4(r, g, b, 1.0);
}`,
    uniforms: { speed: "float", amplitude: "float" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const speed = (params.speed as number) ?? 2;
    const amplitude = (params.amplitude as number) ?? 1.0;

    const source = scratchCopy(data, "rgb-vertical-xor/source");
    const t = time * speed * 0.1;

    for (let y = 0; y < height; y++) {
      const offsetR = Math.floor(Math.sin(y * 0.1 + t) * 10 * amplitude);
      const offsetG = Math.floor(
        Math.sin(y * 0.1 + t + Math.PI * 0.666) * 10 * amplitude,
      );
      const offsetB = Math.floor(
        Math.sin(y * 0.1 + t + Math.PI * 1.333) * 10 * amplitude,
      );

      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        const xR = (x + offsetR + width) % width;
        const xG = (x + offsetG + width) % width;
        const xB = (x + offsetB + width) % width;

        const iR = (y * width + xR) * 4;
        const iG = (y * width + xG) * 4;
        const iB = (y * width + xB) * 4;

        data[i] = source[i] ^ source[iR];
        data[i + 1] = source[i + 1] ^ source[iG + 1];
        data[i + 2] = source[i + 2] ^ source[iB + 2];
      }
    }
  },
});
