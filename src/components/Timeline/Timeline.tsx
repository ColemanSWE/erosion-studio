import React, { useRef, useEffect } from "react";
import { Play, Pause, SkipBack, SkipForward, Square } from "lucide-react";
import styles from "./Timeline.module.scss";

interface TimelineProps {
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (time: number) => void;
}

function Timeline({
  duration,
  currentTime,
  isPlaying,
  onPlay,
  onPause,
  onStop,
  onSeek,
}: TimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const container = containerRef.current;
    if (!container) return;

    canvas.width = container.clientWidth;
    canvas.height = 120;

    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#333333";
    ctx.lineWidth = 1;

    const tickInterval = 30;
    const pixelsPerSecond = canvas.width / (duration || 60);

    for (let i = 0; i <= (duration || 60); i += tickInterval) {
      const x = i * pixelsPerSecond;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();

      ctx.fillStyle = "#666666";
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText(formatTime(i), x + 4, 12);
    }

    const playheadX = currentTime * pixelsPerSecond;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, canvas.height);
    ctx.stroke();
  }, [duration, currentTime]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pixelsPerSecond = canvas.width / (duration || 60);
    const clickedTime = x / pixelsPerSecond;
    onSeek(Math.max(0, Math.min(duration || 60, clickedTime)));
  };

  return (
    <footer className={styles.timeline}>
      <div className={styles.controls}>
        <button onClick={onStop} title="Stop">
          <Square size={16} />
        </button>
        <button
          onClick={isPlaying ? onPause : onPlay}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button title="Previous">
          <SkipBack size={16} />
        </button>
        <button title="Next">
          <SkipForward size={16} />
        </button>
        <span className={styles.timecode}>
          {formatTime(currentTime)} / {formatTime(duration || 0)}
        </span>
      </div>

      <div className={styles.trackContainer} ref={containerRef}>
        <canvas
          ref={canvasRef}
          className={styles.track}
          onClick={handleCanvasClick}
        />
      </div>
    </footer>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins}:${secs.toString().padStart(2, "0")}.${ms
    .toString()
    .padStart(2, "0")}`;
}

export default Timeline;
