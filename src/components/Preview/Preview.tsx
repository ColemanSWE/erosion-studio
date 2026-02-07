import React, { useRef, useEffect, useState, useCallback } from "react";
import styles from "./Preview.module.scss";
import type { Region } from "../../lib/effects/types";

interface PreviewProps {
  width?: number;
  height?: number;
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  regions?: Region[];
  activeRegionId?: string | null;
  isDrawingRegion?: boolean;
  onRegionDrawn?: (region: Omit<Region, 'id' | 'name' | 'color'>) => void;
  onRegionSelect?: (id: string | null) => void;
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
}: PreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [drawingRect, setDrawingRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [canvasBounds, setCanvasBounds] = useState<CanvasBounds | null>(null);

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

    return () => observer.disconnect();
  }, [updateCanvasBounds]);

  useEffect(() => {
    updateCanvasBounds();
  }, [width, height, updateCanvasBounds]);

  const mouseToNormalized = (clientX: number, clientY: number) => {
    if (!canvasBounds || !canvasContainerRef.current) return null;
    
    const parentRect = canvasContainerRef.current.getBoundingClientRect();
    const x = clientX - parentRect.left - canvasBounds.left;
    const y = clientY - parentRect.top - canvasBounds.top;
    
    const normalizedX = Math.max(0, Math.min(1, x / canvasBounds.width));
    const normalizedY = Math.max(0, Math.min(1, y / canvasBounds.height));
    
    return { x: normalizedX, y: normalizedY };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isDrawingRegion) return;
    
    const normalized = mouseToNormalized(e.clientX, e.clientY);
    if (normalized) {
      setStartPoint(normalized);
      setDrawingRect({ x: normalized.x, y: normalized.y, width: 0, height: 0 });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawingRegion || !startPoint) return;
    
    const normalized = mouseToNormalized(e.clientX, e.clientY);
    if (normalized) {
      const x = Math.min(startPoint.x, normalized.x);
      const y = Math.min(startPoint.y, normalized.y);
      const w = Math.abs(normalized.x - startPoint.x);
      const h = Math.abs(normalized.y - startPoint.y);
      
      setDrawingRect({ x, y, width: w, height: h });
    }
  };

  const handleMouseUp = () => {
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
          className={`${styles.overlay} ${isDrawingRegion ? styles.drawing : ''}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
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
      </div>
    </main>
  );
}

export default Preview;
