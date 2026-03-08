import { Upload, Image, Film, Camera, X, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import styles from "./MediaBrowser.module.scss";
import type { MediaItem } from "../../lib/project";

interface MediaBrowserProps {
  media: MediaItem[];
  onImport: () => void;
  onAddCamera: () => void;
  onSelect: (item: MediaItem) => void;
  onRemove: (id: string) => void;
  onDropFiles?: (files: FileList) => void;
  selectedId?: string;
}

function MediaBrowser({
  media,
  onImport,
  onAddCamera,
  onSelect,
  onRemove,
  onDropFiles,
  selectedId,
}: MediaBrowserProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    // Only handle OS file drops (not internal media-item drags)
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0 && onDropFiles) {
      onDropFiles(e.dataTransfer.files);
    }
  }, [onDropFiles]);

  return (
    <aside
      className={`${styles.mediaBrowser} ${isDragOver ? styles.dragOver : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={styles.header}>
        <h3>Media</h3>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className={styles.importButton} onClick={onAddCamera} title="Add Live Camera">
            <Camera size={16} />
            <span>Cam</span>
          </button>
          <button className={styles.importButton} onClick={onImport} title="Import File">
            <Upload size={16} />
            <span>Import</span>
          </button>
        </div>
      </div>

      <div className={styles.mediaList}>
        {media.length === 0 ? (
          <div className={`${styles.empty} ${isDragOver ? styles.dropHint : ""}`}>
            <Upload size={32} />
            <p>No media imported</p>
            <p className={styles.hint}>
              {isDragOver ? "Drop files here!" : "Click Import or drag files here"}
            </p>
          </div>
        ) : (
          <>
            {isDragOver && (
              <div className={styles.dropOverlay}>
                <Plus size={24} />
                <span>Drop to add</span>
              </div>
            )}
            {media.map((item) => (
              <div
                key={item.id}
                className={`${styles.mediaItem} ${
                  selectedId === item.id ? styles.selected : ""
                }`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    "application/media-item",
                    JSON.stringify(item),
                  );
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onSelect(item)}
              >
                <div className={styles.thumbnail}>
                  {item.type === "image" ? (
                    <Image size={24} />
                  ) : item.type === "camera" ? (
                    <Camera size={24} />
                  ) : (
                    <Film size={24} />
                  )}
                </div>
                <div className={styles.info}>
                  <span className={styles.name}>{item.name}</span>
                  {item.duration && (
                    <span className={styles.duration}>
                      {formatDuration(item.duration)}
                    </span>
                  )}
                </div>
                <button
                  className={styles.removeButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(item.id);
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default MediaBrowser;
