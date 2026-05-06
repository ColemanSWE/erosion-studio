import type { Overlay } from "../../lib/effects/types";
import styles from "./EffectsPanel.module.scss";

const FONT_OPTIONS = [
  { label: "Inter", value: "Inter, sans-serif" },
  { label: "JetBrains Mono", value: "'JetBrains Mono', monospace" },
  { label: "MingLiU", value: "MingLiU, 'Noto Serif TC', 'Songti SC', STSong, serif" },
  { label: "Noto Serif TC", value: "'Noto Serif TC', serif" },
  { label: "Space Mono", value: "'Space Mono', monospace" },
  { label: "VT323", value: "VT323, monospace" },
  { label: "Bebas Neue", value: "'Bebas Neue', sans-serif" },
  { label: "Courier New", value: "'Courier New', Courier, monospace" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Arial Black", value: "'Arial Black', sans-serif" },
];

interface OverlayPropertiesProps {
  overlay: Overlay;
  onUpdateOverlay: (id: string, updates: Partial<Overlay>) => void;
}

export function OverlayProperties({ overlay, onUpdateOverlay }: OverlayPropertiesProps) {
  return (
    <div className={styles.overlayPropsSection}>
      <div className={styles.overlayPropsHeader}>
        <h5>Overlay Properties</h5>
      </div>
      <div className={styles.overlayPropsBody}>
        {overlay.type === "text" && (
          <>
            <div className={styles.paramRow}>
              <span className={styles.paramLabel}>Text</span>
              <input
                type="text"
                className={styles.textInput}
                value={overlay.text || ""}
                onChange={(e) => onUpdateOverlay(overlay.id, { text: e.target.value })}
              />
            </div>
            <div className={styles.paramRow}>
              <span className={styles.paramLabel}>Font</span>
              <select
                className={styles.fontSelect}
                value={overlay.fontFamily || "Inter, sans-serif"}
                onChange={(e) => onUpdateOverlay(overlay.id, { fontFamily: e.target.value })}
              >
                {FONT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} style={{ fontFamily: opt.value }}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.paramRow}>
              <span className={styles.paramLabel}>Color</span>
              <input
                type="color"
                className={styles.colorInput}
                value={overlay.color || "#ffffff"}
                onChange={(e) => onUpdateOverlay(overlay.id, { color: e.target.value })}
              />
            </div>
            <div className={styles.paramRow}>
              <span className={styles.paramLabel}>Size</span>
              <input
                type="range"
                className={styles.sizeSlider}
                min={1}
                max={30}
                step={1}
                value={Math.round((overlay.fontSize ?? 0.08) * 100)}
                onChange={(e) =>
                  onUpdateOverlay(overlay.id, { fontSize: Number(e.target.value) / 100 })
                }
              />
              <span className={styles.sliderValue}>
                {Math.round((overlay.fontSize ?? 0.08) * 100)}%
              </span>
            </div>
          </>
        )}

        <div className={styles.paramRow}>
          <span className={styles.paramLabel}>Opacity</span>
          <input
            type="range"
            className={styles.sizeSlider}
            min={0}
            max={100}
            step={1}
            value={Math.round((overlay.opacity ?? 1) * 100)}
            onChange={(e) =>
              onUpdateOverlay(overlay.id, { opacity: Number(e.target.value) / 100 })
            }
          />
          <span className={styles.sliderValue}>{Math.round((overlay.opacity ?? 1) * 100)}%</span>
        </div>

        <div className={styles.paramRow}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={!!overlay.isEffectZone}
              onChange={(e) => onUpdateOverlay(overlay.id, { isEffectZone: e.target.checked })}
            />
            Use as Effect Zone
          </label>
        </div>
        {overlay.isEffectZone && (
          <p className={styles.zoneHint}>
            This overlay is now filled with the video behind it. Select the zone in the stack below
            and add effects to transform what shows through.
          </p>
        )}
      </div>
    </div>
  );
}
