import { registerEffect } from "../../effect-registry";

// ─── 3. Contour Lines ──────────────────────────────────────────────────────────
// Topographic / iso-luminance contour lines
registerEffect({
  type: "contour-lines",
  label: "Contour Lines",
  category: "style",
  defaultParams: {
    levels: 10,
    lineWidth: 1.5,
    lineColor: "#ffffff",
    fillBands: false,
    opacity: 0.9,
    smooth: 2,
  },
  paramsConfig: [
    { key: "levels", label: "Levels", type: "slider", min: 3, max: 30, step: 1 },
    { key: "lineWidth", label: "Line Width", type: "slider", min: 0.5, max: 5, step: 0.5 },
    { key: "lineColor", label: "Line Color", type: "color" },
    { key: "fillBands", label: "Fill Bands", type: "checkbox" },
    { key: "opacity", label: "Opacity", type: "slider", min: 0, max: 1, step: 0.05 },
    { key: "smooth", label: "Smooth", type: "slider", min: 0, max: 8, step: 1 },
  ],
  glsl: {
    uniforms: {
      levels: "int", lineWidth: "float", lineColor: "vec3",
      fillBands: "int", opacity: "float", totalPasses: "int",
    },
    uniformMapper: (params) => {
      const smooth = Math.round((params.smooth as number) ?? 2);
      const parseHex = (hex: string): [number, number, number] => {
        const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex as string);
        return r ? [parseInt(r[1], 16) / 255, parseInt(r[2], 16) / 255, parseInt(r[3], 16) / 255] : [1, 1, 1];
      };
      return {
        levels: Math.round((params.levels as number) ?? 10),
        lineWidth: params.lineWidth,
        lineColor: parseHex(params.lineColor as string),
        fillBands: params.fillBands ? 1 : 0,
        opacity: params.opacity,
        totalPasses: smooth + 1,
      };
    },
    multiPass: (_, params) => Math.round((params.smooth as number) ?? 2) + 1,
    fragment: `
uniform int u_levels;
uniform float u_lineWidth;
uniform vec3 u_lineColor;
uniform int u_fillBands;
uniform float u_opacity;
uniform int u_totalPasses;
uniform int u_pass;

void main() {
  vec2 tx = 1.0 / u_resolution;

  if (u_pass < u_totalPasses - 1) {
    fragColor = vec4(
      texture(u_source, v_texCoord + vec2(-tx.x,-tx.y)).rgb * 1.0 +
      texture(u_source, v_texCoord + vec2( 0.0, -tx.y)).rgb * 2.0 +
      texture(u_source, v_texCoord + vec2( tx.x,-tx.y)).rgb * 1.0 +
      texture(u_source, v_texCoord + vec2(-tx.x,  0.0)).rgb * 2.0 +
      texture(u_source, v_texCoord              ).rgb * 4.0 +
      texture(u_source, v_texCoord + vec2( tx.x,  0.0)).rgb * 2.0 +
      texture(u_source, v_texCoord + vec2(-tx.x,  tx.y)).rgb * 1.0 +
      texture(u_source, v_texCoord + vec2( 0.0,   tx.y)).rgb * 2.0 +
      texture(u_source, v_texCoord + vec2( tx.x,  tx.y)).rgb * 1.0
    , 1.0) / 16.0;
    return;
  }

  vec3 luma = vec3(0.299, 0.587, 0.114);
  float lumaVal = dot(texture(u_source, v_texCoord).rgb, luma);
  float levels  = float(u_levels);
  float myBand  = floor(lumaVal * levels);

  vec3 col = texture(u_source, v_texCoord).rgb;
  if (u_fillBands == 1) {
    float quantLuma = (myBand + 0.5) / levels;
    if (lumaVal > 0.001) col *= quantLuma / lumaVal;
  }

  int lw = min(2, int(ceil(u_lineWidth)));
  bool isEdge = false;
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      if (!isEdge && abs(dx) <= lw && abs(dy) <= lw && !(dx == 0 && dy == 0)) {
        float nb = dot(texture(u_source, v_texCoord + vec2(float(dx) * tx.x, float(dy) * tx.y)).rgb, luma);
        if (floor(nb * levels) != myBand) isEdge = true;
      }
    }
  }

  if (isEdge) col = mix(col, u_lineColor, u_opacity);
  fragColor = vec4(col, 1.0);
}`,
  },
  processor: (data, { width, height }, params) => {
    const levels = (params.levels as number) ?? 10;
    const lineWidth = (params.lineWidth as number) ?? 1.5;
    const lineColor = (params.lineColor as string) ?? "#ffffff";
    const fillBands = (params.fillBands as boolean) ?? false;
    const opacity = (params.opacity as number) ?? 0.9;
    const smooth = (params.smooth as number) ?? 2;

    // Build grayscale + optional box blur smoothing
    let gray = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      gray[i] = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
    }

    // Simple box blur for smoothing
    if (smooth > 0) {
      const blurred = new Float32Array(gray.length);
      const r = smooth;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let sum = 0, count = 0;
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                sum += gray[ny * width + nx];
                count++;
              }
            }
          }
          blurred[y * width + x] = sum / count;
        }
      }
      gray = blurred;
    }

    // Quantize to contour bands
    const bandStep = 255 / levels;
    const bandValues = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i++) {
      bandValues[i] = Math.floor(gray[i] / bandStep);
    }

    const hexResult = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(lineColor);
    const lR = hexResult ? parseInt(hexResult[1], 16) : 255;
    const lG = hexResult ? parseInt(hexResult[2], 16) : 255;
    const lB = hexResult ? parseInt(hexResult[3], 16) : 255;

    if (fillBands) {
      // Color each band with average color of original pixels in that band
      const bandR = new Float32Array(levels + 1);
      const bandG = new Float32Array(levels + 1);
      const bandB = new Float32Array(levels + 1);
      const bandCount = new Float32Array(levels + 1);

      for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        const band = bandValues[i];
        bandR[band] += data[idx];
        bandG[band] += data[idx + 1];
        bandB[band] += data[idx + 2];
        bandCount[band]++;
      }

      for (let b = 0; b <= levels; b++) {
        if (bandCount[b] > 0) {
          bandR[b] /= bandCount[b];
          bandG[b] /= bandCount[b];
          bandB[b] /= bandCount[b];
        }
      }

      for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        const band = bandValues[i];
        data[idx] = bandR[band];
        data[idx + 1] = bandG[band];
        data[idx + 2] = bandB[band];
      }
    }

    // Draw contour lines where band value changes
    const lineThick = Math.ceil(lineWidth);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const here = bandValues[y * width + x];
        const right = bandValues[y * width + x + 1];
        const below = bandValues[(y + 1) * width + x];

        if (here !== right || here !== below) {
          // This is a contour boundary
          for (let dy = -lineThick + 1; dy < lineThick; dy++) {
            for (let dx = -lineThick + 1; dx < lineThick; dx++) {
              const px = x + dx, py = y + dy;
              if (px >= 0 && px < width && py >= 0 && py < height) {
                const pidx = (py * width + px) * 4;
                data[pidx] = data[pidx] * (1 - opacity) + lR * opacity;
                data[pidx + 1] = data[pidx + 1] * (1 - opacity) + lG * opacity;
                data[pidx + 2] = data[pidx + 2] * (1 - opacity) + lB * opacity;
              }
            }
          }
        }
      }
    }
  },
});
