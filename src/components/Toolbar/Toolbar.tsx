import { memo, useState, useRef, useCallback, useEffect } from "react";
import {
  Undo,
  Redo,
  Download,
  Save,
  SaveAll,
  FolderOpen,
  PanelLeft,
  PanelRight,
  PanelBottom,
  FileText,
  FilePlus,
  Home,
} from "lucide-react";
import { PREDEFINED_RESOLUTIONS } from "../../lib/project";
import { Button, IconButton, Select } from "../ui";
import type { Resolution } from "../../lib/project";
import styles from "./Toolbar.module.scss";

interface ToolbarProps {
  projectName: string;
  isDirty: boolean;
  onProjectNameChange: (name: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onOpen: () => void;
  onNewProject: () => void;
  onShowWelcome: () => void;
  onExport: () => void;
  canUndo: boolean;
  canRedo: boolean;
  resolution: Resolution;
  onResolutionChange: (resolution: Resolution) => void;
  showMediaBrowser: boolean;
  showEffectsPanel: boolean;
  showTimeline: boolean;
  onToggleMediaBrowser: () => void;
  onToggleEffectsPanel: () => void;
  onToggleTimeline: () => void;
}

function Toolbar({
  projectName,
  isDirty,
  onProjectNameChange,
  onUndo,
  onRedo,
  onSave,
  onSaveAs,
  onOpen,
  onNewProject,
  onShowWelcome,
  onExport,
  canUndo,
  canRedo,
  resolution,
  onResolutionChange,
  showMediaBrowser,
  showEffectsPanel,
  showTimeline,
  onToggleMediaBrowser,
  onToggleEffectsPanel,
  onToggleTimeline,
}: ToolbarProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(projectName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setEditValue(projectName);
  }, [projectName, editing]);

  const startEditing = useCallback(() => {
    setEditValue(projectName);
    setEditing(true);
  }, [projectName]);

  const commitEdit = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== projectName) {
      onProjectNameChange(trimmed);
    }
    setEditing(false);
  }, [editValue, projectName, onProjectNameChange]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditValue(projectName);
  }, [projectName]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const handleResolutionChange = (name: string) => {
    const selected = PREDEFINED_RESOLUTIONS.find((r) => r.name === name);
    if (selected) onResolutionChange(selected);
  };

  return (
    <header className={styles.toolbar}>
      <div className={styles.left}>
        <IconButton label="Home / Recent projects" icon={<Home size={14} />} onClick={onShowWelcome} />
        <span className={styles.logo}>Erosion</span>
        <div className={styles.divider} />
        <IconButton label="New project" title="New project (Cmd+N)" icon={<FilePlus size={14} />} onClick={onNewProject} />
        <IconButton label="Save project" title="Save project (Cmd+S)" icon={<Save size={14} />} onClick={onSave} />
        <IconButton label="Save project as" title="Save project as (Cmd+Shift+S)" icon={<SaveAll size={14} />} onClick={onSaveAs} />
        <IconButton label="Open project" icon={<FolderOpen size={14} />} onClick={onOpen} />
        <div className={styles.divider} />
        <FileText size={12} className={styles.projectIcon} aria-hidden />
        <div className={styles.projectNameWrapper}>
          {editing ? (
            <input
              ref={inputRef}
              className={styles.projectNameInput}
              aria-label="Project name"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit();
                if (e.key === "Escape") cancelEdit();
              }}
            />
          ) : (
            <button type="button" className={styles.projectName} onClick={startEditing} title="Click to rename">
              {projectName}
            </button>
          )}
          {isDirty && !editing && <span className={styles.dirtyDot} title="Unsaved changes" aria-label="Unsaved changes" />}
        </div>
      </div>

      <div className={styles.center}>
        <IconButton label="Toggle media browser" icon={<PanelLeft size={14} />} pressed={showMediaBrowser} onClick={onToggleMediaBrowser} />
        <IconButton label="Toggle timeline" icon={<PanelBottom size={14} />} pressed={showTimeline} onClick={onToggleTimeline} />
        <IconButton label="Toggle effects panel" icon={<PanelRight size={14} />} pressed={showEffectsPanel} onClick={onToggleEffectsPanel} />
      </div>

      <div className={styles.right}>
        <Select
          aria-label="Canvas resolution"
          title="Canvas resolution"
          value={resolution.name}
          options={PREDEFINED_RESOLUTIONS.map((r) => r.name)}
          onChange={handleResolutionChange}
        />
        <div className={styles.divider} />
        <IconButton label="Undo" title="Undo (Cmd+Z)" icon={<Undo size={14} />} onClick={onUndo} disabled={!canUndo} />
        <IconButton label="Redo" title="Redo (Cmd+Shift+Z)" icon={<Redo size={14} />} onClick={onRedo} disabled={!canRedo} />
        <div className={styles.divider} />
        <Button variant="primary" icon={<Download size={14} />} onClick={onExport} title="Export (Cmd+E)">
          Export
        </Button>
      </div>
    </header>
  );
}

export default memo(Toolbar);
