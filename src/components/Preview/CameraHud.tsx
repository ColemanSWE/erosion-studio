import { Camera, Video, Square as StopIcon } from "lucide-react";
import styles from "./Preview.module.scss";

interface CameraHudProps {
  captureMode: "idle" | "recording";
  recSeconds: number;
  onSnap: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
}

export function CameraHud({ captureMode, recSeconds, onSnap, onStartRecording, onStopRecording }: CameraHudProps) {
  return (
    <div className={styles.captureHud}>
      <button
        type="button"
        className={`${styles.captureBtn} ${styles.snap}`}
        onClick={onSnap}
        title="Snap photo from canvas (effects included)"
      >
        <Camera size={13} />
        Snap
      </button>
      {captureMode === "idle" ? (
        <button
        type="button"
          className={`${styles.captureBtn} ${styles.record}`}
          onClick={onStartRecording}
          title="Start recording (effects included)"
        >
          <Video size={13} />
          Record
        </button>
      ) : (
        <>
          <span className={styles.recTimer} role="timer" aria-label="Recording time">
            {String(Math.floor(recSeconds / 60)).padStart(2, "0")}:
            {String(recSeconds % 60).padStart(2, "0")}
          </span>
          <button
        type="button"
            className={`${styles.captureBtn} ${styles.record} ${styles.recording}`}
            onClick={onStopRecording}
            title="Stop recording"
          >
            <StopIcon size={13} />
            Stop
          </button>
        </>
      )}
    </div>
  );
}
