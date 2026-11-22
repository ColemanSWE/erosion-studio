import { registerEffect } from "../../effect-registry";
import { clamp, scratchCopy } from "../shared";

// ─── 5. Droste Effect ──────────────────────────────────────────────────────────
// The image contains itself recursively, spiraling inward. Classic mathematical art.

registerEffect({
  type: "droste",
  experimental: true,
  label: "Droste Effect",
  category: "distortion",
  defaultParams: {
    zoom: 2.0,
    rotation: 30,
    centerX: 0.5,
    centerY: 0.5,
    innerRadius: 0.1,
    outerRadius: 0.9,
    animated: true,
    speed: 0.5,
  },
  glsl: {
    fragment: `
uniform float u_zoom;
uniform float u_rotation;
uniform float u_centerX;
uniform float u_centerY;
uniform float u_innerRadius;
uniform float u_outerRadius;
uniform bool u_animated;
uniform float u_speed;
void main() {
  float maxDim = max(u_resolution.x, u_resolution.y);
  vec2 center = vec2(u_centerX, u_centerY);
  vec2 d = v_texCoord - center;
  // Correct for non-square images
  d *= u_resolution / maxDim;
  float dist = length(d);
  float r1 = u_innerRadius * 0.5;
  float r2 = u_outerRadius * 0.5;
  float rotRad = u_rotation * 3.14159 / 180.0;
  float logZoom = log(u_zoom);
  float timeOffset = u_animated ? u_time * u_speed : 0.0;
  float period = log(r2 / max(r1, 0.001));
  if (dist < 0.001 || period < 0.001) {
    fragColor = texture(u_source, v_texCoord);
    return;
  }
  float logDist = log(dist / r1) + timeOffset;
  float angle = atan(d.y, d.x) + rotRad;
  float wraps = logDist / period;
  float fracWrap = fract(wraps);
  logDist = fracWrap * period;
  angle += floor(wraps) * rotRad;
  float newDist = r1 * exp(logDist);
  // Convert back to UV space
  vec2 srcD = vec2(cos(angle), sin(angle)) * newDist * maxDim / u_resolution;
  vec2 srcUV = center + srcD;
  fragColor = sampleClamped(srcUV);
}`,
    uniforms: {
      zoom: "float", rotation: "float", centerX: "float", centerY: "float",
      innerRadius: "float", outerRadius: "float", animated: "bool", speed: "float",
    },
  },
  paramsConfig: [
    { key: "zoom", label: "Zoom", type: "slider", min: 1.2, max: 5, step: 0.1 },
    { key: "rotation", label: "Rotation", type: "slider", min: -180, max: 180, step: 5 },
    { key: "centerX", label: "Center X", type: "slider", min: 0, max: 1, step: 0.05 },
    { key: "centerY", label: "Center Y", type: "slider", min: 0, max: 1, step: 0.05 },
    { key: "innerRadius", label: "Inner Radius", type: "slider", min: 0.01, max: 0.5, step: 0.01 },
    { key: "outerRadius", label: "Outer Radius", type: "slider", min: 0.5, max: 1.5, step: 0.05 },
    { key: "animated", label: "Animated", type: "checkbox" },
    { key: "speed", label: "Speed", type: "slider", min: 0.1, max: 3, step: 0.1 },
  ],
  processor: (data, { width, height, time = 0 }, params) => {
    const zoom = (params.zoom as number) ?? 2.0;
    const rotationDeg = (params.rotation as number) ?? 30;
    const cxParam = (params.centerX as number) ?? 0.5;
    const cyParam = (params.centerY as number) ?? 0.5;
    const innerRadius = (params.innerRadius as number) ?? 0.1;
    const outerRadius = (params.outerRadius as number) ?? 0.9;
    const animated = (params.animated as boolean) ?? true;
    const speed = (params.speed as number) ?? 0.5;

    const source = scratchCopy(data, "droste/source");
    const cx = cxParam * width;
    const cy = cyParam * height;
    const maxDim = Math.max(width, height);

    // Droste transform uses complex logarithm
    const rotRad = (rotationDeg * Math.PI) / 180;
    const _logZoom = Math.log(zoom);
    const timeOffset = animated ? time * speed : 0;

    // Complex number helpers for Droste spiral
    const r1 = innerRadius * maxDim * 0.5;
    const r2 = outerRadius * maxDim * 0.5;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - cx;
        const dy = y - cy;

        const dist = Math.sqrt(dx * dx + dy * dy);
        let angle = Math.atan2(dy, dx);

        if (dist < 0.5) {
          // Skip center pixel
          continue;
        }

        // Log-polar transform
        let logDist = Math.log(dist / r1);
        logDist += timeOffset; // Animated zoom
        angle += rotRad;

        // Wrap into repeating annular region
        const period = Math.log(r2 / r1);
        if (period > 0.01) {
          // Apply spiral rotation during wrap
          const wraps = logDist / period;
          const fracWrap = wraps - Math.floor(wraps);
          logDist = fracWrap * period;
          angle += Math.floor(wraps) * rotRad;
        }

        // Back to Cartesian
        const newDist = r1 * Math.exp(logDist);
        const srcX = cx + Math.cos(angle) * newDist;
        const srcY = cy + Math.sin(angle) * newDist;

        const sx = clamp(Math.floor(srcX), 0, width - 1);
        const sy = clamp(Math.floor(srcY), 0, height - 1);

        const dstIdx = (y * width + x) * 4;
        const srcIdx = (sy * width + sx) * 4;
        data[dstIdx] = source[srcIdx];
        data[dstIdx + 1] = source[srcIdx + 1];
        data[dstIdx + 2] = source[srcIdx + 2];
      }
    }
  },
});
