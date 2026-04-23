import { ProcessConfig } from "../effect-registry";
import { FaceBounds, getLandmarkBounds } from "../face-detector";

export const BAYER_MATRIX_4x4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
export const motionSmearState: {
  prevFrame: Uint8ClampedArray | null;
  meltBuffer: Uint8ClampedArray | null;
  mvX: Float32Array | null;
  mvY: Float32Array | null;
  width: number;
  height: number;
} = {
  prevFrame: null,
  meltBuffer: null,
  mvX: null,
  mvY: null,
  width: 0,
  height: 0,
};
export const blockShovingState: {
  prevInput: Uint8ClampedArray | null;
  moshBuffer: Uint8ClampedArray | null;
  width: number;
  height: number;
  mvXBuffer: Float32Array | null;
  mvYBuffer: Float32Array | null;
  lastResetMs: number;
} = {
  prevInput: null,
  moshBuffer: null,
  width: 0,
  height: 0,
  mvXBuffer: null,
  mvYBuffer: null,
  lastResetMs: 0,
};

export function bilinearSample(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number
): number {
  const x1 = Math.floor(x);
  const y1 = Math.floor(y);
  const x2 = x1 + 1;
  const y2 = y1 + 1;

  const wx = x - x1;
  const wy = y - y1;

  // Clamp coordinates
  const sx1 = Math.max(0, Math.min(width - 1, x1));
  const sy1 = Math.max(0, Math.min(height - 1, y1));
  const sx2 = Math.max(0, Math.min(width - 1, x2));
  const sy2 = Math.max(0, Math.min(height - 1, y2));

  const idx11 = (sy1 * width + sx1) * 4 + channel;
  const idx21 = (sy1 * width + sx2) * 4 + channel;
  const idx12 = (sy2 * width + sx1) * 4 + channel;
  const idx22 = (sy2 * width + sx2) * 4 + channel;

  const v11 = data[idx11];
  const v21 = data[idx21];
  const v12 = data[idx12];
  const v22 = data[idx22];

  return (
    (1 - wy) * ((1 - wx) * v11 + wx * v21) + wy * ((1 - wx) * v12 + wx * v22)
  );
}

const MAX_CACHE_ENTRIES = 3;

function evictMapEntries<K, V>(map: Map<K, V>, maxEntries: number): void {
  while (map.size >= maxEntries) {
    const firstKey = map.keys().next().value;
    if (firstKey === undefined) break;
    map.delete(firstKey);
  }
}

export const meltState = new Map<string, Uint8ClampedArray>();

export function setMeltState(key: string, value: Uint8ClampedArray): void {
  evictMapEntries(meltState, MAX_CACHE_ENTRIES);
  meltState.set(key, value);
}
export const perlinNoise = (() => {
  const permutation = new Array(256)
    .fill(0)
    .map(() => Math.floor(Math.random() * 256));
  const p = [...permutation, ...permutation];

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (t: number, a: number, b: number) => a + t * (b - a);
  const grad = (hash: number, x: number, y: number) => {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };

  return (x: number, y: number): number => {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = p[p[X] + Y];
    const ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y];
    const bb = p[p[X + 1] + Y + 1];
    return lerp(
      v,
      lerp(u, grad(aa, xf, yf), grad(ba, xf - 1, yf)),
      lerp(u, grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1))
    );
  };
})();
export const posterizeTimeCache = new Map<
  string,
  { lastUpdateTime: number; cachedFrame: Uint8ClampedArray | null }
>();

export function setPosterizeTimeCache(
  key: string,
  value: { lastUpdateTime: number; cachedFrame: Uint8ClampedArray | null }
): void {
  evictMapEntries(posterizeTimeCache, MAX_CACHE_ENTRIES);
  posterizeTimeCache.set(key, value);
}

export function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function sortSegment(
  data: Uint8ClampedArray,
  rowStart: number,
  startX: number,
  endX: number
): void {
  const pixels = [];
  for (let x = startX; x <= endX; x++) {
    const i = rowStart + x * 4;
    pixels.push({
      r: data[i],
      g: data[i + 1],
      b: data[i + 2],
      bri: data[i] + data[i + 1] + data[i + 2],
    });
  }
  pixels.sort((a, b) => a.bri - b.bri);
  for (let x = startX; x <= endX; x++) {
    const i = rowStart + x * 4;
    const p = pixels[x - startX];
    data[i] = p.r;
    data[i + 1] = p.g;
    data[i + 2] = p.b;
  }
}

export function sortSegmentV(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  startY: number,
  endY: number
): void {
  const pixels = [];
  for (let y = startY; y <= endY; y++) {
    const i = (y * width + x) * 4;
    pixels.push({
      r: data[i],
      g: data[i + 1],
      b: data[i + 2],
      bri: data[i] + data[i + 1] + data[i + 2],
    });
  }
  pixels.sort((a, b) => a.bri - b.bri);
  for (let y = startY; y <= endY; y++) {
    const i = (y * width + x) * 4;
    const p = pixels[y - startY];
    data[i] = p.r;
    data[i + 1] = p.g;
    data[i + 2] = p.b;
  }
}

export function getBlockAverage(
  data: Uint8ClampedArray,
  width: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  channel: number
): number {
  let sum = 0,
    count = 0;
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      sum += data[(y * width + x) * 4 + channel];
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return [h * 360, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function isPointInFaceBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  face: FaceBounds
): boolean {
  const padding = 0.1;
  const faceX = (face.x - face.width * padding) * width;
  const faceY = (face.y - face.height * padding) * height;
  const faceW = face.width * (1 + padding * 2) * width;
  const faceH = face.height * (1 + padding * 2) * height;
  return x >= faceX && x < faceX + faceW && y >= faceY && y < faceY + faceH;
}

// Frame history storage for temporal effects
export const frameHistoryStore: {
  frames: Uint8ClampedArray[];
  width: number;
  height: number;
  maxSize: number;
} = {
  frames: [],
  width: 0,
  height: 0,
  maxSize: 16,
};

export function storeFrame(
  data: Uint8ClampedArray,
  width: number,
  height: number
): void {
  if (frameHistoryStore.width !== width || frameHistoryStore.height !== height) {
    frameHistoryStore.frames = [];
    frameHistoryStore.width = width;
    frameHistoryStore.height = height;
  }

  const frame = new Uint8ClampedArray(data);
  frameHistoryStore.frames.unshift(frame);

  if (frameHistoryStore.frames.length > frameHistoryStore.maxSize) {
    frameHistoryStore.frames.pop();
  }
}

export function getFrameFromHistory(index: number): Uint8ClampedArray | null {
  if (index >= 0 && index < frameHistoryStore.frames.length) {
    return frameHistoryStore.frames[index];
  }
  return null;
}

// 1. Rainbow Gradient Effect
// 2. Gradient Rainbow Flash Effect
// 3. Bitwise XOR Blend Effect
// 4. RGB Vertical XOR Effect
// 5. Frame Trails Effect
// 6. RGB Color Trails Effect
// 7. Strobe Flash Effect
// 8. RGB Strobe Effect
// 9. Kaleidoscope Effect
// 10. Mirror Blend Effect
// 11. Feedback Echo Effect
// 12. Frame Delay Effect
// 13. Alpha Blend Trails Effect
// 14. Square Swap Effect

export const clamp255 = (value: number) => Math.max(0, Math.min(255, value));
