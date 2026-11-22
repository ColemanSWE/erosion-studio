import { registerEffect } from "../../effect-registry";
import { hslToRgb, scratchFloats } from "../shared";

registerEffect({
  type: "holographic",
  label: "Holographic",
  category: "color",
  defaultParams: { intensity: 0.8, speed: 1.0, angle: 45, bands: 10, blend: "screen" },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 1, step: 0.05 },
    { key: "speed", label: "Speed", type: "slider", min: 0, max: 5, step: 0.1 },
    { key: "angle", label: "Angle", type: "slider", min: 0, max: 360, step: 5 },
    { key: "bands", label: "Band Density", type: "slider", min: 1, max: 30, step: 1 },
    { key: "blend", label: "Blend Mode", type: "select", options: ["screen", "overlay", "add"] },
  ],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform float u_speed;
uniform float u_angleRad;
uniform float u_bands;
uniform int u_blend;
void main() {
  vec2 uv = v_texCoord;
  vec2 px = 1.0 / u_resolution;
  vec4 c = texture(u_source, uv);
  float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));

  // Sobel gradient — warps band positions to follow image contours
  float l00 = dot(texture(u_source, uv + vec2(-px.x, -px.y)).rgb, vec3(0.299, 0.587, 0.114));
  float l20 = dot(texture(u_source, uv + vec2( px.x, -px.y)).rgb, vec3(0.299, 0.587, 0.114));
  float l01 = dot(texture(u_source, uv + vec2(-px.x,  0.0)).rgb, vec3(0.299, 0.587, 0.114));
  float l21 = dot(texture(u_source, uv + vec2( px.x,  0.0)).rgb, vec3(0.299, 0.587, 0.114));
  float l02 = dot(texture(u_source, uv + vec2(-px.x,  px.y)).rgb, vec3(0.299, 0.587, 0.114));
  float l22 = dot(texture(u_source, uv + vec2( px.x,  px.y)).rgb, vec3(0.299, 0.587, 0.114));
  float gx = (l20 + 2.0*l21 + l22) - (l00 + 2.0*l01 + l02);
  float gy = (l02 + 2.0*dot(texture(u_source, uv + vec2(0.0, px.y)).rgb, vec3(0.299,0.587,0.114)) + l22)
           - (l00 + 2.0*dot(texture(u_source, uv - vec2(0.0, px.y)).rgb, vec3(0.299,0.587,0.114)) + l20);

  float cosA = cos(u_angleRad);
  float sinA = sin(u_angleRad);
  float t = u_time * u_speed * 0.04;

  vec2 centered = uv - 0.5;
  float posAlong = centered.x * cosA + centered.y * sinA;
  float gradAlong = gx * cosA + gy * sinA;
  float phase = posAlong * u_bands + gradAlong * u_bands * 0.8 + t;
  float h = fract(phase);
  vec3 holoRgb = hslToRgb(h * 360.0, 1.0, 0.58);

  float eff = u_intensity * (0.15 + lum * 0.85);
  vec3 blended;
  if (u_blend == 1) { // overlay
    vec3 base = c.rgb;
    blended = mix(2.0 * base * holoRgb, 1.0 - 2.0*(1.0-base)*(1.0-holoRgb), step(0.5, base));
    blended = mix(c.rgb, blended, eff);
  } else if (u_blend == 2) { // add
    blended = min(c.rgb + holoRgb * eff, 1.0);
  } else { // screen
    vec3 s = 1.0 - (1.0 - c.rgb) * (1.0 - holoRgb);
    blended = mix(c.rgb, s, eff);
  }
  fragColor = vec4(blended, c.a);
}`,
    uniforms: { intensity: "float", speed: "float", angleRad: "float", bands: "float", blend: "int" },
    uniformMapper: (p) => ({
      ...p,
      angleRad: ((p.angle as number) ?? 45) * (Math.PI / 180),
      blend: ["screen", "overlay", "add"].indexOf((p.blend as string) ?? "screen"),
    }),
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) ?? 0.8;
    const speed = (params.speed as number) ?? 1.0;
    const angle = ((params.angle as number) ?? 45) * (Math.PI / 180);
    const bands = (params.bands as number) ?? 10;
    const blend = (params.blend as string) ?? "screen";

    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const t = time * speed * 0.04;

    // Build luma map once — used for both the surface-normal warp and the intensity mask
    const luma = scratchFloats(width * height, "holographic/luma");
    for (let k = 0; k < width * height; k++) {
      luma[k] = (data[k * 4] * 0.299 + data[k * 4 + 1] * 0.587 + data[k * 4 + 2] * 0.114) / 255;
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const lum = luma[y * width + x];

        // Sobel gradient: proxy for the surface normal at this pixel.
        // The gradient direction and magnitude determine how the band positions warp,
        // so colors "follow" the image's contours — the key visual property of
        // holographic foil vs a plain rainbow gradient.
        let gx = 0, gy = 0;
        if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
          gx = luma[y * width + x + 1] - luma[y * width + x - 1];
          gy = luma[(y + 1) * width + x] - luma[(y - 1) * width + x];
        }

        // Signed position along the light-direction axis (−0.5 → +0.5)
        const nx = x / width - 0.5;
        const ny = y / height - 0.5;
        const posAlong = nx * cosA + ny * sinA;

        // Gradient component along the same axis — displaces band positions so they
        // track image structure rather than sitting as a flat overlay
        const gradAlong = gx * cosA + gy * sinA;

        // Phase = many tight band cycles + gradient warp + time tilt
        const phase = posAlong * bands + gradAlong * bands * 0.8 + t;
        const hue = ((phase % 1) + 1) % 1;

        const [hr, hg, hb] = hslToRgb(hue * 360, 1.0, 0.58);

        // Luminance mask: highlights catch more foil shimmer; pure black reflects nothing
        const eff = intensity * (0.15 + lum * 0.85);

        let fr: number, fg: number, fb: number;

        if (blend === "overlay") {
          const ov = (base: number, top: number) => {
            const b = base / 255;
            const tp = top / 255;
            return (b < 0.5 ? 2 * b * tp : 1 - 2 * (1 - b) * (1 - tp)) * 255;
          };
          fr = ov(data[i], hr);
          fg = ov(data[i + 1], hg);
          fb = ov(data[i + 2], hb);
        } else if (blend === "add") {
          fr = Math.min(255, data[i] + hr);
          fg = Math.min(255, data[i + 1] + hg);
          fb = Math.min(255, data[i + 2] + hb);
        } else {
          fr = 255 - ((255 - data[i]) * (255 - hr)) / 255;
          fg = 255 - ((255 - data[i + 1]) * (255 - hg)) / 255;
          fb = 255 - ((255 - data[i + 2]) * (255 - hb)) / 255;
        }

        data[i] = data[i] * (1 - eff) + fr * eff;
        data[i + 1] = data[i + 1] * (1 - eff) + fg * eff;
        data[i + 2] = data[i + 2] * (1 - eff) + fb * eff;
      }
    }
  },
});
