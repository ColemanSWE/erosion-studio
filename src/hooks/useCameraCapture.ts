import { useRef, useState, useCallback } from "react";

export type CaptureMode = "idle" | "recording";

interface UseCameraCaptureOptions {
  /** The live camera stream from useCameraPlayer */
  stream: MediaStream | null;
  /** The canvas currently showing the processed camera feed (with effects applied) */
  canvas: HTMLCanvasElement | null;
  onMediaCaptured: (item: {
    id: string;
    type: "image" | "video";
    name: string;
    path: string;
    duration?: number;
    blob?: Blob;
  }) => void;
}

let captureCounter = 0;

export function useCameraCapture({
  stream,
  canvas,
  onMediaCaptured,
}: UseCameraCaptureOptions) {
  const [captureMode, setCaptureMode] = useState<CaptureMode>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);

  /**
   * Snap a still frame from the processed canvas.
   * Returns an object-URL blob URL so it can be displayed and dragged to the timeline.
   */
  const snapPhoto = useCallback(async () => {
    if (!canvas) return;

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const id = `capture-photo-${Date.now()}-${captureCounter++}`;
    onMediaCaptured({
      id,
      type: "image",
      name: `Snapshot ${new Date().toLocaleTimeString()}.png`,
      path: url,
      blob,
    });
  }, [canvas, onMediaCaptured]);

  /**
   * Start recording from the canvas stream.
   * Records the processed canvas output (effects included) rather than raw camera.
   */
  const startRecording = useCallback(() => {
    if (!canvas || captureMode !== "idle") return;

    // Prefer canvas capture stream (so effects are baked in)
    let recordStream: MediaStream;
    try {
      // HTMLCanvasElement.captureStream is supported in all modern browsers
      // but is not yet in the TypeScript DOM lib, hence the cast
      recordStream = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(30);
    } catch {
      // Fallback to raw camera stream
      if (!stream) return;
      recordStream = stream;
    }

    const supported = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ].find((t) => MediaRecorder.isTypeSupported(t));

    const recorder = new MediaRecorder(recordStream, {
      mimeType: supported ?? undefined,
    });

    chunksRef.current = [];
    startTimeRef.current = Date.now();

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const duration = (Date.now() - startTimeRef.current) / 1000;
      const blob = new Blob(chunksRef.current, {
        type: supported ?? "video/webm",
      });
      const url = URL.createObjectURL(blob);
      const id = `capture-video-${Date.now()}-${captureCounter++}`;
      onMediaCaptured({
        id,
        type: "video",
        name: `Recording ${new Date().toLocaleTimeString()}.webm`,
        path: url,
        duration,
        blob,
      });
      setCaptureMode("idle");
    };

    recorder.start(100);
    recorderRef.current = recorder;
    setCaptureMode("recording");
  }, [canvas, stream, captureMode, onMediaCaptured]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && captureMode === "recording") {
      recorderRef.current.stop();
      recorderRef.current = null;
    }
  }, [captureMode]);

  const recordingDuration = useCallback(() => {
    if (captureMode !== "recording") return 0;
    return (Date.now() - startTimeRef.current) / 1000;
  }, [captureMode]);

  return {
    captureMode,
    snapPhoto,
    startRecording,
    stopRecording,
    recordingDuration,
  };
}
