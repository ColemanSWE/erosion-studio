import React, { memo, useRef, useEffect, useState, useCallback } from "react";
import { Maximize2, Minimize2, RotateCcw } from "lucide-react";
import styles from "./Preview.module.scss";
import type { Region, Overlay } from "../../lib/effects/types";
import type { SourceTransform } from "../../lib/project";

interface PreviewProps {
  width?: number;
  height?: number;
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  regions?: Region[];
  activeRegionId?: string | null;
  isDrawingRegion?: boolean;
  onRegionDrawn?: (region: Omit<Region, 'id' | 'name' | 'color'>) => void;
  onRegionSelect?: (id: string | null) => void;
  overlays?: Overlay[];
  activeOverlayId?: string | null;
  onOverlaySelect?: (id: string | null) => void;
  onOverlayUpdate?: (id: string, updates: Partial<Overlay>) => void;
  captureHud?: React.ReactNode;
  sourceTransform?: SourceTransform;
  onSourceTransformChange?: (transform: SourceTransform) => void;
}

interface CanvasBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

function getCanvasContentBounds(
  canvas: HTMLCanvasElement,
  parent: HTMLElement
): CanvasBounds {
  const canvasRect = canvas.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();

  const cssW = canvasRect.width;
  const cssH = canvasRect.height;

  if (canvas.width === 0 || canvas.height === 0) {
    return { left: canvasRect.left - parentRect.left, top: canvasRect.top - parentRect.top, width: cssW, height: cssH };
  }

  const contentAspect = canvas.width / canvas.height;
  const cssAspect = cssW / cssH;

  let contentW: number, contentH: number, contentOffsetX: number, contentOffsetY: number;

  if (contentAspect > cssAspect) {
    contentW = cssW;
    contentH = cssW / contentAspect;
    contentOffsetX = 0;
    contentOffsetY = (cssH - contentH) / 2;
  } else {
    contentH = cssH;
    contentW = cssH * contentAspect;
    contentOffsetX = (cssW - contentW) / 2;
    contentOffsetY = 0;
  }

  return {
    left: canvasRect.left + contentOffsetX - parentRect.left,
    top: canvasRect.top + contentOffsetY - parentRect.top,
    width: contentW,
    height: contentH,
  };
}

