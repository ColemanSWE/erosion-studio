import { registerEffect } from "../../effect-registry";
import { pseudoRandom, scratchCopy } from "../shared";

registerEffect({
  type: "square-swap",
  label: "Square Swap",
  category: "glitch",
  defaultParams: { gridSize: 4, swapPattern: "random", animated: true },
  paramsConfig: [
    { key: "gridSize", label: "Grid Size", type: "slider", min: 2, max: 16, default: 4 },
    { key: "swapPattern", label: "Pattern", type: "select", options: ["random", "flip", "rotate"], default: "random" },
    { key: "animated", label: "Animated", type: "checkbox", default: true },
  ],
  glsl: {
    fragment: `
uniform float u_gridSize;
uniform int u_swapPattern;
uniform bool u_animated;
void main() {
  float seed = u_animated ? floor(u_time / 10.0) : 0.0;
  float g = u_gridSize;
  float gx = floor(v_texCoord.x * g);
  float gy = floor(v_texCoord.y * g);
  float tgx, tgy;
  if (u_swapPattern == 0) { // random
    tgx = floor(pseudoRandom(seed + gy * g + gx) * g);
    tgy = floor(pseudoRandom(seed + 1000.0 + gy * g + gx) * g);
  } else if (u_swapPattern == 1) { // flip
    tgx = g - 1.0 - gx;
    tgy = g - 1.0 - gy;
  } else { // rotate
    tgx = gy;
    tgy = g - 1.0 - gx;
  }
  vec2 lxy = vec2(mod(v_texCoord.x * g, 1.0), mod(v_texCoord.y * g, 1.0));
  vec2 srcUV = (vec2(tgx, tgy) + lxy) / g;
  fragColor = sampleClamped(srcUV);
}`,
    uniforms: { gridSize: "float", swapPattern: "int", animated: "bool" },
    uniformMapper: (p) => ({
      ...p,
      swapPattern: ["random", "flip", "rotate"].indexOf(
        (p.swapPattern as string) || "random",
      ),
    }),
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const gridSize = (params.gridSize as number) ?? 4;
    const swapPattern = (params.swapPattern as string) ?? "random";
    const animated = (params.animated as boolean) !== false;

    const source = scratchCopy(data, "square-swap/source");
    const cellW = Math.floor(width / gridSize);
    const cellH = Math.floor(height / gridSize);

    const seed = animated ? Math.floor(time / 10) : 0;

    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        let targetGx, targetGy;

        if (swapPattern === "random") {
          targetGx = Math.floor(
            pseudoRandom(seed + gy * gridSize + gx) * gridSize,
          );
          targetGy = Math.floor(
            pseudoRandom(seed + 1000 + gy * gridSize + gx) * gridSize,
          );
        } else if (swapPattern === "flip") {
          targetGx = gridSize - 1 - gx;
          targetGy = gridSize - 1 - gy;
        } else {
          // rotate
          targetGx = gy;
          targetGy = gridSize - 1 - gx;
        }

        const srcX = gx * cellW;
        const srcY = gy * cellH;
        const dstX = targetGx * cellW;
        const dstY = targetGy * cellH;

        for (let y = 0; y < cellH; y++) {
          for (let x = 0; x < cellW; x++) {
            const sy = srcY + y;
            const sx = srcX + x;
            const dy = dstY + y;
            const dx = dstX + x;

            if (sy < height && sx < width && dy < height && dx < width) {
              const si = (sy * width + sx) * 4;
              const di = (dy * width + dx) * 4;

              data[di] = source[si];
              data[di + 1] = source[si + 1];
              data[di + 2] = source[si + 2];
            }
          }
        }
      }
    }
  },
});
