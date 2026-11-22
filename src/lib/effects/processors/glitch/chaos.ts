import { registerEffect } from "../../effect-registry";
import { clamp, scratchCopy } from "../shared";

registerEffect({
  type: "chaos",
  label: "Chaos",
  category: "glitch",
  defaultParams: { intensity: 50, layers: 3 },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 100, default: 50 },
    { key: "layers", label: "Layers", type: "slider", min: 1, max: 8, default: 3 },
  ],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform float u_layers;
void main() {
  float seed = floor(u_time * 2.0);
  vec2 uv = v_texCoord;
  float py = uv.y * u_resolution.y;
  float px = uv.x * u_resolution.x;
  int numLayers = int(u_layers);
  for (int layer = 0; layer < 4; layer++) {
    if (layer >= numLayers) break;
    float lseed = seed + float(layer) * 100.0;
    float effect = floor(pseudoRandom(lseed) * 5.0);
    float li = u_intensity * (0.5 + pseudoRandom(lseed + 1.0) * 0.5);
    if (effect < 1.0) {
      // Slice shift
      float numSlices = floor(5.0 + pseudoRandom(lseed + 2.0) * 20.0);
      for (int s = 0; s < 20; s++) {
        if (float(s) >= numSlices) break;
        float sy = pseudoRandom(lseed + float(s) * 200.0) * u_resolution.y;
        float sh = 1.0 + pseudoRandom(lseed + float(s) * 300.0) * 10.0;
        if (py >= sy && py < sy + sh) {
          float off = (pseudoRandom(lseed + float(s) * 400.0) - 0.5) * li * 2.0;
          uv.x = mod(px + off + u_resolution.x, u_resolution.x) / u_resolution.x;
          break;
        }
      }
    } else if (effect < 2.0) {
      // RGB separation
      float rgbOff = floor(li / 5.0) / u_resolution.x;
      uv.x = clamp(uv.x + (pseudoRandom(lseed + 10.0) - 0.5) * rgbOff * 4.0, 0.0, 1.0);
    } else if (effect < 3.0) {
      // Wave distortion
      float amp = li / 2.0;
      uv.x = clamp(uv.x + sin(py * 0.1 + u_time) * amp / u_resolution.x, 0.0, 1.0);
    }
  }
  vec4 c = texture(u_source, uv);
  fragColor = c;
}`,
    uniforms: { intensity: "float", layers: "float" },
  },
  processor: (data, { width, height }, params) => {
    const intensity = (params.intensity as number) ?? 50;
    const layers = (params.layers as number) ?? 3;
    if (intensity === 0) return;

    const source = scratchCopy(data, "chaos/source");

    for (let layer = 0; layer < layers; layer++) {
      const effect = Math.floor(Math.random() * 10);
      const layerIntensity = intensity * (0.5 + Math.random() * 0.5);

      if (effect === 0) {
        const numSlices = Math.floor(5 + Math.random() * 20);
        for (let s = 0; s < numSlices; s++) {
          const sliceY = Math.floor(Math.random() * height);
          const sliceH = Math.floor(1 + Math.random() * 10);
          const offset = Math.floor((Math.random() - 0.5) * layerIntensity * 2);

          for (let y = sliceY; y < Math.min(sliceY + sliceH, height); y++) {
            for (let x = 0; x < width; x++) {
              const srcX = (((x + offset) % width) + width) % width;
              const srcIdx = (y * width + srcX) * 4;
              const dstIdx = (y * width + x) * 4;
              data[dstIdx] = source[srcIdx];
              data[dstIdx + 1] = source[srcIdx + 1];
              data[dstIdx + 2] = source[srcIdx + 2];
            }
          }
        }
      } else if (effect === 1) {
        const rgbOffset = Math.floor(layerIntensity / 5);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const rX = clamp(
              x - rgbOffset + Math.floor(Math.random() * 4),
              0,
              width - 1,
            );
            const bX = clamp(
              x + rgbOffset + Math.floor(Math.random() * 4),
              0,
              width - 1,
            );
            data[idx] = source[(y * width + rX) * 4];
            data[idx + 2] = source[(y * width + bX) * 4 + 2];
          }
        }
      } else if (effect === 2) {
        const blockSize = Math.floor(8 + Math.random() * 32);
        const numBlocks = Math.floor(layerIntensity / 5);
        for (let b = 0; b < numBlocks; b++) {
          const bx = Math.floor(Math.random() * width);
          const by = Math.floor(Math.random() * height);
          const srcBx = Math.floor(Math.random() * width);
          const srcBy = Math.floor(Math.random() * height);

          for (let y = 0; y < blockSize; y++) {
            for (let x = 0; x < blockSize; x++) {
              if (
                by + y < height &&
                bx + x < width &&
                srcBy + y < height &&
                srcBx + x < width
              ) {
                const srcIdx = ((srcBy + y) * width + (srcBx + x)) * 4;
                const dstIdx = ((by + y) * width + (bx + x)) * 4;
                data[dstIdx] = source[srcIdx];
                data[dstIdx + 1] = source[srcIdx + 1];
                data[dstIdx + 2] = source[srcIdx + 2];
              }
            }
          }
        }
      } else if (effect === 3) {
        for (let i = 0; i < data.length; i += 4) {
          if (Math.random() < layerIntensity / 200) {
            data[i] = Math.random() * 255;
            data[i + 1] = Math.random() * 255;
            data[i + 2] = Math.random() * 255;
          }
        }
      } else if (effect === 4) {
        const amplitude = layerIntensity / 2;
        for (let y = 0; y < height; y++) {
          const offset = Math.floor(
            Math.sin(y * 0.1 + Math.random() * 10) * amplitude,
          );
          for (let x = 0; x < width; x++) {
            const srcX = clamp(x + offset, 0, width - 1);
            const srcIdx = (y * width + srcX) * 4;
            const dstIdx = (y * width + x) * 4;
            data[dstIdx] = source[srcIdx];
            data[dstIdx + 1] = source[srcIdx + 1];
            data[dstIdx + 2] = source[srcIdx + 2];
          }
        }
      } else if (effect === 5) {
        const rows = Math.floor(layerIntensity / 10);
        for (let r = 0; r < rows; r++) {
          const y = Math.floor(Math.random() * height);
          const channel = Math.floor(Math.random() * 3);
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            data[idx + channel] = Math.random() > 0.5 ? 255 : 0;
          }
        }
      } else if (effect === 6) {
        const regions = Math.floor(layerIntensity / 15);
        for (let r = 0; r < regions; r++) {
          const rx = Math.floor(Math.random() * width);
          const ry = Math.floor(Math.random() * height);
          const rw = Math.floor(20 + Math.random() * 80);
          const rh = Math.floor(10 + Math.random() * 40);

          for (let y = ry; y < Math.min(ry + rh, height); y++) {
            for (let x = rx; x < Math.min(rx + rw, width); x++) {
              const idx = (y * width + x) * 4;
              data[idx] = 255 - data[idx];
              data[idx + 1] = 255 - data[idx + 1];
              data[idx + 2] = 255 - data[idx + 2];
            }
          }
        }
      } else if (effect === 7) {
        for (let y = 0; y < height; y++) {
          if (Math.random() < layerIntensity / 100) {
            const stretch = Math.floor(Math.random() * 20);
            for (let x = 0; x < width; x++) {
              const srcX = Math.floor(x / (1 + stretch * 0.1)) % width;
              const srcIdx = (y * width + srcX) * 4;
              const dstIdx = (y * width + x) * 4;
              data[dstIdx] = source[srcIdx];
              data[dstIdx + 1] = source[srcIdx + 1];
              data[dstIdx + 2] = source[srcIdx + 2];
            }
          }
        }
      } else if (effect === 8) {
        const numCorrupt = Math.floor(layerIntensity);
        for (let c = 0; c < numCorrupt; c++) {
          const idx = Math.floor((Math.random() * data.length) / 4) * 4;
          const len = Math.floor(Math.random() * 100) * 4;
          const val = [
            Math.random() * 255,
            Math.random() * 255,
            Math.random() * 255,
          ];
          for (let i = idx; i < Math.min(idx + len, data.length); i += 4) {
            data[i] = val[0];
            data[i + 1] = val[1];
            data[i + 2] = val[2];
          }
        }
      } else {
        const numLines = Math.floor(layerIntensity / 5);
        for (let l = 0; l < numLines; l++) {
          const x = Math.floor(Math.random() * width);
          const color = [
            Math.random() * 255,
            Math.random() * 255,
            Math.random() * 255,
          ];
          for (let y = 0; y < height; y++) {
            if (Math.random() < 0.8) {
              const idx = (y * width + x) * 4;
              data[idx] = color[0];
              data[idx + 1] = color[1];
              data[idx + 2] = color[2];
            }
          }
        }
      }

      for (let i = 0; i < source.length; i++) {
        source[i] = data[i];
      }
    }
  },
});
