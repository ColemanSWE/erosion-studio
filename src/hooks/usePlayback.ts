import { useEffect, useRef } from "react";

interface UsePlaybackOptions {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  setCurrentTime: (time: number) => void;
  pause: () => void;
}

export function usePlayback({
  isPlaying,
  currentTime,
  duration,
  setCurrentTime,
  pause,
}: UsePlaybackOptions) {
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  // Sync refs before effect runs so the RAF callback always reads fresh values
  currentTimeRef.current = currentTime;
  durationRef.current = duration;

  useEffect(() => {
    if (!isPlaying) return;

    let rafId: number;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const next = currentTimeRef.current + dt;
      if (next >= durationRef.current) {
        setCurrentTime(durationRef.current);
        pause();
      } else {
        setCurrentTime(next);
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, setCurrentTime, pause]);
}
