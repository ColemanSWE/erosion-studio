import type { StateCreator } from "zustand";
import type { ProjectState, HistoricalState } from "../projectState";
import { snapshotHistorical, MAX_HISTORY, resetHistoryCoalescing } from "../projectUtils";

export type HistorySlice = {
  _historyPast: HistoricalState[];
  _historyFuture: HistoricalState[];
  undo: () => void;
  redo: () => void;
};

export const createHistorySlice: StateCreator<ProjectState, [], [], HistorySlice> = (set) => ({
  _historyPast: [],
  _historyFuture: [],

  undo: () => {
    resetHistoryCoalescing();
    set((state) => {
      if (state._historyPast.length === 0) return state;
      const previous = state._historyPast[state._historyPast.length - 1];
      return {
        ...previous,
        _historyPast: state._historyPast.slice(0, -1),
        _historyFuture: [
          snapshotHistorical(state),
          ...state._historyFuture.slice(0, MAX_HISTORY - 1),
        ],
      };
    });
  },

  redo: () => {
    resetHistoryCoalescing();
    set((state) => {
      if (state._historyFuture.length === 0) return state;
      const next = state._historyFuture[0];
      return {
        ...next,
        _historyPast: [
          ...state._historyPast.slice(-(MAX_HISTORY - 1)),
          snapshotHistorical(state),
        ],
        _historyFuture: state._historyFuture.slice(1),
      };
    });
  },
});
