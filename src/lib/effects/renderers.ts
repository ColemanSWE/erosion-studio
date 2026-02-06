import { EmojiMap } from "./emoji-map";

export type RenderMode =
  | "native"
  | "standard"
  | "emoji"
  | "ascii-color"
  | "matrix";

// Configuration for HOW to draw the pixels (output style)
export interface RenderConfig {
  cols: number;
  fontSize: number;
  mode: RenderMode;
  emojiMap: EmojiMap;
  theme?: string;
  // NOTE: Processing params (dither, invert, etc) are now handled before this function!
}

const ASCII_CHARS = " .:-=+*#%@";
const BAYER_MATRIX_4x4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function getAsciiChar(brightness: number): string {
  const index = Math.floor((brightness / 255) * (ASCII_CHARS.length - 1));
  return ASCII_CHARS[index];
}

// The renderer now assumes `pixelData` is ALREADY fully processed
// (glitched, inverted, sorted, dithered, etc.)
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  pixelData: Uint8ClampedArray,
  width: number,
  height: number,
  config: RenderConfig
) {
  const { fontSize, mode, emojiMap } = config;

  // Clear canvas
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // Native Mode: Draw pixels at full resolution without character mapping
  if (mode === "native") {
    const imageData = new ImageData(pixelData as any, width, height);
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext("2d");
    if (tempCtx) {
      tempCtx.putImageData(imageData, 0, 0);
      ctx.drawImage(tempCanvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    return;
  }

  // Standard Mode: Just draw the modified pixels directly
  if (mode === "standard") {
    const imageData = new ImageData(pixelData as any, width, height);
    // We might need to scale it up if the canvas is larger than the grid?
    // Yes, usually width/height are the 'cols/rows' (small), but canvas is 720p or similar.
    // So we can draw the tiny ImageData to a temp canvas and drawImage(scale) it?
    // Or just iterate and fillRect.
    // fillRect is safer for "pixel art" clean look without blurry smoothing.

    const cellWidth = ctx.canvas.width / width;
    const cellHeight = ctx.canvas.height / height;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        ctx.fillStyle = `rgb(${pixelData[i]},${pixelData[i + 1]},${
          pixelData[i + 2]
        })`;
        ctx.fillRect(
          Math.floor(x * cellWidth),
          Math.floor(y * cellHeight),
          Math.ceil(cellWidth),
          Math.ceil(cellHeight)
        );
      }
    }
    return;
  }

  // Text-based Modes
  ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
  if (mode === "emoji") {
    ctx.font = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"`;
  } else if (mode === "matrix") {
    ctx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const cellWidth = ctx.canvas.width / width;
  const cellHeight = ctx.canvas.height / height;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = pixelData[i];
      const g = pixelData[i + 1];
      const b = pixelData[i + 2];

      const centerX = x * cellWidth + cellWidth / 2;
      const centerY = y * cellHeight + cellHeight / 2;

      if (mode === "emoji") {
        const char = emojiMap.findNearest(r, g, b);
        ctx.fillText(char, centerX, centerY);
      } else if (mode === "ascii-color") {
        const brightness = (r + g + b) / 3;
        const char = getAsciiChar(brightness);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillText(char, centerX, centerY);
      } else if (mode === "matrix") {
        const brightness = (r + g + b) / 3;
        // Threshold for matrix char visibility
        if (brightness > 20) {
          const char = Math.random() > 0.5 ? "1" : "0";
          // Use the pixel's Green channel for the matrix intensity?
          // Or just use the calculated brightness but cast to Green?
          // If the input was "red", making it green simulates the matrix "viewing" the red object.

          // However, if the user "inverted" or "glitched" colors, we might want to respect that?
          // Traditional matrix is strictly Green.
          // Let's stick to Green but scale opacity/brightness.
          const val = Math.floor(brightness);
          ctx.fillStyle = `rgb(0, ${val}, 0)`;
          ctx.fillText(char, centerX, centerY);
        }
      }
    }
  }
}
