import { registerEffect } from "../../effect-registry";
import { clamp } from "../shared";

// ─── 4. Glitch Displacement Map ────────────────────────────────────────────────
// Self-referential displacement using own luminance, with channel separation

registerEffect({
  type: "glitch-displacement",
  label: "Glitch Displacement",
  category: "distortion",
  defaultParams: { intensity: 30, iterations: 2, channelSeparate: true, direction: "horizontal", animated: true },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 1, max: 100, step: 1 },
    { key: "iterations", label: "Iterations", type: "slider", min: 1, max: 8, step: 1 },
    { key: "channelSeparate", label: "Channel Separate", type: "checkbox" },
    { key: "direction", label: "Direction", type: "select", options: ["horizontal", "vertical", "radial"] },
    { key: "animated", label: "Animated", type: "checkbox" },
  ],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform bool u_channelSeparate;
uniform int u_direction;
uniform bool u_animated;
void main() {
  float t = u_animated ? u_time * 0.05 : 0.0;
  vec4 s = texture(u_source, v_texCoord);
  float lum = (s.r + s.g + s.b) / 3.0 - 0.5;
  float displace = lum * u_intensity;
  if (u_channelSeparate) {
    vec3 result;
    for (int ch = 0; ch < 3; ch++) {
      float chScale = 1.0 + float(ch) * 0.3;
      float d = displace * chScale + (u_animated ? sin(t + float(ch) * 2.1) * 3.0 : 0.0);
      vec2 srcUV = v_texCoord;
      if (u_direction == 0)      srcUV.x = clamp(v_texCoord.x + d / u_resolution.x, 0.0, 1.0);
      else if (u_direction == 1) srcUV.y = clamp(v_texCoord.y + d / u_resolution.y, 0.0, 1.0);
      else {
        vec2 dir2 = normalize(v_texCoord - 0.5);
        srcUV = clamp(v_texCoord + dir2 * d / u_resolution, 0.0, 1.0);
      }
      if (ch == 0) result.r = texture(u_source, srcUV).r;
      else if (ch == 1) result.g = texture(u_source, srcUV).g;
      else result.b = texture(u_source, srcUV).b;
    }
    fragColor = vec4(result, s.a);
  } else {
    float d = displace + (u_animated ? sin(t + v_texCoord.y * u_resolution.y * 0.01) * 5.0 : 0.0);
    vec2 srcUV = v_texCoord;
    if (u_direction == 0)      srcUV.x = clamp(v_texCoord.x + d / u_resolution.x, 0.0, 1.0);
    else if (u_direction == 1) srcUV.y = clamp(v_texCoord.y + d / u_resolution.y, 0.0, 1.0);
    else {
      vec2 dir2 = normalize(v_texCoord - 0.5);
      srcUV = clamp(v_texCoord + dir2 * d / u_resolution, 0.0, 1.0);
    }
    fragColor = texture(u_source, srcUV);
  }
}`,
    uniforms: { intensity: "float", channelSeparate: "bool", direction: "int", animated: "bool" },
    uniformMapper: (p) => ({
      ...p,
      direction: ["horizontal", "vertical", "radial"].indexOf((p.direction as string) || "horizontal"),
    }),
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) ?? 30;
    const iterations = (params.iterations as number) ?? 2;
    const channelSeparate = (params.channelSeparate as boolean) ?? true;
    const direction = (params.direction as string) ?? "horizontal";
    const animated = (params.animated as boolean) ?? true;

    const cx = width / 2;
    const cy = height / 2;
    const t = animated ? time * 0.05 : 0;

    let current = new Uint8ClampedArray(data);

    for (let iter = 0; iter < iterations; iter++) {
      const output = new Uint8ClampedArray(current);
      const scale = intensity * (1 - iter * 0.15);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const lum = (current[idx] + current[idx + 1] + current[idx + 2]) / 3 / 255;
          const displace = (lum - 0.5) * scale;

          if (channelSeparate) {
            // Each channel displaced differently
            for (let ch = 0; ch < 3; ch++) {
              const chScale = 1 + ch * 0.3;
              const d = displace * chScale + (animated ? Math.sin(t + ch * 2.1) * 3 : 0);

              let srcX = x, srcY = y;
              if (direction === "horizontal") {
                srcX = clamp(Math.floor(x + d), 0, width - 1);
              } else if (direction === "vertical") {
                srcY = clamp(Math.floor(y + d), 0, height - 1);
              } else { // radial
                const dx = x - cx, dy = y - cy;
                const angle = Math.atan2(dy, dx);
                srcX = clamp(Math.floor(x + Math.cos(angle) * d), 0, width - 1);
                srcY = clamp(Math.floor(y + Math.sin(angle) * d), 0, height - 1);
              }

              output[idx + ch] = current[(srcY * width + srcX) * 4 + ch];
            }
          } else {
            const d = displace + (animated ? Math.sin(t + y * 0.01) * 5 : 0);
            let srcX = x, srcY = y;

            if (direction === "horizontal") {
              srcX = clamp(Math.floor(x + d), 0, width - 1);
            } else if (direction === "vertical") {
              srcY = clamp(Math.floor(y + d), 0, height - 1);
            } else {
              const dx = x - cx, dy = y - cy;
              const angle = Math.atan2(dy, dx);
              srcX = clamp(Math.floor(x + Math.cos(angle) * d), 0, width - 1);
              srcY = clamp(Math.floor(y + Math.sin(angle) * d), 0, height - 1);
            }

            const srcIdx = (srcY * width + srcX) * 4;
            output[idx] = current[srcIdx];
            output[idx + 1] = current[srcIdx + 1];
            output[idx + 2] = current[srcIdx + 2];
          }
        }
      }

      current = output;
    }

    data.set(current);
  },
});
