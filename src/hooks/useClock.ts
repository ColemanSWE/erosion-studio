import { useCallback, useSyncExternalStore } from "react";
import { playbackClock } from "../lib/engine/clock";

const subscribe = (onChange: () => void) => playbackClock.subscribe(onChange);

/**
 * Subscribe a component to a *derived* value of the live playback time.
 *
 * The selector runs on every clock tick, but the component only re-renders when
 * the returned value changes (compared with Object.is), so return primitives —
 * e.g. a formatted time string, or a key describing which clips are active.
 */
export function useClockSelector<T extends string | number | boolean>(
  selector: (time: number) => T,
): T {
  const getSnapshot = useCallback(() => selector(playbackClock.time), [selector]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
