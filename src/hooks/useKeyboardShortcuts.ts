import { useEffect } from "react";

interface KeyboardShortcuts {
  undo: () => void;
  redo: () => void;
  save: () => void;
  saveAs: () => void;
  newProject: () => void;
  export: () => void;
  playPause: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as HTMLElement;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcuts) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
      // With Shift held (or Caps Lock on) e.key is upper-case ("Z", "S").
      const key = e.key.toLowerCase();

      if (cmdOrCtrl && key === "z" && !e.shiftKey && shortcuts.canUndo) {
        e.preventDefault();
        shortcuts.undo();
      } else if (
        cmdOrCtrl &&
        ((key === "z" && e.shiftKey) || key === "y") &&
        shortcuts.canRedo
      ) {
        e.preventDefault();
        shortcuts.redo();
      } else if (cmdOrCtrl && key === "s" && e.shiftKey) {
        e.preventDefault();
        shortcuts.saveAs();
      } else if (cmdOrCtrl && key === "s") {
        e.preventDefault();
        shortcuts.save();
      } else if (cmdOrCtrl && key === "n" && !isEditableTarget(e.target)) {
        e.preventDefault();
        shortcuts.newProject();
      } else if (cmdOrCtrl && key === "e") {
        e.preventDefault();
        shortcuts.export();
      } else if (e.key === " " && !isEditableTarget(e.target)) {
        e.preventDefault();
        shortcuts.playPause();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts]);
}
