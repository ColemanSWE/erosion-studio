import { registerEffect } from "../../effect-registry";
import { clamp, scratchFloats } from "../shared";

// ─── 2. Neon Wireframe ─────────────────────────────────────────────────────────
// Edge detection → black background → thick neon-glowing edges. Tron/cyberpunk.
registerEffect({
  type: "neon-wireframe",
  experimental: true,
  label: "Neon Wireframe",
  category: "style",
  defaultParams: {
    threshold: 40,
    glowRadius: 8,
    glowIntensity: 2.0,
    color: "#00ffff",
    secondaryColor: "#ff00ff",
    dualTone: true,
    lineBoost: 2.5,
  },
  paramsConfig: [
    { key: "threshold", label: "Edge Threshold", type: "slider", min: 10, max: 200, step: 5 },
    { key: "glowRadius", label: "Glow Radius", type: "slider", min: 1, max: 30, step: 1 },
    { key: "glowIntensity", label: "Glow Intensity", type: "slider", min: 0.5, max: 5, step: 0.25 },
    { key: "color", label: "Primary Color", type: "color" },
    { key: "secondaryColor", label: "Secondary Color", type: "color" },
    { key: "dualTone", label: "Dual Tone", type: "checkbox" },
    { key: "lineBoost", label: "Line Boost", type: "slider", min: 1, max: 5, step: 0.25 },
  ],
  glsl: {
    multiPass: () => 3,
    uniforms: {
      threshold: "float", glowRadius: "float", glowIntensity: "float",
      color: "vec3", secondaryColor: "vec3", dualTone: "int", lineBoost: "float",
    },
    uniformMapper: (params) => {
      const parseHex = (hex: string): [number, number, number] => {
        const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex as string);
        return r ? [parseInt(r[1], 16) / 255, parseInt(r[2], 16) / 255, parseInt(r[3], 16) / 255] : [0, 1, 1];
      };
      return {
        threshold: params.threshold,
        glowRadius: params.glowRadius,
        glowIntensity: params.glowIntensity,
        color: parseHex(params.color as string),
        secondaryColor: parseHex(params.secondaryColor as string),
        dualTone: params.dualTone ? 1 : 0,
        lineBoost: params.lineBoost,
      };
    },
    fragment: `
uniform float u_threshold;
uniform float u_glowRadius;
uniform float u_glowIntensity;
uniform vec3 u_color;
uniform vec3 u_secondaryColor;
uniform int u_dualTone;
uniform float u_lineBoost;
uniform int u_pass;

float sobelMag(vec2 uv, vec2 tx) {
  vec3 luma = vec3(0.299, 0.587, 0.114);
  float tl = dot(texture(u_source, uv + vec2(-tx.x,-tx.y)).rgb, luma);
  float tm = dot(texture(u_source, uv + vec2( 0.0, -tx.y)).rgb, luma);
  float tr = dot(texture(u_source, uv + vec2( tx.x,-tx.y)).rgb, luma);
  float ml = dot(texture(u_source, uv + vec2(-tx.x,  0.0)).rgb, luma);
  float mr = dot(texture(u_source, uv + vec2( tx.x,  0.0)).rgb, luma);
  float bl = dot(texture(u_source, uv + vec2(-tx.x,  tx.y)).rgb, luma);
  float bm = dot(texture(u_source, uv + vec2( 0.0,   tx.y)).rgb, luma);
  float br = dot(texture(u_source, uv + vec2( tx.x,  tx.y)).rgb, luma);
  float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
  float gy = -tl - 2.0*tm - tr + bl + 2.0*bm + br;
  return length(vec2(gx, gy));
}

float sobelAngle(vec2 uv, vec2 tx) {
  vec3 luma = vec3(0.299, 0.587, 0.114);
  float tl = dot(texture(u_source, uv + vec2(-tx.x,-tx.y)).rgb, luma);
  float tm = dot(texture(u_source, uv + vec2( 0.0, -tx.y)).rgb, luma);
  float tr = dot(texture(u_source, uv + vec2( tx.x,-tx.y)).rgb, luma);
  float ml = dot(texture(u_source, uv + vec2(-tx.x,  0.0)).rgb, luma);
  float mr = dot(texture(u_source, uv + vec2( tx.x,  0.0)).rgb, luma);
  float bl = dot(texture(u_source, uv + vec2(-tx.x,  tx.y)).rgb, luma);
  float bm = dot(texture(u_source, uv + vec2( 0.0,   tx.y)).rgb, luma);
  float br = dot(texture(u_source, uv + vec2( tx.x,  tx.y)).rgb, luma);
  float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
  float gy = -tl - 2.0*tm - tr + bl + 2.0*bm + br;
  return atan(gy, gx);
}

void main() {
  vec2 tx = 1.0 / u_resolution;
  float thresh = u_threshold / 255.0;

  if (u_pass == 0) {
    float mag = sobelMag(v_texCoord, tx);
    float edge = mag > thresh ? clamp(mag * u_lineBoost, 0.0, 1.0) : 0.0;
    fragColor = vec4(texture(u_source, v_texCoord).rgb, edge);
    return;
  }

  if (u_pass == 1) {
    float blurA = 0.0, totalW = 0.0;
    float step = u_glowRadius / 7.0 / u_resolution.x;
    for (int k = -7; k <= 7; k++) {
      float w = exp(-float(k * k) / 8.0);
      blurA += texture(u_source, clamp(v_texCoord + vec2(float(k) * step, 0.0), vec2(0.0), vec2(1.0))).a * w;
      totalW += w;
    }
    fragColor = vec4(texture(u_source, v_texCoord).rgb, blurA / totalW);
    return;
  }

  float blurA = 0.0, totalW = 0.0;
  float step = u_glowRadius / 7.0 / u_resolution.y;
  for (int k = -7; k <= 7; k++) {
    float w = exp(-float(k * k) / 8.0);
    blurA += texture(u_source, clamp(v_texCoord + vec2(0.0, float(k) * step), vec2(0.0), vec2(1.0))).a * w;
    totalW += w;
  }
  float glow = blurA / totalW;

  float mag = sobelMag(v_texCoord, tx);
  float sharpEdge = mag > thresh ? clamp(mag * u_lineBoost, 0.0, 1.0) : 0.0;

  vec3 edgeColor;
  if (u_dualTone == 1) {
    float angle = sobelAngle(v_texCoord, tx);
    float t = (sin(angle) + 1.0) * 0.5;
    edgeColor = mix(u_color, u_secondaryColor, t);
  } else {
    edgeColor = u_color;
  }

  float combined = min(sharpEdge + glow * u_glowIntensity, 1.0);
  fragColor = vec4(edgeColor * combined, 1.0);
}`,
  },
  processor: (data, { width, height }, params) => {
    const threshold = (params.threshold as number) ?? 40;
    const glowRadius = (params.glowRadius as number) ?? 8;
    const glowIntensity = (params.glowIntensity as number) ?? 2.0;
    const color = (params.color as string) ?? "#00ffff";
    const secondaryColor = (params.secondaryColor as string) ?? "#ff00ff";
    const dualTone = (params.dualTone as boolean) ?? true;
    const lineBoost = (params.lineBoost as number) ?? 2.5;

    // Parse colors
    const parseHex = (hex: string) => {
      const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return r ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)] : [0, 255, 255];
    };
    const c1 = parseHex(color);
    const c2 = parseHex(secondaryColor);

    // Build grayscale
    const gray = scratchFloats(width * height, "neon-wireframe/gray");
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      gray[i] = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
    }

    // Sobel edge detection
    const edges = scratchFloats(width * height, "neon-wireframe/edges");
    const edgeAngles = scratchFloats(width * height, "neon-wireframe/edgeAngles");
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const pos = y * width + x;
        const gx =
          -gray[pos - width - 1] - 2 * gray[pos - 1] - gray[pos + width - 1] +
          gray[pos - width + 1] + 2 * gray[pos + 1] + gray[pos + width + 1];
        const gy =
          -gray[pos - width - 1] - 2 * gray[pos - width] - gray[pos - width + 1] +
          gray[pos + width - 1] + 2 * gray[pos + width] + gray[pos + width + 1];
        edges[pos] = Math.sqrt(gx * gx + gy * gy);
        edgeAngles[pos] = Math.atan2(gy, gx);
      }
    }

    // Apply threshold and boost
    const edgeMask = scratchFloats(width * height, "neon-wireframe/edgeMask");
    for (let i = 0; i < edges.length; i++) {
      edgeMask[i] = edges[i] > threshold ? Math.min(edges[i] * lineBoost / 255, 1) : 0;
    }

    // Multi-pass box blur for glow effect
    const glowBuffer = new Float32Array(edgeMask);
    const passes = 3;
    for (let pass = 0; pass < passes; pass++) {
      const temp = new Float32Array(glowBuffer.length);
      const r = Math.ceil(glowRadius / passes);
      // Horizontal pass
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let sum = 0, count = 0;
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx;
            if (nx >= 0 && nx < width) {
              sum += glowBuffer[y * width + nx];
              count++;
            }
          }
          temp[y * width + x] = sum / count;
        }
      }
      // Vertical pass
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let sum = 0, count = 0;
          for (let dy = -r; dy <= r; dy++) {
            const ny = y + dy;
            if (ny >= 0 && ny < height) {
              sum += temp[ny * width + x];
              count++;
            }
          }
          glowBuffer[y * width + x] = sum / count;
        }
      }
    }

    // Composite: black background + glow + sharp edges
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      const edge = edgeMask[i];
      const glow = glowBuffer[i] * glowIntensity;

      // Choose color based on edge angle for dual-tone
      let cr: number, cg: number, cb: number;
      if (dualTone) {
        const t = (Math.sin(edgeAngles[i]) + 1) * 0.5; // 0..1
        cr = c1[0] * (1 - t) + c2[0] * t;
        cg = c1[1] * (1 - t) + c2[1] * t;
        cb = c1[2] * (1 - t) + c2[2] * t;
      } else {
        cr = c1[0]; cg = c1[1]; cb = c1[2];
      }

      // Combine sharp edge + soft glow
      const combined = Math.min(edge + glow, 1);
      data[idx] = clamp(Math.floor(cr * combined), 0, 255);
      data[idx + 1] = clamp(Math.floor(cg * combined), 0, 255);
      data[idx + 2] = clamp(Math.floor(cb * combined), 0, 255);
    }
  },
});
