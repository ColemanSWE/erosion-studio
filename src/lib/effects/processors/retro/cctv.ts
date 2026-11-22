import { registerEffect } from "../../effect-registry";
import { clamp, pseudoRandom } from "../shared";

// ─── CCTV ──────────────────────────────────────────────────────────────────────
// Surveillance camera composite: fisheye distortion, resolution reduction,
// green/gray tint, interlace artifacts, noise, and timestamp overlay
registerEffect({
  type: "cctv",
  label: "CCTV",
  category: "retro",
  defaultParams: { resolution: "low", tint: "green", noise: 0.15, distortion: 0.3, showTimestamp: true, cameraId: "CAM-01" },
  paramsConfig: [
    { key: "resolution", label: "Resolution", type: "select", options: ["low", "medium"] },
    { key: "tint", label: "Tint", type: "select", options: ["green", "gray", "none"] },
    { key: "noise", label: "Noise", type: "slider", min: 0, max: 0.5, step: 0.01 },
    { key: "distortion", label: "Distortion", type: "slider", min: 0, max: 1, step: 0.05 },
    { key: "showTimestamp", label: "Show Timestamp", type: "checkbox" },
    { key: "cameraId", label: "Camera ID", type: "select", options: ["CAM-01", "CAM-02", "CAM-03", "CAM-04", "EXT-01", "INT-02"] },
  ],
  glsl: {
    uniforms: { distortion: "float", noise: "float", tintMode: "int", resMode: "int" },
    uniformMapper: (params) => ({
      distortion: params.distortion,
      noise: params.noise,
      tintMode: params.tint === "green" ? 0 : params.tint === "gray" ? 1 : 2,
      resMode: params.resolution === "low" ? 0 : 1,
    }),
    fragment: `
uniform float u_distortion;
uniform float u_noise;
uniform int u_tintMode;
uniform int u_resMode;

void main() {
  vec2 uv = v_texCoord;

  if (u_distortion > 0.0) {
    vec2 c = uv * 2.0 - 1.0;
    float r2 = dot(c, c);
    c *= 1.0 + u_distortion * r2;
    uv = c * 0.5 + 0.5;
  }

  float invScale = u_resMode == 0 ? 4.0 : 2.0;
  vec2 blockSize = invScale / u_resolution;
  uv = floor(uv / blockSize) * blockSize;

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec3 col = texture(u_source, uv).rgb;

  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  if (u_tintMode == 0) col = vec3(luma * 0.4, luma * 1.0, luma * 0.4);
  else if (u_tintMode == 1) col = vec3(luma);

  float n = pseudoRandom(dot(v_texCoord, vec2(127.1, 311.7)) + floor(u_time * 30.0) * 0.01);
  col += (n * 2.0 - 1.0) * u_noise;

  float scanRow = floor(v_texCoord.y * u_resolution.y);
  if (mod(scanRow, 2.0) >= 1.0) col *= 0.75;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`,
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const resolution = (params.resolution as string) ?? "low";
    const tint = (params.tint as string) ?? "green";
    const noiseLevel = (params.noise as number) ?? 0.15;
    const distortion = (params.distortion as number) ?? 0.3;
    const showTimestamp = (params.showTimestamp as boolean) ?? true;
    const cameraId = (params.cameraId as string) ?? "CAM-01";

    const scale = resolution === "low" ? 0.25 : 0.5;

    // Barrel distort + pixelate via canvas
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
    const ctx = tempCanvas.getContext("2d");
    if (!ctx) return;

    // Put original into canvas
    const srcImage = ctx.createImageData(width, height);
    srcImage.data.set(data);
    ctx.putImageData(srcImage, 0, 0);

    // Reduce resolution (nearest neighbor)
    const lowW = Math.max(1, Math.round(width * scale));
    const lowH = Math.max(1, Math.round(height * scale));
    const lowCanvas = document.createElement("canvas");
    lowCanvas.width = lowW;
    lowCanvas.height = lowH;
    const lowCtx = lowCanvas.getContext("2d");
    if (!lowCtx) return;
    lowCtx.imageSmoothingEnabled = false;
    lowCtx.drawImage(tempCanvas, 0, 0, lowW, lowH);

    // Scale back up without smoothing
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(lowCanvas, 0, 0, width, height);

    const pixelated = ctx.getImageData(0, 0, width, height);

    // Apply barrel distortion + tint + noise to pixel buffer
    const src = new Uint8ClampedArray(pixelated.data);
    const cx = width / 2;
    const cy = height / 2;
    const _maxR = Math.sqrt(cx * cx + cy * cy);
    const seed = Math.floor(time * 30);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        let sx = x, sy = y;
        if (distortion > 0) {
          const dx = (x - cx) / cx;
          const dy = (y - cy) / cy;
          const r2 = dx * dx + dy * dy;
          const barrel = 1 + distortion * r2;
          sx = cx + dx * barrel * cx;
          sy = cy + dy * barrel * cy;
        }

        const sx0 = clamp(Math.round(sx), 0, width - 1);
        const sy0 = clamp(Math.round(sy), 0, height - 1);
        const si = (sy0 * width + sx0) * 4;

        let r = src[si];
        let g = src[si + 1];
        let b = src[si + 2];

        // Tint
        const lum = r * 0.299 + g * 0.587 + b * 0.114;
        if (tint === "green") {
          r = lum * 0.4;
          g = lum * 1.0;
          b = lum * 0.4;
        } else if (tint === "gray") {
          r = g = b = lum;
        }

        // Noise
        if (noiseLevel > 0) {
          const n = (pseudoRandom(seed + x * 7 + y * 13) - 0.5) * noiseLevel * 255 * 2;
          r = clamp(r + n, 0, 255);
          g = clamp(g + n, 0, 255);
          b = clamp(b + n, 0, 255);
        }

        // Interlace: darken odd rows slightly
        if (y % 2 === 1) {
          r *= 0.75;
          g *= 0.75;
          b *= 0.75;
        }

        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }

    // Draw timestamp overlay via canvas
    if (showTimestamp) {
      const overlayCanvas = document.createElement("canvas");
      overlayCanvas.width = width;
      overlayCanvas.height = height;
      const octx = overlayCanvas.getContext("2d");
      if (!octx) return;

      const plainBuf = new ArrayBuffer(data.length);
      const dataCopy = new Uint8ClampedArray(plainBuf);
      dataCopy.set(data);
      octx.putImageData(new ImageData(dataCopy, width, height), 0, 0);

      const fontSize = Math.max(10, Math.round(height * 0.04));
      octx.font = `${fontSize}px monospace`;
      octx.fillStyle = tint === "green" ? "#00ff40" : tint === "gray" ? "#cccccc" : "#ffffff";

      // Fake timestamp
      const totalSecs = Math.floor(time);
      const hh = String(Math.floor(totalSecs / 3600) % 24).padStart(2, "0");
      const mm = String(Math.floor(totalSecs / 60) % 60).padStart(2, "0");
      const ss = String(totalSecs % 60).padStart(2, "0");
      const dateStr = "1993/08/17";
      const timeStr = `${hh}:${mm}:${ss}`;

      const pad = Math.round(width * 0.02);
      octx.fillText(`${cameraId}  ${dateStr} ${timeStr}`, pad, height - pad - fontSize);

      const result = octx.getImageData(0, 0, width, height);
      data.set(result.data);
    }
  },
});
