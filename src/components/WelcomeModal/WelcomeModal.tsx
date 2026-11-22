import { useEffect, useState, useCallback, useRef } from "react";
import { X, FilePlus, FolderOpen, Folder, FileText, ArrowRight } from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import { useProjectStore } from "../../stores/projectStore";
import styles from "./WelcomeModal.module.scss";

interface WelcomeModalProps {
  onClose: () => void;
}

function formatRelativeDate(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function shortenPath(filePath: string): string {
  const home = filePath.match(/^\/Users\/[^/]+/)?.[0] ?? "";
  return home ? filePath.replace(home, "~") : filePath;
}

export default function WelcomeModal({ onClose }: WelcomeModalProps) {
  const { projectsDirectory, recentProjects, setProjectsDirectory, removeRecentProject } =
    useAppStore();
  const { newProject, loadProject, isDirty } = useProjectStore();

  const [missingPaths, setMissingPaths] = useState<Set<string>>(new Set());
  const [namingNew, setNamingNew] = useState(false);
  const [newName, setNewName] = useState("Untitled Project");
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function checkPaths() {
      if (!window.electron) return;
      const missing = new Set<string>();
      await Promise.all(
        recentProjects.map(async (r) => {
          const res = await window.electron.file.exists(r.path);
          if (!res.exists) missing.add(r.path);
        }),
      );
      setMissingPaths(missing);
    }
    checkPaths();
  }, [recentProjects]);

  const confirmIfDirty = useCallback((): boolean => {
    if (!isDirty) return true;
    return window.confirm("You have unsaved changes. Discard them and continue?");
  }, [isDirty]);

  const handleSelectDirectory = useCallback(async () => {
    if (!window.electron) return;
    const result = await window.electron.selectDirectory();
    if (!result.canceled && result.filePaths.length > 0) {
      setProjectsDirectory(result.filePaths[0]);
    }
  }, [setProjectsDirectory]);

  const handleNewProjectClick = useCallback(() => {
    if (!confirmIfDirty()) return;
    setNewName("Untitled Project");
    setNamingNew(true);
    setTimeout(() => {
      nameInputRef.current?.select();
    }, 0);
  }, [confirmIfDirty]);

  const handleCreateNew = useCallback(() => {
    newProject(newName.trim() || "Untitled Project");
    onClose();
  }, [newName, newProject, onClose]);

  const handleCancelNew = useCallback(() => {
    setNamingNew(false);
  }, []);

  const handleOpenFile = useCallback(async () => {
    if (!confirmIfDirty()) return;
    await loadProject();
    onClose();
  }, [confirmIfDirty, loadProject, onClose]);

  const handleOpenRecent = useCallback(
    async (path: string) => {
      if (missingPaths.has(path)) return;
      if (!confirmIfDirty()) return;
      await loadProject(path);
      onClose();
    },
    [missingPaths, confirmIfDirty, loadProject, onClose],
  );

  const handleRemoveRecent = useCallback(
    (e: React.MouseEvent, path: string) => {
      e.stopPropagation();
      removeRecentProject(path);
    },
    [removeRecentProject],
  );

  const isSetup = !projectsDirectory;

  // Escape closes the modal (the project-name input handles its own Escape).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || namingNew) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [namingNew, onClose]);

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Welcome to Erosion Studio">
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.windowOrb} aria-hidden />
            <span className={styles.windowTitle}>Welcome to Erosion Studio</span>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} title="Close" aria-label="Close">
            <X size={12} />
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.hero}>
            <div className={styles.ribbons} aria-hidden>
              <span />
              <span />
            </div>
            <div className={styles.bubbles} aria-hidden>
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className={styles.heroText}>
              <h1 className={styles.logo}>
                Erosion <span className={styles.logoStudio}>Studio</span>
              </h1>
              <p className={styles.heroTagline}>Break the image. Keep the good parts.</p>
            </div>
          </div>

          <div className={styles.body}>
            {isSetup && (
              <div className={styles.setupSection}>
                <p className={styles.setupTitle}>Choose a projects folder</p>
                <p className={styles.setupDescription}>
                  Pick a folder where your Erosion projects will be saved by default.
                  You can always save projects anywhere else too.
                </p>
                <div className={styles.setupActions}>
                  <button
                    className={`${styles.btn} ${styles.primary}`}
                    onClick={handleSelectDirectory}
                  >
                    <Folder size={12} />
                    Choose Folder
                  </button>
                </div>
              </div>
            )}

            {namingNew ? (
              <div className={styles.newProjectForm}>
                <FilePlus size={16} className={styles.actionIcon} />
                <input
                  ref={nameInputRef}
                  className={styles.newProjectInput}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateNew();
                    if (e.key === "Escape") handleCancelNew();
                  }}
                  placeholder="Project name"
                  autoFocus
                />
                <button
                  className={`${styles.btn} ${styles.primary}`}
                  onClick={handleCreateNew}
                  title="Create project"
                >
                  <ArrowRight size={13} />
                  Create
                </button>
                <button
                  className={`${styles.btn} ${styles.secondary}`}
                  onClick={handleCancelNew}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className={styles.actions}>
                <button className={styles.actionBtn} onClick={handleNewProjectClick}>
                  <FilePlus size={18} className={styles.actionIcon} />
                  <span className={styles.actionLabel}>New Project</span>
                  <span className={styles.actionDesc}>Start with a blank canvas</span>
                </button>
                <button className={styles.actionBtn} onClick={handleOpenFile}>
                  <FolderOpen size={18} className={styles.actionIcon} />
                  <span className={styles.actionLabel}>Open Project</span>
                  <span className={styles.actionDesc}>Open an .eron file from disk</span>
                </button>
              </div>
            )}

            <div className={styles.recentSection}>
              <span className={styles.sectionLabel}>Recent Projects</span>
              {recentProjects.length === 0 ? (
                <p className={styles.emptyRecent}>No recent projects</p>
              ) : (
                <div className={styles.recentList}>
                  {recentProjects.map((project) => {
                    const missing = missingPaths.has(project.path);
                    return (
                      <div
                        key={project.path}
                        className={`${styles.recentItem} ${missing ? styles.missing : ""}`}
                        onClick={() => handleOpenRecent(project.path)}
                        title={missing ? "File not found" : project.path}
                      >
                        <FileText size={14} className={styles.recentIcon} />
                        <div className={styles.recentInfo}>
                          <div className={styles.recentName}>{project.name}</div>
                          <div className={styles.recentMeta}>
                            <span className={styles.recentPath}>
                              {shortenPath(project.path)}
                            </span>
                            <span className={styles.recentDate}>
                              {formatRelativeDate(project.lastOpened)}
                            </span>
                          </div>
                        </div>
                        {missing && (
                          <span className={styles.missingBadge}>missing</span>
                        )}
                        <button
                          className={styles.removeBtn}
                          onClick={(e) => handleRemoveRecent(e, project.path)}
                          title="Remove from recents"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className={styles.footer}>
            <button className={styles.changeDir} onClick={handleSelectDirectory}>
              <Folder size={11} />
              {projectsDirectory
                ? "Change projects folder"
                : "Set projects folder"}
            </button>
            {projectsDirectory && (
              <span className={styles.dirLabel} title={projectsDirectory}>
                {shortenPath(projectsDirectory)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
