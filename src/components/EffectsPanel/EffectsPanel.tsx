import React, { useState } from "react";
import {
  Plus,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Trash2,
} from "lucide-react";
import EffectParams from "./EffectParams";
import styles from "./EffectsPanel.module.scss";
import type { Effect, EffectType } from "../../lib/effects/types";

interface EffectsPanelProps {
  effects: Effect[];
  onAddEffect: (type: EffectType) => void;
  onUpdateEffect: (id: string, updates: Partial<Effect>) => void;
  onRemoveEffect: (id: string) => void;
  onReorderEffect: (id: string, newIndex: number) => void;
}

const EFFECT_CATEGORIES = {
  glitch: [
    "glitch",
    "motion-smear",
    "block-corrupt",
    "pixel-sort",
    "datamosh",
    "jpeg-artifacts",
    "codec-damage",
    "rgb-channel-separation",
    "block-shoving",
    "screen-tear",
    "fragment-glitch",
    "data-destroy",
    "chaos",
  ],
  distortion: [
    "displacement",
    "wave-distortion",
    "twirl",
    "ripple",
    "heavy-distortion",
    "melt",
    "perlin-distort",
  ],
  color: [
    "invert",
    "posterize",
    "solarize",
    "duotone",
    "color-shift",
    "channel-swap",
    "thermal",
    "vignette",
    "chromatic-aberration",
    "bloom",
  ],
  retro: ["vhs", "crt", "film-grain", "scanlines", "dither", "scan-sweep"],
  noise: ["noise", "bitcrush"],
  style: ["pixelate", "emoji", "ascii", "matrix", "halftone", "3d-mesh"],
  face: [
    "face-pixelate",
    "face-blur",
    "face-color-replace",
    "face-eye-censor",
    "face-mouth-censor",
    "face-landmark-glitch",
    "detection-labels",
  ],
} as const;

function EffectsPanel({
  effects,
  onAddEffect,
  onUpdateEffect,
  onRemoveEffect,
  onReorderEffect,
}: EffectsPanelProps) {
  const [expandedCategories, setExpandedCategories] = useState<
    Record<string, boolean>
  >({
    glitch: true,
  });
  const [expandedEffects, setExpandedEffects] = useState<
    Record<string, boolean>
  >({});

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [category]: !prev[category],
    }));
  };

  const toggleEffect = (effectId: string) => {
    setExpandedEffects((prev) => ({
      ...prev,
      [effectId]: !prev[effectId],
    }));
  };

  return (
    <aside className={styles.effectsPanel}>
      <div className={styles.header}>
        <h3>Effects</h3>
      </div>

      <div className={styles.categories}>
        {Object.entries(EFFECT_CATEGORIES).map(([category, effectTypes]) => (
          <div key={category} className={styles.category}>
            <button
              className={styles.categoryHeader}
              onClick={() => toggleCategory(category)}
            >
              {expandedCategories[category] ? (
                <ChevronDown size={16} />
              ) : (
                <ChevronRight size={16} />
              )}
              <span>
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </span>
              <span className={styles.count}>{effectTypes.length}</span>
            </button>

            {expandedCategories[category] && (
              <div className={styles.effectList}>
                {effectTypes.map((type) => (
                  <button
                    key={type}
                    className={styles.effectButton}
                    onClick={() => onAddEffect(type as EffectType)}
                  >
                    <Plus size={14} />
                    <span>{formatEffectName(type)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className={styles.activeEffects}>
        <div className={styles.activeHeader}>
          <h4>Active Effects</h4>
          <span className={styles.count}>
            {effects.filter((e) => e.active).length}
          </span>
        </div>

        {effects.length === 0 ? (
          <div className={styles.empty}>
            <p>No effects applied</p>
            <p className={styles.hint}>Add effects from categories above</p>
          </div>
        ) : (
          <div className={styles.effectStack}>
            {effects.map((effect, index) => (
              <div
                key={effect.id}
                className={styles.effectCard}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const draggedId = e.dataTransfer.getData("text/plain");
                  if (draggedId && draggedId !== effect.id) {
                     onReorderEffect(draggedId, index);
                  }
                }}
              >
                <div className={styles.effectCardHeader}>
                  <button
                    className={styles.dragHandle}
                    title="Drag to reorder"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", effect.id);
                      e.dataTransfer.effectAllowed = "move";
                      // Set drag image to the card element (grandparent of handle)
                      const cardElement = e.currentTarget.parentElement?.parentElement;
                      if (cardElement) {
                         e.dataTransfer.setDragImage(cardElement, 20, 20);
                      }
                    }}
                  >
                    <GripVertical size={14} />
                  </button>
                  <input
                    type="checkbox"
                    checked={effect.active}
                    onChange={(e) =>
                      onUpdateEffect(effect.id, { active: e.target.checked })
                    }
                  />
                  <button
                    className={styles.expandButton}
                    onClick={() => toggleEffect(effect.id)}
                  >
                    {expandedEffects[effect.id] ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                  </button>
                  <span>{formatEffectName(effect.type)}</span>
                  <button
                    className={styles.removeButton}
                    onClick={() => onRemoveEffect(effect.id)}
                    title="Remove effect"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {expandedEffects[effect.id] && (
                  <EffectParams
                    effect={effect}
                    onUpdate={(updates) => onUpdateEffect(effect.id, updates)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function formatEffectName(type: string): string {
  return type
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default EffectsPanel;
