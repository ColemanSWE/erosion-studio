import { registerEffect } from "../../effect-registry";
import { clamp, scratchFloats } from "../shared";

// ─── Premium Creative Effects ──────────────────────────────────────────────────

// ─── 1. ASCII Overlay ──────────────────────────────────────────────────────────
// Overlays ASCII characters on the original image along detected edges/thresholds

const CHARSETS: Record<string, string> = {
  standard: " .:-=+*#%@",
  blocks: " ░▒▓█",
  binary: "01",
  dots: " ·•●",
  kanji: " 人大中小上下左右",
};

registerEffect({
  type: "ascii-overlay",
  label: "ASCII Overlay",
  category: "style",
  defaultParams: {
    threshold: 80,
    density: 8,
    charset: "standard",
    color: "#00ff88",
    opacity: 0.85,
    edgeMode: "sobel",
    fontSize: 10,
    bgDarken: 0.4,
  },
  paramsConfig: [
    { key: "threshold", label: "Threshold", type: "slider", min: 10, max: 255, step: 1 },
    { key: "density", label: "Spacing", type: "slider", min: 4, max: 24, step: 1 },
    { key: "charset", label: "Character Set", type: "select", options: ["standard", "blocks", "binary", "dots", "kanji"] },
    { key: "color", label: "Char Color", type: "color" },
    { key: "opacity", label: "Opacity", type: "slider", min: 0, max: 1, step: 0.05 },
    { key: "edgeMode", label: "Edge Mode", type: "select", options: ["sobel", "threshold", "canny-approx"] },
    { key: "fontSize", label: "Font Size", type: "slider", min: 6, max: 24, step: 1 },
    { key: "bgDarken", label: "BG Darken", type: "slider", min: 0, max: 1, step: 0.05 },
  ],
  glsl: {
    uniforms: { threshold: "float", density: "float", color: "vec3", opacity: "float", bgDarken: "float" },
    uniformMapper: (params) => {
      const parseHex = (hex: string): [number, number, number] => {
        const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex as string);
        return r ? [parseInt(r[1], 16) / 255, parseInt(r[2], 16) / 255, parseInt(r[3], 16) / 255] : [0, 1, 0.53];
      };
      return {
        threshold: (params.threshold as number) / 255,
        density: params.density,
        color: parseHex(params.color as string),
        opacity: params.opacity,
        bgDarken: params.bgDarken,
      };
    },
    fragment: `
uniform float u_threshold;
uniform float u_density;
uniform vec3  u_color;
uniform float u_opacity;
uniform float u_bgDarken;

void main() {
  // Cell this pixel belongs to
  vec2 cellPx = floor(v_texCoord * u_resolution / u_density);
  vec2 cellCenter = (cellPx + 0.5) * u_density / u_resolution;

  // Average luminance for this cell (sample a 2x2 grid within the cell)
  float cellBri = 0.0;
  for (int dy = 0; dy <= 1; dy++) {
    for (int dx = 0; dx <= 1; dx++) {
      vec2 sUV = clamp(cellCenter + vec2(float(dx) - 0.5, float(dy) - 0.5) * u_density * 0.4 / u_resolution, vec2(0.0), vec2(1.0));
      cellBri += dot(texture(u_source, sUV).rgb, vec3(0.299, 0.587, 0.114));
    }
  }
  cellBri *= 0.25;

  // Position within cell [0,1]
  vec2 cellUV = fract(v_texCoord * u_resolution / u_density);

  // Character density: dark areas → dense fill, bright → sparse
  float charDensity = 1.0 - cellBri;

  // 4x4 dot grid within each character cell (simulates character fill density)
  float dotCol = floor(cellUV.x * 4.0);
  float dotRow = floor(cellUV.y * 4.0);
  float dotHash = hash2(cellPx * 13.7 + vec2(dotCol * 4.0 + dotRow) * 0.1);
  bool dotOn = dotHash < charDensity && cellBri < (1.0 - u_threshold);

  // Edge mode: highlight edges via Sobel
  vec2 tx = 1.0 / u_resolution;
  vec3 lumaW = vec3(0.299, 0.587, 0.114);
  float tl = dot(texture(u_source, cellCenter + vec2(-tx.x,-tx.y)).rgb, lumaW);
  float tm = dot(texture(u_source, cellCenter + vec2( 0.0, -tx.y)).rgb, lumaW);
  float tr = dot(texture(u_source, cellCenter + vec2( tx.x,-tx.y)).rgb, lumaW);
  float ml = dot(texture(u_source, cellCenter + vec2(-tx.x, 0.0 )).rgb, lumaW);
  float mr = dot(texture(u_source, cellCenter + vec2( tx.x, 0.0 )).rgb, lumaW);
  float bl = dot(texture(u_source, cellCenter + vec2(-tx.x, tx.y)).rgb, lumaW);
  float bm = dot(texture(u_source, cellCenter + vec2( 0.0,  tx.y)).rgb, lumaW);
  float br = dot(texture(u_source, cellCenter + vec2( tx.x, tx.y)).rgb, lumaW);
  float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
  float gy = -tl - 2.0*tm - tr + bl + 2.0*bm + br;
  float edgeMag = length(vec2(gx, gy));
  dotOn = dotOn || edgeMag > u_threshold * 0.5;

  vec3 bg  = texture(u_source, v_texCoord).rgb * (1.0 - u_bgDarken);
  vec3 fg  = mix(bg, u_color, u_opacity);

  fragColor = vec4(dotOn ? fg : bg, 1.0);
}`,
  },
  processor: (data, { width, height }, params) => {
    const threshold = (params.threshold as number) ?? 80;
    const density = (params.density as number) ?? 8;
    const charsetKey = (params.charset as string) ?? "standard";
    const color = (params.color as string) ?? "#00ff88";
    const opacity = (params.opacity as number) ?? 0.85;
    const edgeMode = (params.edgeMode as string) ?? "sobel";
    const fontSize = (params.fontSize as number) ?? 10;
    const bgDarken = (params.bgDarken as number) ?? 0.4;

    const chars = CHARSETS[charsetKey] || CHARSETS.standard;

    // Build grayscale
    const gray = scratchFloats(width * height, "ascii-overlay/gray");
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      gray[i] = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
    }

    // Edge detection
    const edges = scratchFloats(width * height, "ascii-overlay/edges");

    if (edgeMode === "sobel" || edgeMode === "canny-approx") {
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const pos = y * width + x;
          // Sobel kernels
          const gx =
            -gray[pos - width - 1] - 2 * gray[pos - 1] - gray[pos + width - 1] +
            gray[pos - width + 1] + 2 * gray[pos + 1] + gray[pos + width + 1];
          const gy =
            -gray[pos - width - 1] - 2 * gray[pos - width] - gray[pos - width + 1] +
            gray[pos + width - 1] + 2 * gray[pos + width] + gray[pos + width + 1];

          let mag = Math.sqrt(gx * gx + gy * gy);

          if (edgeMode === "canny-approx") {
            // Non-maximum suppression approximation
            const angle = Math.atan2(gy, gx);
            const dir = ((angle + Math.PI) / Math.PI * 4) & 3;
            // eslint-disable-next-line no-useless-assignment
            let n1 = 0, n2 = 0;
            if (dir === 0) { n1 = edges[pos - 1] || 0; n2 = edges[pos + 1] || 0; }
            else if (dir === 1) { n1 = edges[pos - width + 1] || 0; n2 = edges[pos + width - 1] || 0; }
            else if (dir === 2) { n1 = edges[pos - width] || 0; n2 = edges[pos + width] || 0; }
            else { n1 = edges[pos - width - 1] || 0; n2 = edges[pos + width + 1] || 0; }
            if (mag < n1 || mag < n2) mag = 0;
          }

          edges[pos] = mag;
        }
      }
    } else {
      // Simple threshold mode
      for (let i = 0; i < gray.length; i++) {
        edges[i] = gray[i] > threshold ? gray[i] : 0;
      }
    }

    // Render with canvas
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
    const ctx = tempCanvas.getContext("2d");
    if (!ctx) return;

    // Draw original image (darkened)
    const imgData = ctx.createImageData(width, height);
    for (let i = 0; i < data.length; i += 4) {
      imgData.data[i] = data[i] * (1 - bgDarken);
      imgData.data[i + 1] = data[i + 1] * (1 - bgDarken);
      imgData.data[i + 2] = data[i + 2] * (1 - bgDarken);
      imgData.data[i + 3] = data[i + 3];
    }
    ctx.putImageData(imgData, 0, 0);

    // Draw ASCII characters at edge positions
    ctx.font = `bold ${fontSize}px "JetBrains Mono", "Courier New", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const step = density;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const pos = y * width + x;
        const edgeVal = edges[pos];

        if (edgeMode === "threshold") {
          if (edgeVal <= 0) continue;
          const charIdx = Math.floor((edgeVal / 255) * (chars.length - 1));
          const char = chars[clamp(charIdx, 0, chars.length - 1)];
          if (char === " ") continue;
          ctx.fillStyle = color;
          ctx.globalAlpha = opacity;
          ctx.fillText(char, x + step / 2, y + step / 2);
        } else {
          if (edgeVal < threshold) continue;
          const normalized = Math.min(edgeVal / 400, 1);
          const charIdx = Math.floor(normalized * (chars.length - 1));
          const char = chars[clamp(charIdx, 0, chars.length - 1)];
          if (char === " ") continue;
          ctx.fillStyle = color;
          ctx.globalAlpha = opacity * normalized;
          ctx.fillText(char, x + step / 2, y + step / 2);
        }
      }
    }

    ctx.globalAlpha = 1;
    const resultData = ctx.getImageData(0, 0, width, height);
    data.set(resultData.data);
  },
});
