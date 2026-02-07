import { FileText, Undo, Redo, Download } from "lucide-react";
import styles from "./Toolbar.module.scss";

interface ToolbarProps {
  projectName: string;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

function Toolbar({
  projectName,
  onUndo,
  onRedo,
  onExport,
  canUndo,
  canRedo,
}: ToolbarProps) {
  return (
    <header className={styles.toolbar}>
      <div className={styles.left}>
        <span className={styles.logo}>Erosion Studio</span>
      </div>

      <div className={styles.center}>
        <FileText size={16} />
        <span className={styles.projectName}>{projectName}</span>
      </div>

      <div className={styles.right}>
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
