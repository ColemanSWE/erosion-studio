import { useState } from "react";
import { X } from "lucide-react";
import styles from "./ExportDialog.module.scss";

export type ExportFormat = "mp4" | "webm" | "gif" | "png" | "jpeg";

export interface ExportSettings {
  format: ExportFormat;
  fps: number;
  quality: "low" | "medium" | "high";
}

interface ExportDialogProps {
  isVideo: boolean;
  isExporting: boolean;
  exportProgress: number;
  onExport: (settings: ExportSettings) => void;
  onCancel: () => void;
}

const FORMAT_HINTS: Record<ExportFormat, string> = {
  mp4: "Best quality · Offline render · Universal playback",
  webm: "Good quality · Real-time capture · Web-friendly",
  gif: "Offline render · Large file size · No audio",
  png: "Lossless screenshot of current frame",
  jpeg: "Compressed screenshot of current frame",
};

export default function ExportDialog({
  isVideo,
  isExporting,
  exportProgress,
  onExport,
  onCancel,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>(isVideo ? "mp4" : "png");
  const [fps, setFps] = useState<number>(30);
  const [quality, setQuality] = useState<"low" | "medium" | "high">("high");

  const isVideoFormat = format === "mp4" || format === "webm" || format === "gif";

  if (isExporting) {
    return (
      <div className={styles.progressOverlay}>
        <div className={styles.progressBox}>
          <div className={styles.progressLabel}>Exporting {format.toUpperCase()}</div>
          <div className={styles.progressBarContainer}>
            <div
              className={styles.progressBar}
              style={{ width: `${exportProgress}%` }}
            />
          </div>
          <div className={styles.progressPercent}>{exportProgress}%</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className={styles.dialog}>
        <div className={styles.header}>
          <h2>Export</h2>
          <button className={styles.closeBtn} onClick={onCancel}>
            <X size={14} />
          </button>
        </div>

        <div className={styles.body}>
          {/* Format */}
          <div className={styles.field}>
            <span className={styles.label}>Format</span>
            <div className={styles.optionGroup}>
              {isVideo && (
                <>
                  <button
                    className={`${styles.option} ${format === "mp4" ? styles.active : ""}`}
                    onClick={() => setFormat("mp4")}
                  >
                    MP4
                  </button>
                  <button
                    className={`${styles.option} ${format === "webm" ? styles.active : ""}`}
                    onClick={() => setFormat("webm")}
                  >
                    WebM
                  </button>
                  <button
                    className={`${styles.option} ${format === "gif" ? styles.active : ""}`}
                    onClick={() => setFormat("gif")}
                  >
                    GIF
                  </button>
                </>
              )}
              <button
                className={`${styles.option} ${format === "png" ? styles.active : ""}`}
                onClick={() => setFormat("png")}
              >
                PNG
              </button>
              <button
                className={`${styles.option} ${format === "jpeg" ? styles.active : ""}`}
                onClick={() => setFormat("jpeg")}
              >
                JPEG
              </button>
            </div>
            <span className={styles.formatHint}>{FORMAT_HINTS[format]}</span>
          </div>

          {/* FPS — only for video formats */}
          {isVideoFormat && (
            <div className={styles.field}>
              <span className={styles.label}>Frame Rate</span>
              <div className={styles.optionGroup}>
                {[24, 30, 60].map((f) => (
                  <button
                    key={f}
                    className={`${styles.option} ${fps === f ? styles.active : ""}`}
                    onClick={() => setFps(f)}
                  >
                    {f} fps
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quality — only for video formats */}
          {isVideoFormat && (
            <div className={styles.field}>
              <span className={styles.label}>Quality</span>
              <div className={styles.optionGroup}>
                {(["low", "medium", "high"] as const).map((q) => (
                  <button
                    key={q}
                    className={`${styles.option} ${quality === q ? styles.active : ""}`}
                    onClick={() => setQuality(q)}
                  >
                    {q.charAt(0).toUpperCase() + q.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onCancel}>
            Cancel
          </button>
          <button
            className={styles.exportBtn}
            onClick={() => onExport({ format, fps, quality })}
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
