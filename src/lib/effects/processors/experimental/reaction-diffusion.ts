import { registerEffect } from "../../effect-registry";
import { clamp } from "../shared";

// ─── 4. Reaction-Diffusion ─────────────────────────────────────────────────────
// Gray-Scott reaction-diffusion model seeded by image content.
// Creates organic, biological Turing patterns that evolve over time.

const rdState: {
  gridA: Float32Array | null;
  gridB: Float32Array | null;
  width: number;
  height: number;
  step: number;
} = { gridA: null, gridB: null, width: 0, height: 0, step: 0 };

registerEffect({
  type: "reaction-diffusion",
  experimental: true,
  label: "Reaction Diffusion",
  category: "style",
  defaultParams: {
    feed: 0.055,
    kill: 0.062,
    diffuseA: 1.0,
    diffuseB: 0.5,
    stepsPerFrame: 8,
    scale: 2,
    colorA: "#000000",
    colorB: "#00ff88",
    seedFromImage: true,
  },
  paramsConfig: [
    { key: "feed", label: "Feed Rate", type: "slider", min: 0.01, max: 0.1, step: 0.001 },
    { key: "kill", label: "Kill Rate", type: "slider", min: 0.01, max: 0.1, step: 0.001 },
    { key: "diffuseA", label: "Diffuse A", type: "slider", min: 0.2, max: 2, step: 0.1 },
    { key: "diffuseB", label: "Diffuse B", type: "slider", min: 0.1, max: 1, step: 0.05 },
    { key: "stepsPerFrame", label: "Speed", type: "slider", min: 1, max: 20, step: 1 },
    { key: "scale", label: "Scale", type: "slider", min: 1, max: 8, step: 1 },
    { key: "colorA", label: "Color A", type: "color" },
    { key: "colorB", label: "Color B", type: "color" },
    { key: "seedFromImage", label: "Seed From Image", type: "checkbox" },
  ],
  glsl: {
    needsPrevFrame: true,
    uniforms: {
      feed: "float", kill: "float", diffuseB: "float", stepsPerFrame: "float",
      colorA: "vec3", colorB: "vec3", seedFromImage: "int",
    },
    uniformMapper: (params) => {
      const parseHex = (hex: string): [number, number, number] => {
        const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex as string);
        return r ? [parseInt(r[1], 16) / 255, parseInt(r[2], 16) / 255, parseInt(r[3], 16) / 255] : [0, 0, 0];
      };
      return {
        feed: params.feed,
        kill: params.kill,
        diffuseB: params.diffuseB,
        stepsPerFrame: params.stepsPerFrame,
        colorA: parseHex(params.colorA as string),
        colorB: parseHex(params.colorB as string),
        seedFromImage: (params.seedFromImage as boolean) ? 1 : 0,
      };
    },
    fragment: `
uniform float u_feed;
uniform float u_kill;
uniform float u_diffuseB;
uniform float u_stepsPerFrame;
uniform vec3  u_colorA;
uniform vec3  u_colorB;
uniform int   u_seedFromImage;
uniform sampler2D u_prevFrame;

void main() {
  vec2 tx = 1.0 / u_resolution;

  // Read B chemical from previous frame's red channel
  // (prevFrame encodes B as luminance when colorA=black, colorB=green/any)
  // For robustness, derive B from prevFrame luminance
  float B = dot(texture(u_prevFrame, v_texCoord).rgb, vec3(0.299, 0.587, 0.114));
  float A = 1.0 - B;

  // Discrete Laplacian of B
  float lapB =
    dot(texture(u_prevFrame, v_texCoord + vec2(-tx.x,  0.0)).rgb, vec3(1.0/3.0)) +
    dot(texture(u_prevFrame, v_texCoord + vec2( tx.x,  0.0)).rgb, vec3(1.0/3.0)) +
    dot(texture(u_prevFrame, v_texCoord + vec2(0.0,  -tx.y)).rgb, vec3(1.0/3.0)) +
    dot(texture(u_prevFrame, v_texCoord + vec2(0.0,   tx.y)).rgb, vec3(1.0/3.0)) -
    4.0 * B;

  float AB2 = A * B * B;
  float newB = B;
  float dt = 0.08;
  for (float s = 0.0; s < 20.0; s++) {
    if (s >= u_stepsPerFrame) break;
    float dB = u_diffuseB * lapB + AB2 - (u_feed + u_kill) * newB;
    newB = clamp(newB + dB * dt, 0.0, 1.0);
  }

  // Seed B from dark image areas on first frames or continuously (slow)
  if (u_seedFromImage == 1) {
    float srcLuma = dot(texture(u_source, v_texCoord).rgb, vec3(0.299, 0.587, 0.114));
    if (srcLuma < 0.4) {
      newB = max(newB, (0.4 - srcLuma) * 0.5);
    }
  }

  fragColor = vec4(mix(u_colorA, u_colorB, newB), 1.0);
}`,
  },
  processor: (data, { width, height }, params) => {
    const feed = (params.feed as number) ?? 0.055;
    const kill = (params.kill as number) ?? 0.062;
    const dA = (params.diffuseA as number) ?? 1.0;
    const dB = (params.diffuseB as number) ?? 0.5;
    const stepsPerFrame = (params.stepsPerFrame as number) ?? 8;
    const scale = (params.scale as number) ?? 2;
    const colorA = (params.colorA as string) ?? "#000000";
    const colorB = (params.colorB as string) ?? "#00ff88";
    const seedFromImage = (params.seedFromImage as boolean) ?? true;

    const parseHex = (hex: string) => {
      const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return r ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)] : [0, 0, 0];
    };
    const cA = parseHex(colorA);
    const cB = parseHex(colorB);

    // Simulation runs at reduced resolution for performance
    const sw = Math.floor(width / scale);
    const sh = Math.floor(height / scale);
    const totalCells = sw * sh;

    // Initialize grids if needed
    if (!rdState.gridA || rdState.width !== sw || rdState.height !== sh) {
      rdState.gridA = new Float32Array(totalCells).fill(1);
      rdState.gridB = new Float32Array(totalCells).fill(0);
      rdState.width = sw;
      rdState.height = sh;
      rdState.step = 0;

      // Seed B from image luminance (dark areas = more B chemical)
      if (seedFromImage) {
        for (let y = 0; y < sh; y++) {
          for (let x = 0; x < sw; x++) {
            const imgX = Math.floor(x * scale);
            const imgY = Math.floor(y * scale);
            const idx = (imgY * width + imgX) * 4;
            const lum = (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114) / 255;
            if (lum < 0.5) {
              rdState.gridB[y * sw + x] = 1 - lum;
            }
          }
        }
      } else {
        // Seed with random spots
        for (let i = 0; i < totalCells * 0.05; i++) {
          const idx = Math.floor(Math.random() * totalCells);
          rdState.gridB[idx] = 1;
        }
      }
    }

    const gridA = rdState.gridA!;
    const gridB = rdState.gridB!;

    // Run simulation steps
    for (let step = 0; step < stepsPerFrame; step++) {
      const nextA = new Float32Array(totalCells);
      const nextB = new Float32Array(totalCells);

      for (let y = 1; y < sh - 1; y++) {
        for (let x = 1; x < sw - 1; x++) {
          const idx = y * sw + x;
          const a = gridA[idx];
          const b = gridB[idx];

          // Laplacian (discrete)
          const lapA = gridA[idx - 1] + gridA[idx + 1] +
            gridA[idx - sw] + gridA[idx + sw] - 4 * a;
          const lapB = gridB[idx - 1] + gridB[idx + 1] +
            gridB[idx - sw] + gridB[idx + sw] - 4 * b;

          const reaction = a * b * b;
          nextA[idx] = clamp(a + dA * lapA - reaction + feed * (1 - a), 0, 1);
          nextB[idx] = clamp(b + dB * lapB + reaction - (kill + feed) * b, 0, 1);
        }
      }

      gridA.set(nextA);
      gridB.set(nextB);
    }

    rdState.step++;

    // Render to output
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sx = clamp(Math.floor(x / scale), 0, sw - 1);
        const sy = clamp(Math.floor(y / scale), 0, sh - 1);
        const b = gridB[sy * sw + sx];
        const _a = gridA[sy * sw + sx];

        const idx = (y * width + x) * 4;
        const t = clamp(b * 2, 0, 1);
        data[idx] = Math.floor(cA[0] * (1 - t) + cB[0] * t);
        data[idx + 1] = Math.floor(cA[1] * (1 - t) + cB[1] * t);
        data[idx + 2] = Math.floor(cA[2] * (1 - t) + cB[2] * t);
      }
    }
  },
});
