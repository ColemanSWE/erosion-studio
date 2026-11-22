import { registerEffect } from "../../effect-registry";

// ─── 6. Grid Overlay ────────────────────────────────────────────────────────────
// Scientific / measurement / technical grid overlay

registerEffect({
  type: "grid-overlay",
  label: "Grid Overlay",
  category: "style",
  defaultParams: {
    spacing: 40,
    lineWidth: 1,
    color: "#00ff88",
    style: "lines",
    opacity: 0.6,
    showCoordinates: false,
  },
  paramsConfig: [
    { key: "spacing", label: "Spacing", type: "slider", min: 10, max: 200, step: 5 },
    { key: "lineWidth", label: "Line Width", type: "slider", min: 0.5, max: 5, step: 0.5 },
    { key: "color", label: "Color", type: "color" },
    { key: "style", label: "Style", type: "select", options: ["lines", "dots", "crosshairs", "rulers"] },
    { key: "opacity", label: "Opacity", type: "slider", min: 0.1, max: 1, step: 0.05 },
    { key: "showCoordinates", label: "Show Coordinates", type: "checkbox" },
  ],
  processor: (data, { width, height }, params) => {
    const spacing = (params.spacing as number) ?? 40;
    const lineWidth = (params.lineWidth as number) ?? 1;
    const color = (params.color as string) ?? "#00ff88";
    const gridStyle = (params.style as string) ?? "lines";
    const opacity = (params.opacity as number) ?? 0.6;
    const showCoordinates = (params.showCoordinates as boolean) ?? false;

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
    const ctx = tempCanvas.getContext("2d");
    if (!ctx) return;

    // Draw original image
    const imgData = ctx.createImageData(width, height);
    imgData.data.set(data);
    ctx.putImageData(imgData, 0, 0);

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = opacity;

    if (gridStyle === "lines") {
      // Standard grid lines
      for (let x = spacing; x < width; x += spacing) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = spacing; y < height; y += spacing) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    } else if (gridStyle === "dots") {
      // Dot grid at intersections
      const dotRadius = lineWidth + 1;
      for (let y = spacing; y < height; y += spacing) {
        for (let x = spacing; x < width; x += spacing) {
          ctx.beginPath();
          ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (gridStyle === "crosshairs") {
      // Small crosshairs at each intersection
      const crossSize = Math.min(spacing * 0.25, 10);
      for (let y = spacing; y < height; y += spacing) {
        for (let x = spacing; x < width; x += spacing) {
          ctx.beginPath();
          ctx.moveTo(x - crossSize, y);
          ctx.lineTo(x + crossSize, y);
          ctx.moveTo(x, y - crossSize);
          ctx.lineTo(x, y + crossSize);
          ctx.stroke();
        }
      }
    } else if (gridStyle === "rulers") {
      // Ruler markings along edges with tick marks
      const majorSpacing = spacing;
      const minorSpacing = spacing / 4;

      // Top ruler
      for (let x = 0; x < width; x += minorSpacing) {
        const isMajor = Math.abs(x % majorSpacing) < 1;
        const tickLen = isMajor ? 12 : 5;
        ctx.lineWidth = isMajor ? lineWidth * 1.5 : lineWidth * 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, tickLen);
        ctx.stroke();

        // Bottom
        ctx.beginPath();
        ctx.moveTo(x, height);
        ctx.lineTo(x, height - tickLen);
        ctx.stroke();
      }

      // Left ruler
      for (let y = 0; y < height; y += minorSpacing) {
        const isMajor = Math.abs(y % majorSpacing) < 1;
        const tickLen = isMajor ? 12 : 5;
        ctx.lineWidth = isMajor ? lineWidth * 1.5 : lineWidth * 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(tickLen, y);
        ctx.stroke();

        // Right
        ctx.beginPath();
        ctx.moveTo(width, y);
        ctx.lineTo(width - tickLen, y);
        ctx.stroke();
      }

      // Center crosshair
      ctx.lineWidth = lineWidth;
      const centerCross = Math.min(width, height) * 0.03;
      ctx.beginPath();
      ctx.moveTo(width / 2 - centerCross, height / 2);
      ctx.lineTo(width / 2 + centerCross, height / 2);
      ctx.moveTo(width / 2, height / 2 - centerCross);
      ctx.lineTo(width / 2, height / 2 + centerCross);
      ctx.stroke();
    }

    // Coordinate labels at intersections
    if (showCoordinates) {
      ctx.font = "9px monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.globalAlpha = opacity * 0.8;

      for (let y = spacing; y < height - 10; y += spacing) {
        for (let x = spacing; x < width - 30; x += spacing) {
          ctx.fillText(`${x},${y}`, x + 3, y + 3);
        }
      }
    }

    ctx.globalAlpha = 1;
    const resultData = ctx.getImageData(0, 0, width, height);
    data.set(resultData.data);
  },
});
