import { FileText, Undo, Redo, Download, Save, FolderOpen, Type } from "lucide-react";
import { PREDEFINED_RESOLUTIONS } from "../../lib/project";
import type { Resolution } from "../../lib/project";
import styles from "./Toolbar.module.scss";

interface ToolbarProps {
  projectName: string;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onOpen: () => void;
  onExport: () => void;
  onAddText: () => void;
  canUndo: boolean;
  canRedo: boolean;
  resolution: Resolution;
  onResolutionChange: (resolution: Resolution) => void;
}

function Toolbar({
  projectName,
  onUndo,
  onRedo,
  onSave,
  onOpen,
  onExport,
  onAddText,
  canUndo,
  canRedo,
  resolution,
  onResolutionChange,
}: ToolbarProps) {
  const handleResolutionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = PREDEFINED_RESOLUTIONS.find((r) => r.name === e.target.value);
    if (selected) onResolutionChange(selected);
  };

  return (
    <header className={styles.toolbar}>
      <div className={styles.left}>
        <span className={styles.logo}>Erosion Studio</span>
        <button className={styles.button} onClick={onSave} title="Save Project">
          <Save size={16} />
          <span>Save</span>
        </button>
        <button className={styles.button} onClick={onOpen} title="Open Project">
          <FolderOpen size={16} />
          <span>Open</span>
        </button>
      </div>

      <div className={styles.center}>
        <FileText size={16} />
        <span className={styles.projectName}>{projectName}</span>
      </div>

      <div className={styles.right}>
        <button className={styles.button} onClick={onAddText} title="Add Text Overlay">
          <Type size={16} />
          <span>Add Text</span>
        </button>
        <select
          className={styles.resolutionSelect}
          value={resolution.name}
          onChange={handleResolutionChange}
          title="Canvas resolution"
        >
          {PREDEFINED_RESOLUTIONS.map((r) => (
            <option key={r.name} value={r.name}>
              {r.name} ({r.width}×{r.height})
            </option>
          ))}
        </select>
        <button
          className={styles.button}
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Cmd+Z)"
        >
          <Undo size={16} />
          <span>Undo</span>
        </button>
        <button
          className={styles.button}
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Cmd+Shift+Z)"
        >
          <Redo size={16} />
          <span>Redo</span>
        </button>
        <button className={styles.exportButton} onClick={onExport}>
          <Download size={16} />
          <span>Export</span>
        </button>
      </div>
    </header>
  );
}

export default Toolbar;
