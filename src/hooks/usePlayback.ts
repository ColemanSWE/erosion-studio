import { useEffect, useRef } from "react";
import { playbackClock } from "../lib/engine/clock";

interface UsePlaybackOptions {
  isPlaying: boolean;
  duration: number;
  setCurrentTime: (time: number) => void;
  pause: () => void;
}

/**
 * Playback heartbeat. Advances the shared PlaybackClock at wall-clock speed while
 * playing. It deliberately never writes to the project store mid-playback —
 * consumers that need live time subscribe to the clock — and commits the final
 * position to the store on pause / end.
 */
export function usePlayback({ isPlaying, duration, setCurrentTime, pause }: UsePlaybackOptions): void {
  const durationRef = useRef(duration);
  durationRef.current = duration;

  useEffect(() => {
    if (!isPlaying) return;

    let rafId = 0;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      const next = playbackClock.time + dt;

      if (next >= durationRef.current) {
        playbackClock.advance(durationRef.current);
        pause();
        return;
      }

      playbackClock.advance(next);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      // Commit the exact position so the store matches the clock after pause.
      setCurrentTime(playbackClock.time);
    };
  }, [isPlaying, setCurrentTime, pause]);
}
