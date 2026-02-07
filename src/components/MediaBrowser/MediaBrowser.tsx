import { Upload, Image, Film, X } from "lucide-react";
import styles from "./MediaBrowser.module.scss";
import type { MediaItem } from "../../lib/project";

interface MediaBrowserProps {
  media: MediaItem[];
  onImport: () => void;
  onSelect: (item: MediaItem) => void;
  onRemove: (id: string) => void;
  selectedId?: string;
}

function MediaBrowser({
  media,
  onImport,
  onSelect,
  onRemove,
  selectedId,
}: MediaBrowserProps) {
  return (
    <aside className={styles.mediaBrowser}>
      <div className={styles.header}>
        <h3>Media</h3>
        <button className={styles.importButton} onClick={onImport}>
          <Upload size={16} />
          <span>Import</span>
        </button>
      </div>

      <div className={styles.mediaList}>
        {media.length === 0 ? (
          <div className={styles.empty}>
            <Upload size={32} />
            <p>No media imported</p>
            <p className={styles.hint}>Click Import to add photos or videos</p>
          </div>
        ) : (
          media.map((item) => (
            <div
              key={item.id}
              className={`${styles.mediaItem} ${
                selectedId === item.id ? styles.selected : ""
              }`}
              onClick={() => onSelect(item)}
            >
              <div className={styles.thumbnail}>
                {item.type === "image" ? (
                  <Image size={24} />
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
          ))
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
