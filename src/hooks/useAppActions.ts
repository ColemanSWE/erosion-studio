import { useCallback, useEffect } from "react";

interface UseAppActionsOptions {
  isDirty: boolean;
  undo: () => void;
  redo: () => void;
  saveProject: () => Promise<void>;
  saveProjectAs: () => Promise<void>;
  loadProject: () => Promise<void>;
  newProject: (name: string) => void;
  setShowWelcome: (v: boolean) => void;
}

export interface AppActions {
  handleUndo: () => void;
  handleRedo: () => void;
  handleSave: () => Promise<void>;
  handleSaveAs: () => Promise<void>;
  handleNewProject: () => void;
  handleShowWelcome: () => void;
  handleCloseWelcome: () => void;
}

export function useAppActions({
  isDirty,
  undo,
  redo,
  saveProject,
  saveProjectAs,
  loadProject,
  newProject,
  setShowWelcome,
}: UseAppActionsOptions): AppActions {
  const handleUndo = useCallback(() => undo(), [undo]);
  const handleRedo = useCallback(() => redo(), [redo]);
  const handleSave = useCallback(async () => saveProject(), [saveProject]);
  const handleSaveAs = useCallback(async () => saveProjectAs(), [saveProjectAs]);

  const handleNewProject = useCallback(() => {
    if (isDirty && !window.confirm("You have unsaved changes. Discard them and create a new project?")) return;
    newProject("Untitled Project");
  }, [isDirty, newProject]);

  const handleShowWelcome = useCallback(() => setShowWelcome(true), [setShowWelcome]);
  const handleCloseWelcome = useCallback(() => setShowWelcome(false), [setShowWelcome]);

  useEffect(() => {
    if (!window.electron?.onMenuAction) return;
    const unsubscribe = window.electron.onMenuAction((action) => {
      switch (action) {
        case "new-project": handleNewProject(); break;
        case "open-project": loadProject(); break;
        case "save-project": handleSave(); break;
        case "save-project-as": handleSaveAs(); break;
        case "undo": handleUndo(); break;
        case "redo": handleRedo(); break;
      }
    });
    return unsubscribe;
  }, [handleNewProject, loadProject, handleSave, handleSaveAs, handleUndo, handleRedo]);

  return { handleUndo, handleRedo, handleSave, handleSaveAs, handleNewProject, handleShowWelcome, handleCloseWelcome };
}
