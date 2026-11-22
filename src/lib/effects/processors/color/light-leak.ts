import { registerEffect } from "../../effect-registry";

registerEffect({
  type: "light-leak",
  label: "Light Leak",
  category: "color",
  defaultParams: { intensity: 0.7, speed: 0.5, warmth: 0.7, style: "subtle", count: 2 },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 1, step: 0.05 },
    { key: "speed", label: "Speed", type: "slider", min: 0, max: 3, step: 0.1 },
    { key: "warmth", label: "Warmth", type: "slider", min: 0, max: 1, step: 0.05 },
    { key: "style", label: "Style", type: "select", options: ["subtle", "burn", "flare", "edge"] },
    { key: "count", label: "Leak Count", type: "slider", min: 1, max: 4, step: 1 },
  ],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform float u_speed;
uniform float u_warmth;
uniform int u_style;
uniform int u_count;

// Warm film colors in linear space: amber, magenta, cyan, orange, rose
const vec3 LEAK_COLORS[5] = vec3[5](
  vec3(1.0,    0.627, 0.196),
  vec3(1.0,    0.314, 0.549),
  vec3(0.314,  0.784, 1.0),
  vec3(1.0,    0.471, 0.078),
  vec3(0.863,  0.235, 0.392)
);

void main() {
  vec2 uv = v_texCoord;
  vec4 c = texture(u_source, uv);
  float t = u_time * u_speed;
  vec3 leak = vec3(0.0);

  for (int li = 0; li < 4; li++) {
    if (li >= u_count) break;
    float seed = float(li) * 7.3 + 1.0;
    vec3 rawColor = LEAK_COLORS[li % 5];
    vec3 tinted = mix(rawColor, vec3(1.0, 0.784, 0.588), 1.0 - u_warmth);

    float cx = 0.5 + sin(seed * 2.1 + t * 0.3) * 0.4;
    float cy = 0.5 + cos(seed * 1.7 + t * 0.2) * 0.4;
    float baseRadius = u_style == 3 ? 1.2 : (u_style == 2 ? 0.6 : 0.5);
    float radius = baseRadius * (0.4 + 0.3 * sin(seed + t * 0.15));
    float leakInt = u_intensity * (0.5 + 0.5 * sin(seed * 3.1 + t * 0.4));

    float alpha;
    if (u_style == 3) { // edge
      float edgeDist = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));
      alpha = max(0.0, 1.0 - edgeDist * 8.0) * leakInt;
    } else {
      vec2 delta = uv - vec2(cx, cy);
      delta.x *= u_resolution.x / max(u_resolution.x, u_resolution.y);
      delta.y *= u_resolution.y / max(u_resolution.x, u_resolution.y);
      float dist = length(delta) / radius;
      float falloff = u_style == 2 ? 2.5 : 1.5;
      alpha = max(0.0, 1.0 - pow(dist, falloff)) * leakInt;
    }

    leak += tinted * alpha;
  }

  // Screen blend
  vec3 result = 1.0 - (1.0 - c.rgb) * (1.0 - leak);
  fragColor = vec4(result, c.a);
}`,
    uniforms: { intensity: "float", speed: "float", warmth: "float", style: "int", count: "int" },
    uniformMapper: (p) => ({
      ...p,
      style: ["subtle", "burn", "flare", "edge"].indexOf((p.style as string) ?? "subtle"),
      count: Math.round((p.count as number) ?? 2),
    }),
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) ?? 0.7;
    const speed = (params.speed as number) ?? 0.5;
    const warmth = (params.warmth as number) ?? 0.7;
    const style = (params.style as string) ?? "subtle";
    const count = Math.round((params.count as number) ?? 2);

    const t = time * speed;

    // Warm film colors: amber, magenta, cyan, orange, rose
    const leakColors = [
      [255, 160, 50],   // amber
      [255, 80, 140],   // magenta
      [80, 200, 255],   // cyan
      [255, 120, 20],   // orange
      [220, 60, 100],   // rose
    ];

    for (let li = 0; li < count; li++) {
      const seed = li * 7.3 + 1.0;
      const colorIdx = li % leakColors.length;
      const [lr, lg, lb] = leakColors[colorIdx];

      const cx = (0.5 + Math.sin(seed * 2.1 + t * 0.3) * 0.4) * width;
      const cy = (0.5 + Math.cos(seed * 1.7 + t * 0.2) * 0.4) * height;

      const baseRadius = (style === "edge" ? 1.2 : style === "flare" ? 0.6 : 0.5) * Math.max(width, height);
      const radius = baseRadius * (0.4 + 0.3 * Math.sin(seed + t * 0.15));
      const leakIntensity = intensity * (0.5 + 0.5 * Math.sin(seed * 3.1 + t * 0.4));

      // Blend warm tint into color
      const tr = lr * warmth + 255 * (1 - warmth);
      const tg = lg * warmth + 200 * (1 - warmth);
      const tb = lb * warmth + 150 * (1 - warmth);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          let alpha;

          if (style === "edge") {
            const edgeDist = Math.min(x, y, width - 1 - x, height - 1 - y) / Math.max(width, height);
            alpha = Math.max(0, 1 - edgeDist * 8) * leakIntensity;
          } else {
            const dx = x - cx;
            const dy = y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const falloff = style === "flare" ? 2.5 : 1.5;
            alpha = Math.max(0, 1 - Math.pow(dist / radius, falloff)) * leakIntensity;
          }

          if (alpha <= 0) continue;

          // Screen blend for light leak look
          data[i] = Math.min(255, data[i] + (255 - data[i]) * (tr / 255) * alpha);
          data[i + 1] = Math.min(255, data[i + 1] + (255 - data[i + 1]) * (tg / 255) * alpha);
          data[i + 2] = Math.min(255, data[i + 2] + (255 - data[i + 2]) * (tb / 255) * alpha);
        }
      }
    }
  },
});
