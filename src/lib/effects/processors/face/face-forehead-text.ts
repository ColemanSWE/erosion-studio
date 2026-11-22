import { registerEffect } from "../../effect-registry";
import { FaceBounds } from "../../face-detector";
import { hexToRgb } from "../shared";

// ─── Forehead text helpers ────────────────────────────────────────────────────

// MediaPipe FaceLandmarker upper eyebrow edge indices (topmost points of each brow)
const EYEBROW_INDICES = [
  46, 53, 52, 65, 55, 70, 63, 105, 66, 107,   // left brow
  276, 283, 282, 295, 285, 300, 293, 334, 296, 336, // right brow
];
const FOREHEAD_TOP_INDEX = 10;

function getForeheadBounds(
  face: FaceBounds,
  imgWidth: number,
  imgHeight: number
): { x: number; y: number; w: number; h: number } | null {
  if (!face.landmarks || face.landmarks.length < 400) return null;

  const browLandmarks = EYEBROW_INDICES
    .filter((i) => i < face.landmarks!.length)
    .map((i) => face.landmarks![i]);

  if (browLandmarks.length === 0) return null;

  const browTopY = Math.min(...browLandmarks.map((l) => l.y));
  const foreheadTopY = face.landmarks[FOREHEAD_TOP_INDEX].y;

  const foreheadHeight = browTopY - foreheadTopY;
  if (foreheadHeight < 0.02) return null;

  const faceCenterX = face.x + face.width / 2;
  const boxW = face.width * 0.88;
  const boxH = foreheadHeight * 0.65;
  const boxCenterY = foreheadTopY + foreheadHeight * 0.5;

  const px = Math.round((faceCenterX - boxW / 2) * imgWidth);
  const py = Math.round((boxCenterY - boxH / 2) * imgHeight);
  const pw = Math.max(1, Math.round(boxW * imgWidth));
  const ph = Math.max(1, Math.round(boxH * imgHeight));

  return { x: px, y: py, w: pw, h: ph };
}

let _foreheadOC: OffscreenCanvas | null = null;
let _foreheadCtx: OffscreenCanvasRenderingContext2D | null = null;
let _foreheadLastKey = "";
let _foreheadLastData: ImageData | null = null;

function renderForeheadText(
  text: string,
  boxW: number,
  boxH: number,
  textColor: string,
  bgColor: string,
  bgOpacity: number,
  font: string,
  sizeMultiplier: number
): ImageData | null {
  const key = `${text}|${boxW}|${boxH}|${textColor}|${bgColor}|${bgOpacity}|${font}|${sizeMultiplier}`;
  if (key === _foreheadLastKey && _foreheadLastData) return _foreheadLastData;

  try {
    if (!_foreheadOC) {
      _foreheadOC = new OffscreenCanvas(boxW, boxH);
      _foreheadCtx = _foreheadOC.getContext("2d") as OffscreenCanvasRenderingContext2D;
    } else {
      _foreheadOC.width = boxW;
      _foreheadOC.height = boxH;
    }

    const ctx = _foreheadCtx!;
    ctx.clearRect(0, 0, boxW, boxH);

    const { r: br, g: bg, b: bb } = hexToRgb(bgColor);
    ctx.fillStyle = `rgba(${br},${bg},${bb},${bgOpacity / 100})`;
    ctx.fillRect(0, 0, boxW, boxH);

    let fontSize = Math.round(boxH * 0.62 * (sizeMultiplier / 100));
    fontSize = Math.max(8, fontSize);

    const fontStr = `bold ${fontSize}px ${font}`;
    ctx.font = fontStr;
    let textW = ctx.measureText(text).width;

    if (textW > boxW * 0.92) {
      fontSize = Math.max(6, Math.floor(fontSize * ((boxW * 0.92) / textW)));
      ctx.font = `bold ${fontSize}px ${font}`;
      textW = ctx.measureText(text).width;
    }

    const { r: tr, g: tg, b: tb } = hexToRgb(textColor);
    ctx.fillStyle = `rgb(${tr},${tg},${tb})`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, boxW / 2, boxH / 2);

    _foreheadLastKey = key;
    _foreheadLastData = ctx.getImageData(0, 0, boxW, boxH);
    return _foreheadLastData;
  } catch {
    return null;
  }
}

registerEffect({
  type: "face-forehead-text",
  label: "Forehead Text",
  category: "face",
  defaultParams: {
    text: "INSERT TEXT",
    textColor: "#ffffff",
    bgColor: "#000000",
    bgOpacity: 85,
    size: 100,
    font: "monospace",
  },
  paramsConfig: [
    { key: "text", label: "Text", type: "text", placeholder: "Enter text..." },
    { key: "textColor", label: "Text Color", type: "color" },
    { key: "bgColor", label: "Background", type: "color" },
    { key: "bgOpacity", label: "BG Opacity", type: "slider", min: 0, max: 100, step: 1 },
    { key: "size", label: "Size", type: "slider", min: 20, max: 200, step: 1 },
    { key: "font", label: "Font", type: "select", options: ["monospace", "sans-serif", "serif", "Impact, fantasy"] },
  ],
  processor: (data, { width, height, faceBounds = [] }, params) => {
    const text       = (params.text as string) ?? "INSERT TEXT";
    const textColor  = (params.textColor as string) ?? "#ffffff";
    const bgColor    = (params.bgColor as string) ?? "#000000";
    const bgOpacity  = (params.bgOpacity as number) ?? 85;
    const size       = (params.size as number) ?? 100;
    const font       = (params.font as string) ?? "monospace";

    if (faceBounds.length === 0 || !text) return;

    for (const face of faceBounds) {
      const box = getForeheadBounds(face, width, height);
      if (!box) continue;

      const textImg = renderForeheadText(
        text, box.w, box.h,
        textColor, bgColor, bgOpacity,
        font, size
      );
      if (!textImg) continue;

      const td = textImg.data;

      for (let ty = 0; ty < box.h; ty++) {
        for (let tx = 0; tx < box.w; tx++) {
          const dx = box.x + tx;
          const dy = box.y + ty;
          if (dx < 0 || dx >= width || dy < 0 || dy >= height) continue;

          const ti = (ty * box.w + tx) * 4;
          const alpha = td[ti + 3] / 255;
          if (alpha === 0) continue;

          const di = (dy * width + dx) * 4;
          data[di]     = Math.round(td[ti]     * alpha + data[di]     * (1 - alpha));
          data[di + 1] = Math.round(td[ti + 1] * alpha + data[di + 1] * (1 - alpha));
          data[di + 2] = Math.round(td[ti + 2] * alpha + data[di + 2] * (1 - alpha));
        }
      }
    }
  },
});
