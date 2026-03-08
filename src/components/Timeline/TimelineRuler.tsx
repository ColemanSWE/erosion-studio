import React, { useRef, useEffect, useCallback } from "react";
import { formatTime } from "../../lib/timeline";
import styles from "./Timeline.module.scss";

interface TimelineRulerProps {
  duration: number;
  currentTime: number;
  zoom: number; // pixels per second
  onSeek: (time: number) => void;
  scrollLeft: number;
}

export function TimelineRuler({
  duration,
  currentTime,
  zoom,
  onSeek,
  scrollLeft,
}: TimelineRulerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const totalWidth = Math.max(duration * zoom, 200);
  const playheadX = currentTime * zoom - scrollLeft;

  // Draw tick marks
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    // Determine tick spacing
    const minorInterval = zoom >= 60 ? 0.5 : zoom >= 20 ? 1 : 5;
    const majorInterval = minorInterval * 5;
    const startSec = Math.floor(scrollLeft / zoom / minorInterval) * minorInterval;
    const endSec = (scrollLeft + w) / zoom + minorInterval;

    ctx.strokeStyle = "#333";
    ctx.fillStyle = "#666";
    ctx.font = `9px "JetBrains Mono", monospace`;
    ctx.textBaseline = "top";

    for (let t = startSec; t <= endSec; t = parseFloat((t + minorInterval).toFixed(6))) {
      const x = t * zoom - scrollLeft;
      if (x < -1 || x > w + 1) continue;

      const isMajor = Math.abs(t % majorInterval) < 0.001 || Math.abs(t % majorInterval - majorInterval) < 0.001;
      if (isMajor) {
        ctx.strokeStyle = "#555";
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x, h * 0.3);
        ctx.stroke();
        ctx.fillStyle = "#777";
        ctx.fillText(formatTime(t), x + 2, 2);
      } else {
        ctx.strokeStyle = "#333";
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x, h * 0.65);
        ctx.stroke();
      }
    }
  }, [duration, zoom, scrollLeft]);

  const seekFromEvent = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollLeft;
      const t = Math.max(0, Math.min(duration, x / zoom));
      onSeek(t);
    },
    [duration, zoom, onSeek, scrollLeft],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      draggingRef.current = true;
      seekFromEvent(e);
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [seekFromEvent],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (draggingRef.current) seekFromEvent(e);
    },
    [seekFromEvent],
  );

  const handleMouseUp = useCallback(() => {
    draggingRef.current = false;
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove]);

  return (
    <div
      ref={containerRef}
      className={styles.ruler}
      style={{ width: totalWidth }}
      onMouseDown={handleMouseDown}
    >
      <canvas ref={canvasRef} className={styles.rulerCanvas} />
      {/* Playhead indicator */}
      <div
        className={styles.playhead}
        style={{ left: playheadX }}
        onMouseDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}
