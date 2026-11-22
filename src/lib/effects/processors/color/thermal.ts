import { registerEffect } from "../../effect-registry";

registerEffect({
  type: "thermal",
  label: "Thermal",
  category: "color",
  defaultParams: { palette: "thermal" },
  paramsConfig: [
    { key: "palette", label: "Palette", type: "select", options: ["thermal", "infrared", "night-vision"], default: "thermal" },
  ],
  glsl: {
    fragment: `
uniform int u_palette;
vec3 thermalColor(float t) {
  // 8-stop gradients encoded inline
  vec3 stops[8];
  if (u_palette == 1) { // night-vision
    stops[0]=vec3(0.0,0.0,0.0); stops[1]=vec3(0.0,0.078,0.0);
    stops[2]=vec3(0.0,0.235,0.0); stops[3]=vec3(0.0,0.471,0.0);
    stops[4]=vec3(0.0,0.706,0.0); stops[5]=vec3(0.196,0.863,0.196);
    stops[6]=vec3(0.588,1.0,0.588); stops[7]=vec3(0.863,1.0,0.863);
  } else if (u_palette == 2) { // infrared
    stops[0]=vec3(0.0,0.0,0.196); stops[1]=vec3(0.0,0.0,0.588);
    stops[2]=vec3(0.392,0.0,0.784); stops[3]=vec3(0.784,0.0,0.588);
    stops[4]=vec3(1.0,0.196,0.196); stops[5]=vec3(1.0,0.588,0.196);
    stops[6]=vec3(1.0,0.863,0.588); stops[7]=vec3(1.0,1.0,1.0);
  } else { // thermal (default)
    stops[0]=vec3(0.0,0.0,0.0); stops[1]=vec3(0.118,0.0,0.392);
    stops[2]=vec3(0.471,0.0,0.706); stops[3]=vec3(0.863,0.0,0.392);
    stops[4]=vec3(1.0,0.196,0.0); stops[5]=vec3(1.0,0.588,0.0);
    stops[6]=vec3(1.0,1.0,0.392); stops[7]=vec3(1.0,1.0,1.0);
  }
  float pos = t * 7.0;
  int idx = min(6, int(floor(pos)));
  float frac = fract(pos);
  return mix(stops[idx], stops[idx + 1], frac);
}
void main() {
  vec4 c = texture(u_source, v_texCoord);
  float lum = (c.r + c.g + c.b) / 3.0;
  fragColor = vec4(thermalColor(lum), c.a);
}`,
    uniforms: { palette: "int" },
    uniformMapper: (p) => ({
      ...p,
      palette: ["thermal", "night-vision", "infrared"].indexOf((p.palette as string) || "thermal"),
    }),
  },
  processor: (data, config, params) => {
    const palette = (params.palette as string) ?? "thermal";
    const gradients: Record<string, number[][]> = {
      thermal: [
        [0, 0, 0],
        [30, 0, 100],
        [120, 0, 180],
        [220, 0, 100],
        [255, 50, 0],
        [255, 150, 0],
        [255, 255, 100],
        [255, 255, 255],
      ],
      "night-vision": [
        [0, 0, 0],
        [0, 20, 0],
        [0, 60, 0],
        [0, 120, 0],
        [0, 180, 0],
        [50, 220, 50],
        [150, 255, 150],
        [220, 255, 220],
      ],
      infrared: [
        [0, 0, 50],
        [0, 0, 150],
        [100, 0, 200],
        [200, 0, 150],
        [255, 50, 50],
        [255, 150, 50],
        [255, 220, 150],
        [255, 255, 255],
      ],
    };

    const gradient = gradients[palette] || gradients.thermal;
    const len = gradient.length;

    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3 / 255;
      const pos = lum * (len - 1);
      const idx = Math.min(len - 2, Math.floor(pos));
      const t = pos - idx;

      data[i] =
        gradient[idx][0] + (gradient[idx + 1][0] - gradient[idx][0]) * t;
      data[i + 1] =
        gradient[idx][1] + (gradient[idx + 1][1] - gradient[idx][1]) * t;
      data[i + 2] =
        gradient[idx][2] + (gradient[idx + 1][2] - gradient[idx][2]) * t;
    }
  },
});
