import { useEffect, useState } from "react";

/**
 * Opens the webcam while `isActive` and exposes both the raw MediaStream (for
 * recording fallbacks) and a playing <video> element the render engine draws from.
 */
export function useCameraStream(isActive: boolean) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!isActive) return;

    let cancelled = false;
    let activeStream: MediaStream | null = null;
    let element: HTMLVideoElement | null = null;

    navigator.mediaDevices
      .getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
      .then((mediaStream) => {
        if (cancelled) {
          mediaStream.getTracks().forEach((t) => t.stop());
          return;
        }
        activeStream = mediaStream;
        setStream(mediaStream);

        element = document.createElement("video");
        element.muted = true;
        element.playsInline = true;
        element.autoplay = true;
        element.srcObject = mediaStream;
        const el = element;
        el.onloadedmetadata = () => {
          el.play().catch(() => {});
          if (!cancelled) setVideo(el);
        };
      })
      .catch((err) => console.error("Error accessing camera:", err));

    return () => {
      cancelled = true;
      activeStream?.getTracks().forEach((t) => t.stop());
      if (element) {
        element.onloadedmetadata = null;
        element.pause();
        element.srcObject = null;
      }
      setStream(null);
      setVideo(null);
    };
  }, [isActive]);

  return { stream, video };
}
