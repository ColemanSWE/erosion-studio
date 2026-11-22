import { Upload, Image, Film, Camera, X, Plus } from "lucide-react";
import { memo, useCallback, useState } from "react";
import styles from "./MediaBrowser.module.scss";
import { Button, IconButton } from "../ui";
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
        <div className={styles.headerActions}>
          <IconButton label="Add live camera" size="sm" variant="secondary" icon={<Camera size={12} />} onClick={onAddCamera} />
          <Button size="sm" variant="primary" icon={<Upload size={12} />} onClick={onImport} title="Import file">
            Import
          </Button>
        </div>
      </div>

      <div className={styles.mediaList} role="list" aria-label="Imported media">
        {media.length === 0 ? (
          <div className={styles.empty}>
            <Upload size={24} />
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
                role="listitem"
                tabIndex={0}
                aria-current={selectedId === item.id || undefined}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(item);
                  } else if (e.key === "Delete" || e.key === "Backspace") {
                    e.preventDefault();
                    onRemove(item.id);
                  }
                }}
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
                    <Image size={16} />
                  ) : item.type === "camera" ? (
                    <Camera size={16} />
                  ) : (
                    <Film size={16} />
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
                <IconButton
                  label={`Remove ${item.name}`}
                  size="sm"
                  className={styles.removeButton}
                  icon={<X size={14} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(item.id);
                  }}
                />
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

export default memo(MediaBrowser);
