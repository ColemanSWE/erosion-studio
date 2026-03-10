import { registerEffect, ProcessConfig } from "../effect-registry";
import { EffectType, EffectParamConfig } from "../types";
import { FaceBounds, HandBounds, PoseBounds, getEyeLandmarks, getMouthLandmarks, getLandmarkBounds } from "../face-detector";
import { BAYER_MATRIX_4x4, motionSmearState, datamoshState, blockShovingState, bilinearSample, meltState, perlinNoise, posterizeTimeCache, pseudoRandom, clamp, clamp255, sortSegment, sortSegmentV, getBlockAverage, hexToRgb, rgbToHsl, hslToRgb, isPointInFaceBounds, frameHistoryStore, storeFrame, getFrameFromHistory } from "./shared";

registerEffect({
  type: "contrast",
  label: "Contrast",
  category: "standard",
  defaultParams: { value: 100 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_value;
void main() {
  float contrast = u_value;
  float factor = (259.0 * (contrast + 255.0)) / (255.0 * (259.0 - contrast));
  vec4 c = texture(u_source, v_texCoord);
  fragColor = vec4(clamp(factor * (c.rgb - 0.502) + 0.502, 0.0, 1.0), c.a);
}`,
    uniforms: { value: "float" },
  },
  processor: (data, _, params) => {
    const contrast = (params.value as number) || 100;
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp255(factor * (data[i] - 128) + 128);
      data[i + 1] = clamp255(factor * (data[i + 1] - 128) + 128);
      data[i + 2] = clamp255(factor * (data[i + 2] - 128) + 128);
    }
  },
});

registerEffect({
  type: "brightness",
  label: "Brightness",
  category: "standard",
  defaultParams: { value: 0 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_value;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  fragColor = vec4(clamp(c.rgb + u_value / 255.0, 0.0, 1.0), c.a);
}`,
    uniforms: { value: "float" },
  },
  processor: (data, _, params) => {
    const brightness = (params.value as number) || 0;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp255(data[i] + brightness);
      data[i + 1] = clamp255(data[i + 1] + brightness);
      data[i + 2] = clamp255(data[i + 2] + brightness);
    }
  },
});

registerEffect({
  type: "saturation",
  label: "Saturation",
  category: "standard",
  defaultParams: { value: 100 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_value;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  float s = u_value / 100.0;
  float grey = dot(c.rgb, vec3(0.2989, 0.587, 0.114));
  fragColor = vec4(clamp(grey + s * (c.rgb - grey), 0.0, 1.0), c.a);
}`,
    uniforms: { value: "float" },
  },
  processor: (data, _, params) => {
    const saturation = (params.value as number) || 100;
    const s = saturation / 100;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const grey = 0.2989 * r + 0.587 * g + 0.114 * b;
      data[i] = clamp255(grey + s * (r - grey));
      data[i + 1] = clamp255(grey + s * (g - grey));
      data[i + 2] = clamp255(grey + s * (b - grey));
    }
  },
});

registerEffect({
  type: "exposure",
  label: "Exposure",
  category: "standard",
  defaultParams: { value: 0 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_value;
void main() {
  float factor = pow(2.0, u_value / 100.0);
  vec4 c = texture(u_source, v_texCoord);
  fragColor = vec4(clamp(c.rgb * factor, 0.0, 1.0), c.a);
}`,
    uniforms: { value: "float" },
  },
  processor: (data, _, params) => {
    const exposure = (params.value as number) || 0;
    const factor = Math.pow(2, exposure / 100);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp255(data[i] * factor);
      data[i + 1] = clamp255(data[i + 1] * factor);
      data[i + 2] = clamp255(data[i + 2] * factor);
    }
  },
});

registerEffect({
  type: "grayscale",
  label: "Grayscale",
  category: "standard",
  defaultParams: { value: 100 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_value;
void main() {
  float factor = u_value / 100.0;
  vec4 c = texture(u_source, v_texCoord);
  float grey = dot(c.rgb, vec3(0.2989, 0.587, 0.114));
  fragColor = vec4(mix(c.rgb, vec3(grey), factor), c.a);
}`,
    uniforms: { value: "float" },
  },
  processor: (data, _, params) => {
    const intensity = (params.value as number) || 100;
    const factor = intensity / 100;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const grey = 0.2989 * r + 0.587 * g + 0.114 * b;
      data[i] = clamp255(r * (1 - factor) + grey * factor);
      data[i + 1] = clamp255(g * (1 - factor) + grey * factor);
      data[i + 2] = clamp255(b * (1 - factor) + grey * factor);
    }
  },
});

registerEffect({
  type: "sepia",
  label: "Sepia",
  category: "standard",
  defaultParams: { value: 100 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_value;
void main() {
  float factor = u_value / 100.0;
  vec4 c = texture(u_source, v_texCoord);
  float r = c.r, g = c.g, b = c.b;
  vec3 sepia = vec3(
    r * 0.393 + g * 0.769 + b * 0.189,
    r * 0.349 + g * 0.686 + b * 0.168,
    r * 0.272 + g * 0.534 + b * 0.131
  );
  fragColor = vec4(clamp(mix(c.rgb, sepia, factor), 0.0, 1.0), c.a);
}`,
    uniforms: { value: "float" },
  },
  processor: (data, _, params) => {
    const intensity = (params.value as number) || 100;
    const factor = intensity / 100;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const tr = 0.393 * r + 0.769 * g + 0.189 * b;
      const tg = 0.349 * r + 0.686 * g + 0.168 * b;
      const tb = 0.272 * r + 0.534 * g + 0.131 * b;
      data[i] = clamp255(r * (1 - factor) + tr * factor);
      data[i + 1] = clamp255(g * (1 - factor) + tg * factor);
      data[i + 2] = clamp255(b * (1 - factor) + tb * factor);
    }
  },
});

registerEffect({
  type: "temperature",
  label: "Temperature",
  category: "standard",
  defaultParams: { value: 0 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_value;
void main() {
  float adj = u_value / 255.0;
  vec4 c = texture(u_source, v_texCoord);
  fragColor = vec4(clamp(c.r + adj, 0.0, 1.0), c.g, clamp(c.b - adj, 0.0, 1.0), c.a);
}`,
    uniforms: { value: "float" },
  },
  processor: (data, _, params) => {
    const temp = (params.value as number) || 0;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp255(data[i] + temp);
      data[i + 2] = clamp255(data[i + 2] - temp);
    }
  },
});

registerEffect({
  type: "tint",
  label: "Tint",
  category: "standard",
  defaultParams: { value: 0 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_value;
void main() {
  float adj = u_value / 255.0;
  vec4 c = texture(u_source, v_texCoord);
  fragColor = vec4(c.r, clamp(c.g + adj, 0.0, 1.0), c.b, c.a);
}`,
    uniforms: { value: "float" },
  },
  processor: (data, _, params) => {
    const tint = (params.value as number) || 0;
    for (let i = 0; i < data.length; i += 4) {
      data[i + 1] = clamp255(data[i + 1] + tint);
    }
  },
});