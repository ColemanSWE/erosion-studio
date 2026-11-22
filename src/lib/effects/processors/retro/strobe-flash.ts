import { registerEffect } from "../../effect-registry";

registerEffect({
  type: "strobe-flash",
  label: "Strobe Flash",
  category: "retro",
  defaultParams: { frequency: 8, intensity: 1.0, pattern: "pulse" },
  paramsConfig: [
    { key: "frequency", label: "Frequency", type: "slider", min: 1, max: 30, default: 8 },
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 2, step: 0.1, default: 1 },
    { key: "pattern", label: "Pattern", type: "select", options: ["pulse", "saw", "square", "triangle"], default: "pulse" },
  ],
  glsl: {
    fragment: `
uniform float u_frequency;
uniform float u_intensity;
uniform int u_pattern;
void main() {
  float t = u_time * 0.1;
  float strobe;
  if (u_pattern == 1)      strobe = mod(t * u_frequency, 1.0);
  else if (u_pattern == 2) strobe = mod(floor(t * u_frequency), 2.0);
  else if (u_pattern == 3) { float ph = mod(t * u_frequency, 2.0); strobe = ph < 1.0 ? ph : 2.0 - ph; }
  else                     strobe = sin(t * u_frequency) > 0.0 ? 1.0 : 0.0;
  float mult = 1.0 + strobe * u_intensity;
  vec4 c = texture(u_source, v_texCoord);
  fragColor = vec4(clamp(c.rgb * mult, 0.0, 1.0), c.a);
}`,
    uniforms: { frequency: "float", intensity: "float", pattern: "int" },
    uniformMapper: (p) => ({
      ...p,
      pattern: ["pulse", "saw", "square", "triangle"].indexOf((p.pattern as string) || "pulse"),
    }),
  },
  processor: (data, { time = 0 }, params) => {
    const frequency = (params.frequency as number) ?? 8;
    const intensity = (params.intensity as number) ?? 1.0;
    const pattern = (params.pattern as string) ?? "pulse";

    const t = time * 0.1;
    let strobe: number;

    if (pattern === "pulse") {
      strobe = Math.sin(t * frequency) > 0 ? 1 : 0;
    } else if (pattern === "saw") {
      strobe = (t * frequency) % 1;
    } else if (pattern === "square") {
      strobe = Math.floor((t * frequency) % 2);
    } else {
      // triangle
      const phase = (t * frequency) % 2;
      strobe = phase < 1 ? phase : 2 - phase;
    }

    const mult = 1 + strobe * intensity;

    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, data[i] * mult);
      data[i + 1] = Math.min(255, data[i + 1] * mult);
      data[i + 2] = Math.min(255, data[i + 2] * mult);
    }
  },
});
