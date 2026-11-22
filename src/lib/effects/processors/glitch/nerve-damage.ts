import { registerEffect } from "../../effect-registry";
import { pseudoRandom, clamp, rgbToHsl, hslToRgb, scratchCopy } from "../shared";

registerEffect({
  type: "nerve-damage",
  label: "Nerve Damage",
  category: "glitch",
  defaultParams: {
    destruction: 75,
    strideCorruption: 60,
    colorCrush: 80,
    lineDisplacement: 70,
    syncBars: 60,
    gridDensity: 16,
    speed: 6,
  },
  paramsConfig: [
    {
      key: "destruction",
      label: "Destruction",
      type: "slider",
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: "strideCorruption",
      label: "Stride Corruption",
      type: "slider",
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: "colorCrush",
      label: "Color Crush",
      type: "slider",
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: "lineDisplacement",
      label: "Line Displacement",
      type: "slider",
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: "syncBars",
      label: "Sync Bars",
      type: "slider",
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: "gridDensity",
      label: "Grid Density",
      type: "slider",
      min: 0,
      max: 50,
      step: 1,
    },
    { key: "speed", label: "Speed", type: "slider", min: 1, max: 20, step: 1 },
  ],
  glsl: {
    fragment: `
uniform float u_destruction;
uniform float u_strideCorruption;
uniform float u_colorCrush;
uniform float u_lineDisplacement;
uniform float u_syncBars;
uniform float u_gridDensity;
uniform float u_speed;

const float BAYER[16] = float[16](
   0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
  12.0/16.0,  4.0/16.0, 14.0/16.0,  6.0/16.0,
   3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
  15.0/16.0,  7.0/16.0, 13.0/16.0,  5.0/16.0
);

vec3 neonPick(float h) {
  int i = int(mod(floor(h * 6.0), 6.0));
  if (i == 0) return vec3(1.0, 0.0, 0.0);
  if (i == 1) return vec3(0.0, 1.0, 0.0);
  if (i == 2) return vec3(0.0, 0.0, 1.0);
  if (i == 3) return vec3(0.0, 1.0, 1.0);
  if (i == 4) return vec3(1.0, 0.0, 1.0);
  return vec3(1.0, 1.0, 0.0);
}

void main() {
  float D = u_destruction / 100.0;
  float seed = floor(u_time * u_speed);
  vec2 uv = v_texCoord;
  float px = uv.x * u_resolution.x;
  float py = uv.y * u_resolution.y;

  // ── 1. Stride corruption ───────────────────────────────────────────────────
  float stridePower = u_strideCorruption * D;
  if (stridePower > 0.0) {
    float flatIdx = py * u_resolution.x + px;
    float strideR = u_resolution.x + stridePower * 0.8;
    float strideB = u_resolution.x - stridePower * 0.6;
    uv.x = mod(mod(flatIdx, strideR) / u_resolution.x, 1.0);
  }

  // ── 2. Line massacre ───────────────────────────────────────────────────────
  float linePower = u_lineDisplacement * D;
  if (linePower > 0.0) {
    float rowHash = pseudoRandom(seed + py * 7.3);
    if (rowHash < linePower / 100.0 * 0.7) {
      float fillHash = pseudoRandom(seed + py * 13.1);
      if (fillHash < 0.25) {
        fragColor = vec4(neonPick(pseudoRandom(seed + py * 31.7)), 1.0);
        return;
      }
      float dispR = (pseudoRandom(seed + py * 17.3) - 0.5) * linePower * 2.0;
      float dispG = (pseudoRandom(seed + py * 19.7) - 0.5) * linePower * 2.0;
      float dispB = (pseudoRandom(seed + py * 23.1) - 0.5) * linePower * 2.0;
      float r = texture(u_source, vec2(fract(uv.x + dispR / u_resolution.x), uv.y)).r;
      float g = texture(u_source, vec2(fract(uv.x + dispG / u_resolution.x), uv.y)).g;
      float b = texture(u_source, vec2(fract(uv.x + dispB / u_resolution.x), uv.y)).b;
      // ── 3. Neon crush on displaced rows ─────────────────────────────────────
      vec3 col = vec3(r, g, b);
      if (u_colorCrush > 0.0) {
        int bx = int(mod(gl_FragCoord.x, 4.0));
        int by2 = int(mod(gl_FragCoord.y, 4.0));
        float dither = BAYER[by2 * 4 + bx] * (u_colorCrush / 200.0);
        col.r = floor((col.r + dither) * 2.0 + 0.5) / 2.0;
        col.g = floor((col.g + dither) * 2.0 + 0.5) / 2.0;
        col.b = floor((col.b + dither) * 2.0 + 0.5) / 2.0;
      }
      fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      return;
    }
  }

  vec4 col = texture(u_source, uv);

  // ── 3. Neon crush (global) ─────────────────────────────────────────────────
  float crushPower = u_colorCrush * D;
  if (crushPower > 0.0) {
    vec3 hsl = rgbToHsl(col.rgb);
    hsl.y = clamp(hsl.y + crushPower / 100.0, 0.0, 1.0);
    col.rgb = hslToRgb(hsl.x, hsl.y, hsl.z);
    int bx = int(mod(gl_FragCoord.x, 4.0));
    int by2 = int(mod(gl_FragCoord.y, 4.0));
    float dither = BAYER[by2 * 4 + bx] * (crushPower / 300.0);
    float levels = 1.0;
    col.r = floor((col.r + dither / levels) * levels + 0.5) / levels;
    col.g = floor((col.g + dither / levels) * levels + 0.5) / levels;
    col.b = floor((col.b + dither / levels) * levels + 0.5) / levels;
  }

  // ── 4. VSync bars ─────────────────────────────────────────────────────────
  float barPower = u_syncBars * D;
  if (barPower > 0.0) {
    float barSeed = floor(u_time * u_speed * 0.5);
    int numBars = int(barPower / 10.0);
    for (int i = 0; i < 20; i++) {
      if (i >= numBars) break;
      float barX = pseudoRandom(barSeed + float(i) * 37.1) * u_resolution.x;
      float barW = 10.0 + pseudoRandom(barSeed + float(i) * 53.7) * barPower * 0.4;
      if (px >= barX && px < barX + barW) {
        vec3 neon = neonPick(pseudoRandom(barSeed + float(i) * 79.3));
        col.rgb = mix(col.rgb, neon, barPower / 100.0);
        break;
      }
    }
  }

  // ── 5. Grid overlay ───────────────────────────────────────────────────────
  if (u_gridDensity > 0.0) {
    float gx = mod(px, u_gridDensity);
    float gy = mod(py, u_gridDensity);
    if (gx < 1.0 || gy < 1.0) {
      col.rgb = vec3(0.0);
    }
  }

  fragColor = vec4(clamp(col.rgb, 0.0, 1.0), col.a);
}`,
    uniforms: {
      destruction: "float",
      strideCorruption: "float",
      colorCrush: "float",
      lineDisplacement: "float",
      syncBars: "float",
      gridDensity: "float",
      speed: "float",
    },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const destruction = (params.destruction as number) / 100 || 0.75;
    const strideCorruption = (params.strideCorruption as number) ?? 60;
    const colorCrushParam = (params.colorCrush as number) ?? 80;
    const lineDisplacement = (params.lineDisplacement as number) ?? 70;
    const syncBars = (params.syncBars as number) ?? 60;
    const gridDensity = (params.gridDensity as number) ?? 16;
    const speed = (params.speed as number) ?? 6;

    const source = scratchCopy(data, "nerve-damage/source");
    const seed = Math.floor(time * speed);
    const barSeed = Math.floor(time * speed * 0.5);

    const BAYER = [
      0 / 16,
      8 / 16,
      2 / 16,
      10 / 16,
      12 / 16,
      4 / 16,
      14 / 16,
      6 / 16,
      3 / 16,
      11 / 16,
      1 / 16,
      9 / 16,
      15 / 16,
      7 / 16,
      13 / 16,
      5 / 16,
    ];

    const neonColors = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [0, 255, 255],
      [255, 0, 255],
      [255, 255, 0],
    ];

    const numBars = Math.floor((syncBars * destruction) / 10);
    const barRegions: Array<{ x: number; w: number; color: number[] }> = [];
    for (let i = 0; i < numBars; i++) {
      barRegions.push({
        x: Math.floor(pseudoRandom(barSeed + i * 37.1) * width),
        w: Math.floor(
          10 + pseudoRandom(barSeed + i * 53.7) * syncBars * destruction * 0.4,
        ),
        color: neonColors[Math.floor(pseudoRandom(barSeed + i * 79.3) * 6)],
      });
    }

    const stridePower = strideCorruption * destruction;
    const linePower = lineDisplacement * destruction;
    const crushPower = colorCrushParam * destruction;

    for (let y = 0; y < height; y++) {
      const rowHash = pseudoRandom(seed + y * 7.3);
      const lineMassacre = rowHash < (linePower / 100) * 0.7;

      for (let x = 0; x < width; x++) {
        const dst = (y * width + x) * 4;

        let r: number, g: number, b: number;

        if (lineMassacre) {
          const fillHash = pseudoRandom(seed + y * 13.1);
          if (fillHash < 0.25) {
            const nc =
              neonColors[Math.floor(pseudoRandom(seed + y * 31.7) * 6)];
            data[dst] = nc[0];
            data[dst + 1] = nc[1];
            data[dst + 2] = nc[2];
            data[dst + 3] = 255;
            continue;
          }
          const dispR = Math.floor(
            (pseudoRandom(seed + y * 17.3) - 0.5) * linePower * 2,
          );
          const dispG = Math.floor(
            (pseudoRandom(seed + y * 19.7) - 0.5) * linePower * 2,
          );
          const dispB = Math.floor(
            (pseudoRandom(seed + y * 23.1) - 0.5) * linePower * 2,
          );
          r = source[(y * width + ((x + dispR + width * 2) % width)) * 4];
          g = source[(y * width + ((x + dispG + width * 2) % width)) * 4 + 1];
          b = source[(y * width + ((x + dispB + width * 2) % width)) * 4 + 2];
        } else if (stridePower > 0) {
          const flatIdx = y * width + x;
          const strideR = width + stridePower * 0.8;
          const newRowR = Math.floor(flatIdx / strideR);
          const newColR = Math.floor(flatIdx % strideR) % width;
          const srcR = Math.min(newRowR, height - 1) * width + newColR;
          r = source[srcR * 4];

          const strideB = Math.max(1, width - stridePower * 0.6);
          const newRowB = Math.floor(flatIdx / strideB);
          const newColB = Math.floor(flatIdx % strideB) % width;
          const srcB = Math.min(newRowB, height - 1) * width + newColB;
          b = source[srcB * 4 + 2];
          g = source[dst + 1];
        } else {
          r = source[dst];
          g = source[dst + 1];
          b = source[dst + 2];
        }

        // Neon crush
        if (crushPower > 0) {
          const [h, s, l] = rgbToHsl(r / 255, g / 255, b / 255);
          const boostedSat = Math.min(1, s + crushPower / 100);
          const [cr, cg, cb] = hslToRgb(h, boostedSat, l);
          const dither = BAYER[(y % 4) * 4 + (x % 4)] * (crushPower / 300);
          r = clamp((Math.round((cr + dither) * 2 + 0.5) / 2) * 255, 0, 255);
          g = clamp((Math.round((cg + dither) * 2 + 0.5) / 2) * 255, 0, 255);
          b = clamp((Math.round((cb + dither) * 2 + 0.5) / 2) * 255, 0, 255);
        }

        // VSync bars
        for (const bar of barRegions) {
          if (x >= bar.x && x < bar.x + bar.w) {
            const alpha = (syncBars * destruction) / 100;
            r = Math.round(r * (1 - alpha) + bar.color[0] * alpha);
            g = Math.round(g * (1 - alpha) + bar.color[1] * alpha);
            b = Math.round(b * (1 - alpha) + bar.color[2] * alpha);
            break;
          }
        }

        // Grid overlay
        if (gridDensity > 0 && (x % gridDensity < 1 || y % gridDensity < 1)) {
          r = 0;
          g = 0;
          b = 0;
        }

        data[dst] = r;
        data[dst + 1] = g;
        data[dst + 2] = b;
        data[dst + 3] = 255;
      }
    }
  },
});
