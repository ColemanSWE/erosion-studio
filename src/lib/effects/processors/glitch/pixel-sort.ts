import { registerEffect } from "../../effect-registry";

const PS_DIRECTION_STEPS: Record<string, { dx: number; dy: number }> = {
  horizontal: { dx: 1, dy: 0 },
  vertical: { dx: 0, dy: 1 },
  "diagonal-down": { dx: 1, dy: 1 },
  "diagonal-up": { dx: 1, dy: -1 },
};

// Flat TypedArray buffers for zero-allocation counting sort
const PS_MAX_DIMENSION = 16384; // Safe margin handling up to 8K resolution diagonals
const _psOffsets = new Uint32Array(PS_MAX_DIMENSION);
const _psPixels = new Uint32Array(PS_MAX_DIMENSION);
const _psKeys = new Uint16Array(PS_MAX_DIMENSION);
const _psCounts = new Uint16Array(766);
const _psStarts = new Uint16Array(766);
const _psSorted = new Uint32Array(PS_MAX_DIMENSION);

registerEffect({
  type: "pixel-sort",
  label: "Pixel Sort",
  category: "glitch",
  defaultParams: { threshold: 80, direction: "horizontal" },
  paramsConfig: [
    {
      key: "threshold",
      label: "Threshold",
      type: "slider",
      min: 0,
      max: 255,
      step: 1,
      default: 80,
    },
    {
      key: "direction",
      label: "Direction",
      type: "select",
      options: ["horizontal", "vertical", "diagonal-down", "diagonal-up"],
      default: "horizontal",
    },
  ],
  glsl: {
    skipGL: () => true,
    fragment: `void main() { fragColor = texture(u_source, v_texCoord); }`,
  },
  processor: (data, { width, height }, params) => {
    const threshold = Number(params.threshold ?? 80);
    const dirKey = String(params.direction || "horizontal");
    const { dx, dy } =
      PS_DIRECTION_STEPS[dirKey] ?? PS_DIRECTION_STEPS.horizontal;

    let segLen = 0;

    const flushSegment = () => {
      if (segLen <= 1) {
        segLen = 0;
        return;
      }

      // 1. Reset counts
      _psCounts.fill(0, 0, 766);

      // 2. Tally keys
      for (let i = 0; i < segLen; i++) {
        _psCounts[_psKeys[i]]++;
      }

      // 3. Prefix sums for start indices
      let currentStart = 0;
      for (let k = 0; k < 766; k++) {
        _psStarts[k] = currentStart;
        currentStart += _psCounts[k];
      }

      // 4. Sort pixels by placing them into the correct spots
      for (let i = 0; i < segLen; i++) {
        const key = _psKeys[i];
        const pos = _psStarts[key]++;
        _psSorted[pos] = _psPixels[i];
      }

      // 5. Write back to data buffer
      // End index must be 'segLen'
      // Iterate via out++ where out is our segment iterator
      for (let i = 0; i < segLen; i++) {
        const o = _psOffsets[i];
        const rgb = _psSorted[i];

        // Extract RGB
        data[o] = (rgb >> 16) & 0xff; // R
        data[o + 1] = (rgb >> 8) & 0xff; // G
        data[o + 2] = rgb & 0xff; // B
      }

      segLen = 0;
    };

    const processLine = (sx: number, sy: number) => {
      segLen = 0;
      let x = sx;
      let y = sy;
      while (x >= 0 && x < width && y >= 0 && y < height) {
        const o = (y * width + x) * 4;
        const r = data[o];
        const gv = data[o + 1];
        const b = data[o + 2];
        const bri = (r + gv + b) / 3;

        if (bri > threshold) {
          _psOffsets[segLen] = o;
          _psPixels[segLen] = (r << 16) | (gv << 8) | b;
          _psKeys[segLen] = r + gv + b;
          segLen++;
        } else {
          flushSegment();
        }
        x += dx;
        y += dy;
      }
      flushSegment();
    };

    // Edge Traversal logic
    if (dy === 0) {
      const startX = dx > 0 ? 0 : width - 1;
      for (let y = 0; y < height; y++) processLine(startX, y);
      return;
    }
    if (dx === 0) {
      const startY = dy > 0 ? 0 : height - 1;
      for (let x = 0; x < width; x++) processLine(x, startY);
      return;
    }
    if (dy > 0) {
      for (let x = 0; x < width; x++) processLine(x, 0);
      const sideX = dx > 0 ? 0 : width - 1;
      // Start y=1 to avoid double-processing the corner
      for (let y = 1; y < height; y++) processLine(sideX, y);
    } else {
      for (let x = 0; x < width; x++) processLine(x, height - 1);
      const sideX = dx > 0 ? 0 : width - 1;
      for (let y = 0; y < height - 1; y++) processLine(sideX, y);
    }
  },
});
