import React, { useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { playbackClock } from "../../lib/engine/clock";
import { formatTime } from "../../lib/timeline";
import styles from "./Timeline.module.scss";

interface TimelineRulerProps {
  duration: number;
  currentTime: number;
  zoom: number;
  onSeek: (time: number) => void;
  scrollLeft: number;
  isPlaying?: boolean;
}

export function TimelineRuler({
  duration,
  currentTime,
  zoom,
  onSeek,
  scrollLeft,
  isPlaying,
}: TimelineRulerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playheadDivRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // Refs so the playhead RAF always reads the latest zoom/scrollLeft without
  // being re-created on every prop change.
  const zoomRef = useRef(zoom);
  const scrollLeftRef = useRef(scrollLeft);
  zoomRef.current = zoom;
  scrollLeftRef.current = scrollLeft;

  // Read the live clock (not just the committed prop) so a re-render during
  // playback never snaps the playhead back to the last committed time.
  const playheadX = (isPlaying ? playbackClock.time : currentTime) * zoom - scrollLeft;

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

    const minorInterval = zoom >= 60 ? 0.5 : zoom >= 20 ? 1 : 5;
    const majorInterval = minorInterval * 5;
    const startSec = Math.floor(scrollLeft / zoom / minorInterval) * minorInterval;
    const endSec = (scrollLeft + w) / zoom + minorInterval;

    // Colors come from the design tokens exposed on :root (global.scss).
    const css = getComputedStyle(document.documentElement);
    const minorTick = css.getPropertyValue("--border-primary").trim() || "#2e2d2c";
    const majorTick = css.getPropertyValue("--border-strong").trim() || "#45443f";
    const labelColor = css.getPropertyValue("--text-secondary").trim() || "#9a9996";
    ctx.strokeStyle = minorTick;
    ctx.fillStyle = labelColor;
    ctx.font = `9px "JetBrains Mono", monospace`;
    ctx.textBaseline = "top";

    for (let t = startSec; t <= endSec; t = parseFloat((t + minorInterval).toFixed(6))) {
      const x = t * zoom - scrollLeft;
      if (x < -1 || x > w + 1) continue;

      const isMajor = Math.abs(t % majorInterval) < 0.001 || Math.abs(t % majorInterval - majorInterval) < 0.001;
      if (isMajor) {
        ctx.strokeStyle = majorTick;
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x, h * 0.3);
        ctx.stroke();
        ctx.fillStyle = labelColor;
        ctx.fillText(formatTime(t), x + 2, 2);
      } else {
        ctx.strokeStyle = minorTick;
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x, h * 0.65);
        ctx.stroke();
      }
    }
  }, [duration, zoom, scrollLeft]);

  // Direct-DOM playhead during playback, driven by the playback clock.
  useEffect(() => {
    if (!isPlaying) return;
    return playbackClock.subscribe((time) => {
      if (playheadDivRef.current) {
        playheadDivRef.current.style.left = `${time * zoomRef.current - scrollLeftRef.current}px`;
      }
    });
  }, [isPlaying]);

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

  const seekFromEventRef = useRef(seekFromEvent);
  useLayoutEffect(() => { seekFromEventRef.current = seekFromEvent; });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    draggingRef.current = true;
    seekFromEventRef.current(e);

    const onMove = (me: MouseEvent) => {
      if (draggingRef.current) seekFromEventRef.current(me);
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  return (
    <div
      ref={containerRef}
      className={styles.ruler}
      onMouseDown={handleMouseDown}
    >
      <canvas ref={canvasRef} className={styles.rulerCanvas} />
      {/* Playhead indicator — position driven by direct DOM during playback */}
      <div
        ref={playheadDivRef}
        className={styles.playhead}
        style={{ left: playheadX }}
        onMouseDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}
