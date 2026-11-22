import { registerEffect } from "../../effect-registry";

registerEffect({
  type: "data-destroy",
  label: "Data Destroy",
  category: "glitch",
  defaultParams: { intensity: 50, corruption: 30 },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 100, default: 50 },
    { key: "corruption", label: "Corruption", type: "slider", min: 0, max: 100, default: 30 },
  ],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform float u_corruption;
void main() {
  float seed = floor(u_time * 0.2);
  float pixIdx = floor(v_texCoord.x * u_resolution.x) + floor(v_texCoord.y * u_resolution.y) * u_resolution.x;
  float byteCorruptChance = u_corruption / 1000.0;
  float rowKillChance = u_intensity / 500.0;
  float py = floor(v_texCoord.y * u_resolution.y);
  vec4 c = texture(u_source, v_texCoord);
  // Row kill
  if (pseudoRandom(seed + py * 3.1) < rowKillChance) {
    float killType = pseudoRandom(seed + py * 5.7);
    if (killType < 0.3) {
      float srcRow = floor(pseudoRandom(seed + py * 7.3) * u_resolution.y);
      c = texture(u_source, vec2(v_texCoord.x, srcRow / u_resolution.y));
    } else if (killType < 0.5) {
      c.rgb = vec3(pseudoRandom(seed + py * 9.1), pseudoRandom(seed + py * 11.3), pseudoRandom(seed + py * 13.7));
    } else if (killType < 0.7) {
      c.rgb = 1.0 - c.rgb;
    } else {
      float shiftX = pseudoRandom(seed + py * 15.1) * u_resolution.x;
      c = texture(u_source, vec2(mod(v_texCoord.x * u_resolution.x + shiftX, u_resolution.x) / u_resolution.x, v_texCoord.y));
    }
  }
  // Per-pixel corruption
  if (pseudoRandom(seed + pixIdx * 1.3 + 0.1) < byteCorruptChance) {
    float ct = pseudoRandom(seed + pixIdx * 2.7);
    int channel = int(floor(pseudoRandom(seed + pixIdx * 4.1) * 3.0));
    float corrupt = pseudoRandom(seed + pixIdx * 6.3) > 0.5 ? 1.0 : 0.0;
    if (ct < 0.5) {
      if (channel == 0) c.r = 1.0 - c.r;
      else if (channel == 1) c.g = 1.0 - c.g;
      else c.b = 1.0 - c.b;
    } else {
      if (channel == 0) c.r = corrupt;
      else if (channel == 1) c.g = corrupt;
      else c.b = corrupt;
    }
  }
  fragColor = c;
}`,
    uniforms: { intensity: "float", corruption: "float" },
  },
  processor: (data, { width, height }, params) => {
    const intensity = (params.intensity as number) ?? 50;
    const corruption = (params.corruption as number) ?? 30;
    if (intensity === 0) return;

    const byteCorruptChance = corruption / 1000;
    const rowKillChance = intensity / 500;
    const blockCorruptChance = intensity / 200;

    for (let i = 0; i < data.length; i++) {
      if (i % 4 === 3) continue;

      if (Math.random() < byteCorruptChance) {
        const corruptType = Math.random();
        if (corruptType < 0.3) {
          data[i] = data[i] ^ Math.floor(Math.random() * 256);
        } else if (corruptType < 0.5) {
          data[i] = 255 - data[i];
        } else if (corruptType < 0.7) {
          data[i] = Math.random() > 0.5 ? 255 : 0;
        } else if (corruptType < 0.85) {
          data[i] = (data[i] << 1) & 0xff;
        } else {
          data[i] = (data[i] >> 1) | ((data[i] & 1) << 7);
        }
      }
    }

    for (let y = 0; y < height; y++) {
      if (Math.random() < rowKillChance) {
        const killType = Math.random();
        const rowStart = y * width * 4;

        if (killType < 0.3) {
          const srcRow = Math.floor(Math.random() * height);
          const srcStart = srcRow * width * 4;
          for (let x = 0; x < width * 4; x++) {
            data[rowStart + x] = data[srcStart + x];
          }
        } else if (killType < 0.5) {
          const repeatVal = [
            Math.random() * 255,
            Math.random() * 255,
            Math.random() * 255,
          ];
          for (let x = 0; x < width; x++) {
            data[rowStart + x * 4] = repeatVal[0];
            data[rowStart + x * 4 + 1] = repeatVal[1];
            data[rowStart + x * 4 + 2] = repeatVal[2];
          }
        } else if (killType < 0.7) {
          for (let x = 0; x < width * 4; x++) {
            if (x % 4 !== 3) data[rowStart + x] = data[rowStart + x] ^ 0xff;
          }
        } else {
          const shift = Math.floor(Math.random() * width * 4);
          const temp = new Uint8ClampedArray(width * 4);
          for (let x = 0; x < width * 4; x++) {
            temp[x] = data[rowStart + ((x + shift) % (width * 4))];
          }
          for (let x = 0; x < width * 4; x++) {
            data[rowStart + x] = temp[x];
          }
        }
      }
    }

    const numBlocks = Math.floor(intensity / 10);
    for (let b = 0; b < numBlocks; b++) {
      if (Math.random() < blockCorruptChance) {
        const bx = Math.floor(Math.random() * width);
        const by = Math.floor(Math.random() * height);
        const bw = Math.floor(10 + Math.random() * 50);
        const bh = Math.floor(5 + Math.random() * 30);

        const corruptType = Math.random();
        for (let y = by; y < Math.min(by + bh, height); y++) {
          for (let x = bx; x < Math.min(bx + bw, width); x++) {
            const idx = (y * width + x) * 4;
            if (corruptType < 0.25) {
              data[idx] = data[idx + 1] = data[idx + 2] = Math.random() * 255;
            } else if (corruptType < 0.5) {
              data[idx] ^= 0xff;
              data[idx + 1] ^= 0xff;
              data[idx + 2] ^= 0xff;
            } else if (corruptType < 0.75) {
              const channel = Math.floor(Math.random() * 3);
              data[idx + channel] = Math.random() > 0.5 ? 255 : 0;
            } else {
              data[idx] = data[idx + 2];
              data[idx + 1] = data[idx];
            }
          }
        }
      }
    }
  },
});