function Preview({ 
  width = 1920, 
  height = 1080, 
  onCanvasReady,
  regions = [],
  activeRegionId = null,
  isDrawingRegion = false,
  onRegionDrawn,
  onRegionSelect,
  overlays = [],
  activeOverlayId = null,
  onOverlaySelect,
  onOverlayUpdate,
  captureHud,
  sourceTransform,
  onSourceTransformChange,
}: PreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [drawingRect, setDrawingRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [canvasBounds, setCanvasBounds] = useState<CanvasBounds | null>(null);
  const panDragRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);

  // Drag state lives in a ref so mousedown→first-mousemove is synchronous.
  // useState would defer the update to the next render, dropping the first few pixels.
  const dragStateRef = useRef<{
    id: string;
    type: "move" | "resize";
    handle?: "nw" | "ne" | "sw" | "se";
    startX: number;
    startY: number;
    initialOverlay: Overlay;
  } | null>(null);
  const [isDraggingOverlay, setIsDraggingOverlay] = useState(false);

  useEffect(() => {
    if (canvasRef.current && onCanvasReady) {
      onCanvasReady(canvasRef.current);
    }
  }, [onCanvasReady]);

  const updateCanvasBounds = useCallback(() => {
    if (!canvasRef.current || !canvasContainerRef.current) return;
    setCanvasBounds(getCanvasContentBounds(canvasRef.current, canvasContainerRef.current));
  }, []);

  useEffect(() => {
    updateCanvasBounds();

    const container = canvasContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(updateCanvasBounds);
    observer.observe(container);

    // Also watch for changes to canvas.width / canvas.height attributes,
    // which the media hooks set when media loads (overriding the initial resolution).
    const canvas = canvasRef.current;
    let attrObserver: MutationObserver | null = null;
    if (canvas) {
      attrObserver = new MutationObserver(updateCanvasBounds);
      attrObserver.observe(canvas, { attributes: true, attributeFilter: ["width", "height"] });
    }

    return () => {
      observer.disconnect();
      attrObserver?.disconnect();
    };
  }, [updateCanvasBounds]);

  useEffect(() => {
    updateCanvasBounds();
  }, [width, height, updateCanvasBounds]);

  const mouseToNormalized = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    // Always compute from live canvas rect to avoid stale cached values
    const canvasRect = canvas.getBoundingClientRect();
    const cssW = canvasRect.width;
    const cssH = canvasRect.height;

    if (canvas.width === 0 || canvas.height === 0) return null;

    const contentAspect = canvas.width / canvas.height;
    const cssAspect = cssW / cssH;

    let contentW: number, contentH: number, offsetX: number, offsetY: number;
    if (contentAspect > cssAspect) {
      contentW = cssW;
      contentH = cssW / contentAspect;
      offsetX = 0;
      offsetY = (cssH - contentH) / 2;
    } else {
      contentH = cssH;
      contentW = cssH * contentAspect;
      offsetX = (cssW - contentW) / 2;
      offsetY = 0;
    }

    // Position relative to the content area (accounting for letterbox/pillarbox)
    const relX = clientX - canvasRect.left - offsetX;
    const relY = clientY - canvasRect.top - offsetY;

    const normalizedX = Math.max(0, Math.min(1, relX / contentW));
    const normalizedY = Math.max(0, Math.min(1, relY / contentH));

    return { x: normalizedX, y: normalizedY };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // If we click on the canvas background directly (not on an overlay), we deselect overlays
    if ((e.target as HTMLElement).className === styles.overlay) {
      onOverlaySelect?.(null);
      if (!isDrawingRegion) {
        onRegionSelect?.(null);
      }
    }

    if (sourceTransform?.mode === "fill" && !isDrawingRegion && onSourceTransformChange && canvasBounds) {
      panDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startPanX: sourceTransform.panX,
        startPanY: sourceTransform.panY,
      };
      return;
    }

    if (!isDrawingRegion) return;
    
    const normalized = mouseToNormalized(e.clientX, e.clientY);
    if (normalized) {
      setStartPoint(normalized);
      setDrawingRect({ x: normalized.x, y: normalized.y, width: 0, height: 0 });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (panDragRef.current && sourceTransform && onSourceTransformChange && canvasBounds) {
      const dxCss = e.clientX - panDragRef.current.startX;
      const dyCss = e.clientY - panDragRef.current.startY;
      const scaleX = width / canvasBounds.width;
      const scaleY = height / canvasBounds.height;
      onSourceTransformChange({
        ...sourceTransform,
        panX: panDragRef.current.startPanX + dxCss * scaleX,
        panY: panDragRef.current.startPanY + dyCss * scaleY,
      });
      return;
    }

    if (!isDrawingRegion || !startPoint) return;

    const normalized = mouseToNormalized(e.clientX, e.clientY);
    if (!normalized) return;
    
    const x = Math.min(startPoint.x, normalized.x);
    const y = Math.min(startPoint.y, normalized.y);
    const w = Math.abs(normalized.x - startPoint.x);
    const h = Math.abs(normalized.y - startPoint.y);
      
    setDrawingRect({ x, y, width: w, height: h });
  };

  const handleMouseUp = () => {
    if (panDragRef.current) {
      panDragRef.current = null;
      return;
    }

    if (!isDrawingRegion || !startPoint || !drawingRect) return;
    
    if (drawingRect.width > 0.02 && drawingRect.height > 0.02) {
      if (onRegionDrawn) {
        onRegionDrawn({
          x: drawingRect.x,
          y: drawingRect.y,
          width: drawingRect.width,
          height: drawingRect.height,
        });
      }
    }
    
    setStartPoint(null);
    setDrawingRect(null);
  };

  const handleRegionClick = (regionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onRegionSelect) {
      onRegionSelect(regionId);
    }
  };

  const handleOverlayMouseDown = useCallback((overlay: Overlay, e: React.MouseEvent, type: "move" | "resize" = "move", handle?: "nw" | "ne" | "sw" | "se") => {
    e.stopPropagation();
    e.preventDefault();
    onOverlaySelect?.(overlay.id);

    const normalized = mouseToNormalized(e.clientX, e.clientY);
    if (!normalized) return;

    // Synchronous ref update — available to the first mousemove without waiting for a React render
    dragStateRef.current = {
      id: overlay.id,
      type,
      handle,
      startX: normalized.x,
      startY: normalized.y,
      initialOverlay: { ...overlay },
    };
    setIsDraggingOverlay(true);

    // RAF-throttle overlay updates so Zustand/React only processes one update per frame.
    let rafId: number | null = null;
    let lastNorm = normalized;

    const onMove = (me: MouseEvent) => {
      const norm = mouseToNormalized(me.clientX, me.clientY);
      if (norm) lastNorm = norm;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const ds = dragStateRef.current;
        if (!ds) return;

        const dx = lastNorm.x - ds.startX;
        const dy = lastNorm.y - ds.startY;
        let { x, y, width: w, height: h } = ds.initialOverlay;

        if (ds.type === "move") {
          x = Math.max(0, Math.min(1 - w, x + dx));
          y = Math.max(0, Math.min(1 - h, y + dy));
        } else if (ds.type === "resize" && ds.handle) {
          if (ds.handle.includes("e")) w = Math.max(0.02, Math.min(1 - x, w + dx));
          if (ds.handle.includes("s")) h = Math.max(0.02, Math.min(1 - y, h + dy));
          if (ds.handle.includes("w")) {
            const nw = w - dx;
            if (nw >= 0.02 && x + dx >= 0) { w = nw; x += dx; }
          }
          if (ds.handle.includes("n")) {
            const nh = h - dy;
            if (nh >= 0.02 && y + dy >= 0) { h = nh; y += dy; }
          }
        }

        onOverlayUpdate?.(ds.id, { x, y, width: w, height: h });
      });
    };

    const onUp = () => {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      dragStateRef.current = null;
      setIsDraggingOverlay(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [onOverlaySelect, onOverlayUpdate]);

  const isFillMode = sourceTransform?.mode === "fill";

  const overlayInteractionClass = isDrawingRegion
    ? styles.drawing
    : isFillMode
      ? styles.panning
      : "";

  return (
    <main className={styles.preview}>
      <div className={styles.canvasContainer} ref={canvasContainerRef}>
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className={styles.canvas}
        />
        <div 
          className={`${styles.overlay} ${overlayInteractionClass}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={canvasBounds ? {
            left: canvasBounds.left,
            top: canvasBounds.top,
            width: canvasBounds.width,
            height: canvasBounds.height,
          } : undefined}
        >
          {regions.map((region) => (
            <div
              key={region.id}
              className={`${styles.region} ${activeRegionId === region.id ? styles.active : ''}`}
              style={{
                left: `${region.x * 100}%`,
                top: `${region.y * 100}%`,
                width: `${region.width * 100}%`,
                height: `${region.height * 100}%`,
                borderColor: region.color,
              }}
              onClick={(e) => handleRegionClick(region.id, e)}
            >
              <div className={styles.regionLabel} style={{ color: region.color }}>
                {region.name}
              </div>
            </div>
          ))}
          {overlays.map((overlay) => (
            <div
              key={overlay.id}
              className={`${styles.region} ${activeOverlayId === overlay.id ? styles.active : ''} ${overlay.isEffectZone ? styles.effectZone : ''}`}
              style={{
                left: `${overlay.x * 100}%`,
                top: `${overlay.y * 100}%`,
                width: `${overlay.width * 100}%`,
                height: `${overlay.height * 100}%`,
                borderColor: overlay.isEffectZone ? '#00ffcc' : '#ffffff',
                borderStyle: overlay.isEffectZone ? 'dashed' : 'solid',
                cursor: isDraggingOverlay && dragStateRef.current?.id === overlay.id
                ? (dragStateRef.current?.type === 'move' ? 'grabbing' : 'nwse-resize')
                : 'grab',
              }}
              onMouseDown={(e) => handleOverlayMouseDown(overlay, e, "move")}
            >
              <div className={styles.regionLabel} style={{ color: overlay.isEffectZone ? '#00ffcc' : '#ffffff' }}>
                {overlay.type === 'text' ? 'T' : (overlay.type === 'image' ? 'Img' : 'Vid')}
              </div>
              
              {activeOverlayId === overlay.id && (
                <>
                  <div className={`${styles.resizeHandle} ${styles.nw}`} onMouseDown={(e) => handleOverlayMouseDown(overlay, e, "resize", "nw")} />
                  <div className={`${styles.resizeHandle} ${styles.ne}`} onMouseDown={(e) => handleOverlayMouseDown(overlay, e, "resize", "ne")} />
                  <div className={`${styles.resizeHandle} ${styles.sw}`} onMouseDown={(e) => handleOverlayMouseDown(overlay, e, "resize", "sw")} />
                  <div className={`${styles.resizeHandle} ${styles.se}`} onMouseDown={(e) => handleOverlayMouseDown(overlay, e, "resize", "se")} />
                </>
              )}
            </div>
          ))}
          {drawingRect && (
            <div
              className={styles.drawingRect}
              style={{
                left: `${drawingRect.x * 100}%`,
                top: `${drawingRect.y * 100}%`,
                width: `${drawingRect.width * 100}%`,
                height: `${drawingRect.height * 100}%`,
              }}
            />
          )}
        </div>
        {onSourceTransformChange && canvasBounds && (
          <div
            className={styles.transformControls}
            style={{
              left: canvasBounds.left + 8,
              top: canvasBounds.top + canvasBounds.height - 40,
            }}
          >
            <button
              className={`${styles.transformBtn} ${isFillMode ? styles.active : ""}`}
              onClick={() => onSourceTransformChange({ ...sourceTransform ?? { mode: "fit", panX: 0, panY: 0 }, mode: isFillMode ? "fit" : "fill" })}
              title={isFillMode ? "Switch to Fit mode" : "Switch to Fill mode (pan enabled)"}
            >
              {isFillMode ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
            {isFillMode && (sourceTransform!.panX !== 0 || sourceTransform!.panY !== 0) && (
              <button
                className={styles.transformBtn}
                onClick={() => onSourceTransformChange({ ...sourceTransform!, panX: 0, panY: 0 })}
                title="Reset pan to center"
              >
                <RotateCcw size={12} />
              </button>
            )}
          </div>
        )}
        {captureHud}
      </div>
    </main>
  );
}

export default memo(Preview);
