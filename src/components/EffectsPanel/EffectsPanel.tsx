import { useState } from "react";
import {
  Plus,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Trash2,
  Square,
} from "lucide-react";
import EffectParams from "./EffectParams";
import styles from "./EffectsPanel.module.scss";
import type { Effect, EffectType, Region } from "../../lib/effects/types";
import { isStyleEffect } from "../../lib/effects/effect-registry";

interface EffectsPanelProps {
  effects: Effect[];
  regions: Region[];
  activeRegionId: string | null;
  onAddEffect: (type: EffectType, regionId?: string) => void;
  onUpdateEffect: (id: string, updates: Partial<Effect>) => void;
  onRemoveEffect: (id: string) => void;
  onReorderEffect: (id: string, newIndex: number) => void;
  onRemoveRegion: (id: string) => void;
  onSelectRegion: (id: string | null) => void;
  onStartDrawingRegion: () => void;
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
  regions,
  activeRegionId,
  onAddEffect,
  onUpdateEffect,
  onRemoveEffect,
  onReorderEffect,
  onRemoveRegion,
  onSelectRegion,
  onStartDrawingRegion,
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

  const handleAddEffect = (type: EffectType) => {
    onAddEffect(type, activeRegionId || undefined);
  };

  const isStyleEffectDisabled = activeRegionId !== null;

  const globalEffects = effects.filter((e) => !e.regionId);
  const regionEffectsMap = new Map<string, Effect[]>();
  
  effects.forEach((effect) => {
    if (effect.regionId) {
      if (!regionEffectsMap.has(effect.regionId)) {
        regionEffectsMap.set(effect.regionId, []);
      }
      regionEffectsMap.get(effect.regionId)!.push(effect);
    }
  });

  const renderEffectCard = (effect: Effect, index: number) => (
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
  );

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
                {effectTypes.map((type) => {
                  const disabled = isStyleEffectDisabled && isStyleEffect(type as EffectType);
                  return (
                    <button
                      key={type}
                      className={styles.effectButton}
                      onClick={() => handleAddEffect(type as EffectType)}
                      disabled={disabled}
                      title={disabled ? "Style effects can only be applied globally" : undefined}
                    >
                      <Plus size={14} />
                      <span>{formatEffectName(type)}</span>
                    </button>
                  );
                })}
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
            <div
              className={`${styles.regionGroup} ${activeRegionId === null ? styles.active : ''}`}
              onClick={() => onSelectRegion(null)}
            >
              <div className={styles.regionHeader}>
                <span>Global</span>
                <span className={styles.count}>{globalEffects.length}</span>
              </div>
              {globalEffects.map((effect, index) => renderEffectCard(effect, index))}
            </div>

            {regions.map((region) => {
              const regionEffects = regionEffectsMap.get(region.id) || [];
              return (
                <div
                  key={region.id}
                  className={`${styles.regionGroup} ${activeRegionId === region.id ? styles.active : ''}`}
                  onClick={() => onSelectRegion(region.id)}
                >
                  <div className={styles.regionHeader}>
                    <div className={styles.regionHeaderLeft}>
                      <div
                        className={styles.colorDot}
                        style={{ backgroundColor: region.color }}
                      />
                      <span>{region.name}</span>
                    </div>
                    <div className={styles.regionHeaderRight}>
                      <span className={styles.count}>{regionEffects.length}</span>
                      <button
                        className={styles.deleteRegionButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveRegion(region.id);
                        }}
                        title="Delete region"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  {regionEffects.map((effect, index) => renderEffectCard(effect, index))}
                </div>
              );
            })}
          </div>
        )}

        <button className={styles.drawRegionButton} onClick={onStartDrawingRegion}>
          <Square size={14} />
          <span>Draw Region</span>
        </button>
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
