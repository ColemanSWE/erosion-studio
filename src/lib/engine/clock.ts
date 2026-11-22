/**
 * PlaybackClock — the single source of truth for "where is the playhead right now".
 *
 * During playback it is advanced every animation frame by `usePlayback`, without
 * touching React state. Anything that needs the live time (render engine,
 * playhead line, ruler, auto-scroll, time display) subscribes here directly.
 *
 * The project store's `currentTime` is the *committed* time: it changes only on
 * seek / pause / stop / load, and every such change is mirrored into the clock
 * as a seek (see projectStore.ts).
 */

export type ClockListener = (time: number, isSeek: boolean) => void;

export class PlaybackClock {
  private _time = 0;
  private listeners = new Set<ClockListener>();

  get time(): number {
    return this._time;
  }

  /** Continuous advance during playback. */
  advance(time: number): void {
    this.update(time, false);
  }

  /** Discontinuous jump (scrub, stop, load, export). */
  seek(time: number): void {
    this.update(time, true);
  }

  subscribe(listener: ClockListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private update(time: number, isSeek: boolean): void {
    if (time === this._time) return;
    this._time = time;
    for (const listener of this.listeners) listener(time, isSeek);
  }
}

export const playbackClock = new PlaybackClock();
