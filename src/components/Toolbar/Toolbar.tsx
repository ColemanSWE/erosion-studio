import {
  Undo,
  Redo,
  Download,
  Save,
  FolderOpen,
  PanelLeft,
  PanelRight,
  PanelBottom,
  FileText,
} from "lucide-react";
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
  onUndo,
  onRedo,
  onSave,
  onOpen,
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
  const handleResolutionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = PREDEFINED_RESOLUTIONS.find((r) => r.name === e.target.value);
    if (selected) onResolutionChange(selected);
  };

  return (
    <header className={styles.toolbar}>
      <div className={styles.left}>
        <span className={styles.logo}>Erosion</span>
        <div className={styles.divider} />
        <button className={styles.iconButton} onClick={onSave} title="Save project (Cmd+S)">
          <Save size={14} />
        </button>
        <button className={styles.iconButton} onClick={onOpen} title="Open project">
          <FolderOpen size={14} />
        </button>
        <div className={styles.divider} />
        <FileText size={12} className={styles.projectIcon} />
        <span className={styles.projectName}>{projectName}</span>
      </div>

      <div className={styles.center}>
        <button
          className={`${styles.panelToggle} ${showMediaBrowser ? styles.active : ""}`}
          onClick={onToggleMediaBrowser}
          title="Toggle media browser"
        >
          <PanelLeft size={14} />
        </button>
        <button
          className={`${styles.panelToggle} ${showTimeline ? styles.active : ""}`}
          onClick={onToggleTimeline}
          title="Toggle timeline"
        >
          <PanelBottom size={14} />
        </button>
        <button
          className={`${styles.panelToggle} ${showEffectsPanel ? styles.active : ""}`}
          onClick={onToggleEffectsPanel}
          title="Toggle effects panel"
        >
          <PanelRight size={14} />
        </button>
      </div>

      <div className={styles.right}>
        <select
          className={styles.resolutionSelect}
          value={resolution.name}
          onChange={handleResolutionChange}
          title="Canvas resolution"
        >
          {PREDEFINED_RESOLUTIONS.map((r) => (
            <option key={r.name} value={r.name}>
              {r.name}
            </option>
          ))}
        </select>
        <div className={styles.divider} />
        <button
          className={styles.iconButton}
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Cmd+Z)"
        >
          <Undo size={14} />
        </button>
        <button
          className={styles.iconButton}
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Cmd+Shift+Z)"
        >
          <Redo size={14} />
        </button>
        <div className={styles.divider} />
        <button className={styles.exportButton} onClick={onExport} title="Export (Cmd+E)">
          <Download size={14} />
          <span>Export</span>
        </button>
      </div>
    </header>
  );
}

export default Toolbar;
