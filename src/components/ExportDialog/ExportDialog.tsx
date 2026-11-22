import { useState } from "react";
import { Download } from "lucide-react";
import { Button, Dialog, Field, SegmentedControl } from "../ui";
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
  webm: "Good quality · Offline render · Web-friendly",
  gif: "Offline render · Large file size · No audio",
  png: "Lossless screenshot of current frame",
  jpeg: "Compressed screenshot of current frame",
};

const VIDEO_FORMATS = [
  { value: "mp4", label: "MP4" },
  { value: "webm", label: "WebM" },
  { value: "gif", label: "GIF" },
] as const;
const IMAGE_FORMATS = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
] as const;
const FPS_OPTIONS = [24, 30, 60].map((f) => ({ value: f, label: `${f} fps` }));
const QUALITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const;

export default function ExportDialog({ isVideo, isExporting, exportProgress, onExport, onCancel }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>(isVideo ? "mp4" : "png");
  const [fps, setFps] = useState(30);
  const [quality, setQuality] = useState<ExportSettings["quality"]>("high");

  const isVideoFormat = format === "mp4" || format === "webm" || format === "gif";
  const formats = isVideo ? [...VIDEO_FORMATS, ...IMAGE_FORMATS] : IMAGE_FORMATS;

  if (isExporting) {
    return (
      <Dialog title={`Exporting ${format.toUpperCase()}`} onClose={onCancel} dismissible={false}>
        <div className={styles.progress}>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={exportProgress}
            aria-label="Export progress"
          >
            <div className={styles.progressBar} style={{ width: `${exportProgress}%` }} />
          </div>
          <div className={styles.progressPercent} aria-hidden>
            {exportProgress}%
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Export"
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" icon={<Download size={14} />} onClick={() => onExport({ format, fps, quality })}>
            Export
          </Button>
        </>
      }
    >
      <Field label="Format" hint={FORMAT_HINTS[format]}>
        <SegmentedControl aria-label="Format" value={format} options={formats} onChange={setFormat} />
      </Field>

      {isVideoFormat && (
        <>
          <Field label="Frame rate">
            <SegmentedControl aria-label="Frame rate" value={fps} options={FPS_OPTIONS} onChange={setFps} />
          </Field>
          {format !== "gif" && (
            <Field label="Quality">
              <SegmentedControl aria-label="Quality" value={quality} options={QUALITY_OPTIONS} onChange={setQuality} />
            </Field>
          )}
        </>
      )}
    </Dialog>
  );
}
