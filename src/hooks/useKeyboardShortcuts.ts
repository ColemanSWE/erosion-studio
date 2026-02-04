import { useEffect } from "react";

interface KeyboardShortcuts {
  undo: () => void;
  redo: () => void;
  save: () => void;
  export: () => void;
  playPause: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcuts) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      if (cmdOrCtrl && e.key === "z" && !e.shiftKey && shortcuts.canUndo) {
        e.preventDefault();
        shortcuts.undo();
      } else if (
        cmdOrCtrl &&
        ((e.key === "z" && e.shiftKey) || e.key === "y") &&
        shortcuts.canRedo
      ) {
        e.preventDefault();
        shortcuts.redo();
      } else if (cmdOrCtrl && e.key === "s") {
        e.preventDefault();
        shortcuts.save();
      } else if (cmdOrCtrl && e.key === "e") {
        e.preventDefault();
        shortcuts.export();
      } else if (
        (e.key === " " && !e.target) ||
        (e.target as HTMLElement).tagName !== "INPUT"
      ) {
        e.preventDefault();
        shortcuts.playPause();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts]);
}
