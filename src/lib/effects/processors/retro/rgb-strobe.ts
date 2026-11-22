import { registerEffect } from "../../effect-registry";

registerEffect({
  type: "rgb-strobe",
  label: "RGB Strobe",
  category: "retro",
  defaultParams: { rFreq: 8, gFreq: 6, bFreq: 10, intensity: 0.8 },
  paramsConfig: [
    { key: "rFreq", label: "Red Frequency", type: "slider", min: 1, max: 30, default: 8 },
    { key: "gFreq", label: "Green Frequency", type: "slider", min: 1, max: 30, default: 6 },
    { key: "bFreq", label: "Blue Frequency", type: "slider", min: 1, max: 30, default: 10 },
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 2, step: 0.1, default: 0.8 },
  ],
  glsl: {
    fragment: `
uniform float u_rFreq;
uniform float u_gFreq;
uniform float u_bFreq;
uniform float u_intensity;
void main() {
  float t = u_time * 0.1;
  float rMult = 1.0 + (sin(t * u_rFreq) > 0.0 ? 1.0 : 0.0) * u_intensity;
  float gMult = 1.0 + (sin(t * u_gFreq) > 0.0 ? 1.0 : 0.0) * u_intensity;
  float bMult = 1.0 + (sin(t * u_bFreq) > 0.0 ? 1.0 : 0.0) * u_intensity;
  vec4 c = texture(u_source, v_texCoord);
  fragColor = vec4(clamp(c.r * rMult, 0.0, 1.0), clamp(c.g * gMult, 0.0, 1.0), clamp(c.b * bMult, 0.0, 1.0), c.a);
}`,
    uniforms: { rFreq: "float", gFreq: "float", bFreq: "float", intensity: "float" },
  },
  processor: (data, { time = 0 }, params) => {
    const rFreq = (params.rFreq as number) ?? 8;
    const gFreq = (params.gFreq as number) ?? 6;
    const bFreq = (params.bFreq as number) ?? 10;
    const intensity = (params.intensity as number) ?? 0.8;

    const t = time * 0.1;

    const rStrobe = Math.sin(t * rFreq) > 0 ? 1 : 0;
    const gStrobe = Math.sin(t * gFreq) > 0 ? 1 : 0;
    const bStrobe = Math.sin(t * bFreq) > 0 ? 1 : 0;

    const rMult = 1 + rStrobe * intensity;
    const gMult = 1 + gStrobe * intensity;
    const bMult = 1 + bStrobe * intensity;

    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, data[i] * rMult);
      data[i + 1] = Math.min(255, data[i + 1] * gMult);
      data[i + 2] = Math.min(255, data[i + 2] * bMult);
    }
  },
});
