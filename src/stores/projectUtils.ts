import type { HistoricalState, ProjectState } from "./projectState";

export const MAX_HISTORY = 50;

export function snapshotHistorical(state: HistoricalState): HistoricalState {
  return {
    effects: state.effects,
    regions: state.regions,
    overlays: state.overlays,
    clips: state.clips,
    media: state.media,
    effectParamTracks: state.effectParamTracks,
  };
}

/**
 * Continuous edits (dragging a clip, scrubbing a slider) arrive as a stream of
 * updates to the same object. Updates sharing a coalesce key within this window
 * fold into the snapshot taken at the start of the gesture, so one drag is one
 * undo step instead of filling the history.
 */
const COALESCE_WINDOW_MS = 750;
let lastCoalesceKey: string | null = null;
let lastCoalesceAt = 0;

/** Ends any open coalescing run (call after undo/redo/load). */
export function resetHistoryCoalescing(): void {
  lastCoalesceKey = null;
}

export function withHistory(
  state: Pick<ProjectState, "_historyPast" | "_historyFuture" | keyof HistoricalState>,
  coalesceKey?: string,
): Partial<Pick<ProjectState, "_historyPast" | "_historyFuture" | "isDirty">> {
  const now = Date.now();
  if (coalesceKey && coalesceKey === lastCoalesceKey && now - lastCoalesceAt < COALESCE_WINDOW_MS) {
    lastCoalesceAt = now;
    return { isDirty: true };
  }
  lastCoalesceKey = coalesceKey ?? null;
  lastCoalesceAt = now;
  return {
    isDirty: true,
    _historyPast: [
      ...state._historyPast.slice(-(MAX_HISTORY - 1)),
      snapshotHistorical(state),
    ],
    _historyFuture: [],
  };
}
