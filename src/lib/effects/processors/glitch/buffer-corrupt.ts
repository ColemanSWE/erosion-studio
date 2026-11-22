import { registerEffect } from "../../effect-registry";
import { clamp, scratchCopy } from "../shared";

registerEffect({
  type: "buffer-corrupt",
  label: "Buffer Corrupt",
  category: "glitch",
  defaultParams: { strideOffset: 30, channelSplit: 40, wrapMode: "repeat" },
  paramsConfig: [
    {
      key: "strideOffset",
      label: "Stride Offset",
      type: "slider",
      min: -100,
      max: 100,
      step: 1,
    },
    {
      key: "channelSplit",
      label: "Channel Split",
      type: "slider",
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: "wrapMode",
      label: "Wrap Mode",
      type: "select",
      options: ["repeat", "mirror", "clamp"],
    },
  ],
  glsl: {
    fragment: `
uniform float u_strideOffset;
uniform float u_channelSplit;
uniform float u_wrapMode;

float stridedRead(float flatIdx, float stride) {
  float row = floor(flatIdx / stride);
  float col = mod(flatIdx, stride);
  return col / u_resolution.x * 1.0 + row / u_resolution.y * 1.0;
}

vec2 corruptedUV(vec2 uv, float strideDelta) {
  float px = uv.x * u_resolution.x;
  float py = uv.y * u_resolution.y;
  float flatIdx = py * u_resolution.x + px;
  float corruptedWidth = u_resolution.x + strideDelta;
  if (corruptedWidth <= 0.0) corruptedWidth = 1.0;
  float newRow = floor(flatIdx / corruptedWidth);
  float newCol = mod(flatIdx, corruptedWidth);
  vec2 newUV = vec2(newCol / u_resolution.x, newRow / u_resolution.y);
  if (u_wrapMode < 0.5) {
    newUV = fract(newUV);
  } else if (u_wrapMode < 1.5) {
    vec2 wrapped = fract(newUV * 0.5) * 2.0;
    newUV = vec2(wrapped.x > 1.0 ? 2.0 - wrapped.x : wrapped.x,
                 wrapped.y > 1.0 ? 2.0 - wrapped.y : wrapped.y);
  } else {
    newUV = clamp(newUV, 0.0, 1.0);
  }
  return newUV;
}

void main() {
  if (u_strideOffset == 0.0 && u_channelSplit == 0.0) {
    fragColor = texture(u_source, v_texCoord);
    return;
  }
  float splitAmount = u_channelSplit * 0.5;
  vec2 uvR = corruptedUV(v_texCoord, u_strideOffset + splitAmount);
  vec2 uvG = corruptedUV(v_texCoord, u_strideOffset);
  vec2 uvB = corruptedUV(v_texCoord, u_strideOffset - splitAmount);
  float r = texture(u_source, uvR).r;
  float g = texture(u_source, uvG).g;
  float b = texture(u_source, uvB).b;
  fragColor = vec4(r, g, b, 1.0);
}`,
    uniforms: {
      strideOffset: "float",
      channelSplit: "float",
      wrapMode: "float",
    },
    uniformMapper: (params) => ({
      strideOffset: params.strideOffset,
      channelSplit: params.channelSplit,
      wrapMode:
        params.wrapMode === "repeat" ? 0 : params.wrapMode === "mirror" ? 1 : 2,
    }),
  },
  processor: (data, { width, height }, params) => {
    const strideOffset = (params.strideOffset as number) ?? 30;
    const channelSplit = (params.channelSplit as number) ?? 40;
    const wrapMode = (params.wrapMode as string) ?? "repeat";
    if (strideOffset === 0 && channelSplit === 0) return;

    const source = scratchCopy(data, "buffer-corrupt/source");

    const wrapCoord = (
      col: number,
      row: number,
      w: number,
      h: number,
    ): [number, number] => {
      let c = col,
        r = row;
      if (wrapMode === "repeat") {
        c = ((c % w) + w) % w;
        r = ((r % h) + h) % h;
      } else if (wrapMode === "mirror") {
        const mc = ((c % (w * 2)) + w * 2) % (w * 2);
        const mr = ((r % (h * 2)) + h * 2) % (h * 2);
        c = mc >= w ? w * 2 - 1 - mc : mc;
        r = mr >= h ? h * 2 - 1 - mr : mr;
      } else {
        c = clamp(c, 0, w - 1);
        r = clamp(r, 0, h - 1);
      }
      return [c, r];
    };

    const splitAmount = channelSplit * 0.5;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const flatIdx = y * width + x;
        const dstIdx = flatIdx * 4;

        const readChannel = (stride: number, ch: number) => {
          const corruptedWidth = width + stride;
          if (corruptedWidth <= 0) return source[dstIdx + ch];
          const newRow = Math.floor(flatIdx / corruptedWidth);
          const newCol = Math.floor(flatIdx % corruptedWidth);
          const [wc, wr] = wrapCoord(newCol, newRow, width, height);
          return source[(wr * width + wc) * 4 + ch];
        };

        data[dstIdx] = readChannel(strideOffset + splitAmount, 0);
        data[dstIdx + 1] = readChannel(strideOffset, 1);
        data[dstIdx + 2] = readChannel(strideOffset - splitAmount, 2);
      }
    }
  },
});
