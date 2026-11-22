import { registerEffect } from "../../effect-registry";
import { pseudoRandom, scratchCopy } from "../shared";

registerEffect({
  type: "line-massacre",
  label: "Line Massacre",
  category: "glitch",
  defaultParams: { intensity: 60, colorFill: 30, speed: 5 },
  paramsConfig: [
    {
      key: "intensity",
      label: "Intensity",
      type: "slider",
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: "colorFill",
      label: "Color Fill",
      type: "slider",
      min: 0,
      max: 100,
      step: 1,
    },
    { key: "speed", label: "Speed", type: "slider", min: 1, max: 20, step: 1 },
  ],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform float u_colorFill;
uniform float u_speed;

vec3 neonPalette(float idx) {
  int i = int(mod(idx * 6.0, 6.0));
  if (i == 0) return vec3(1.0, 0.0, 0.0);
  if (i == 1) return vec3(0.0, 1.0, 0.0);
  if (i == 2) return vec3(0.0, 0.0, 1.0);
  if (i == 3) return vec3(0.0, 1.0, 1.0);
  if (i == 4) return vec3(1.0, 0.0, 1.0);
  return vec3(1.0, 1.0, 0.0);
}

void main() {
  if (u_intensity == 0.0) { fragColor = texture(u_source, v_texCoord); return; }
  float seed = floor(u_time * u_speed);
  float py = v_texCoord.y;
  float rowHash = pseudoRandom(seed + floor(py * u_resolution.y) * 7.3);
  float affectThresh = u_intensity / 100.0 * 0.7;

  if (rowHash < affectThresh) {
    float fillHash = pseudoRandom(seed + floor(py * u_resolution.y) * 13.1);
    if (fillHash < u_colorFill / 100.0) {
      fragColor = vec4(neonPalette(pseudoRandom(seed + floor(py * u_resolution.y) * 31.7)), 1.0);
      return;
    }
    float dispR = (pseudoRandom(seed + floor(py * u_resolution.y) * 17.3) - 0.5) * u_intensity * 2.0;
    float dispG = (pseudoRandom(seed + floor(py * u_resolution.y) * 19.7) - 0.5) * u_intensity * 2.0;
    float dispB = (pseudoRandom(seed + floor(py * u_resolution.y) * 23.1) - 0.5) * u_intensity * 2.0;
    vec2 uvR = vec2(fract(v_texCoord.x + dispR / u_resolution.x), py);
    vec2 uvG = vec2(fract(v_texCoord.x + dispG / u_resolution.x), py);
    vec2 uvB = vec2(fract(v_texCoord.x + dispB / u_resolution.x), py);
    float r = texture(u_source, uvR).r;
    float g = texture(u_source, uvG).g;
    float b = texture(u_source, uvB).b;
    fragColor = vec4(r, g, b, 1.0);
  } else {
    fragColor = texture(u_source, v_texCoord);
  }
}`,
    uniforms: { intensity: "float", colorFill: "float", speed: "float" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) ?? 60;
    const colorFill = (params.colorFill as number) ?? 30;
    const speed = (params.speed as number) ?? 5;
    if (intensity === 0) return;

    const source = scratchCopy(data, "line-massacre/source");
    const seed = Math.floor(time * speed);
    const affectThresh = (intensity / 100) * 0.7;

    const neonColors = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [0, 255, 255],
      [255, 0, 255],
      [255, 255, 0],
    ];

    for (let y = 0; y < height; y++) {
      const rowHash = pseudoRandom(seed + y * 7.3);
      if (rowHash >= affectThresh) continue;

      const fillHash = pseudoRandom(seed + y * 13.1);
      if (fillHash < colorFill / 100) {
        const colorIdx = Math.floor(pseudoRandom(seed + y * 31.7) * 6);
        const [nr, ng, nb] = neonColors[colorIdx];
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          data[idx] = nr;
          data[idx + 1] = ng;
          data[idx + 2] = nb;
        }
        continue;
      }

      const dispR = Math.floor(
        (pseudoRandom(seed + y * 17.3) - 0.5) * intensity * 2,
      );
      const dispG = Math.floor(
        (pseudoRandom(seed + y * 19.7) - 0.5) * intensity * 2,
      );
      const dispB = Math.floor(
        (pseudoRandom(seed + y * 23.1) - 0.5) * intensity * 2,
      );

      for (let x = 0; x < width; x++) {
        const dst = (y * width + x) * 4;
        const xR = (((x + dispR) % width) + width) % width;
        const xG = (((x + dispG) % width) + width) % width;
        const xB = (((x + dispB) % width) + width) % width;
        data[dst] = source[(y * width + xR) * 4];
        data[dst + 1] = source[(y * width + xG) * 4 + 1];
        data[dst + 2] = source[(y * width + xB) * 4 + 2];
      }
    }
  },
});
