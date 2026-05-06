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

export function withHistory(
  state: Pick<ProjectState, "_historyPast" | "_historyFuture" | keyof HistoricalState>,
): Pick<ProjectState, "_historyPast" | "_historyFuture" | "isDirty"> {
  return {
    isDirty: true,
    _historyPast: [
      ...state._historyPast.slice(-(MAX_HISTORY - 1)),
      snapshotHistorical(state),
    ],
    _historyFuture: [],
  };
}
