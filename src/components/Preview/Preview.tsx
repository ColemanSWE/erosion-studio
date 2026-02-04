import React, { useRef, useEffect } from "react";
import styles from "./Preview.module.scss";

interface PreviewProps {
  width?: number;
  height?: number;
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
}

function Preview({ width = 1920, height = 1080, onCanvasReady }: PreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (canvasRef.current && onCanvasReady) {
      onCanvasReady(canvasRef.current);
    }
  }, [onCanvasReady]);

  return (
    <main className={styles.preview} ref={containerRef}>
      <div className={styles.canvasContainer}>
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className={styles.canvas}
        />
      </div>
    </main>
  );
}

export default Preview;
