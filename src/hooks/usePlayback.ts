import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";

interface UsePlaybackOptions {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  setCurrentTime: (time: number) => void;
  pause: () => void;
}

// How often to flush the live time into the Zustand store during playback.
// Lower = more React re-renders (smoother keyframe animation, more CPU overhead).
// Higher = fewer re-renders (less overhead, but keyframe params lag behind).
const STORE_UPDATE_INTERVAL_MS = 50;

export function usePlayback({
  isPlaying,
  currentTime,
  duration,
  setCurrentTime,
  pause,
}: UsePlaybackOptions): { liveTimeRef: MutableRefObject<number> } {
  const durationRef = useRef(duration);
  durationRef.current = duration;

  // liveTimeRef is updated every RAF frame and drives direct-DOM playhead updates
  // and the video render loop. The Zustand store only syncs at ~20fps to avoid
  // React re-renders on every frame.
  const liveTimeRef = useRef(currentTime);

  // While paused, keep liveTimeRef in sync with the store so seeks/scrubs are
  // reflected immediately without waiting for the next play() call.
  if (!isPlaying) {
    liveTimeRef.current = currentTime;
  }

  useEffect(() => {
    if (!isPlaying) return;

    let rafId: number;
    let lastTime = performance.now();
    let lastStoreUpdate = performance.now();

    const tick = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const next = liveTimeRef.current + dt;

      if (next >= durationRef.current) {
        liveTimeRef.current = durationRef.current;
        setCurrentTime(durationRef.current);
        pause();
      } else {
        liveTimeRef.current = next;

        if (now - lastStoreUpdate >= STORE_UPDATE_INTERVAL_MS) {
          setCurrentTime(next);
          lastStoreUpdate = now;
        }

        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      // Flush the exact position so the store doesn't sit at a stale value after pause.
      setCurrentTime(liveTimeRef.current);
    };
  }, [isPlaying, setCurrentTime, pause]);

  return { liveTimeRef };
}
