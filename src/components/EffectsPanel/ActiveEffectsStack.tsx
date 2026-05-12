import { useState } from "react";
import { GripVertical, Trash2, Square, Type, ChevronDown, ChevronRight } from "lucide-react";
import EffectParams from "./EffectParams";
import { OverlayProperties } from "./OverlayProperties";
import { formatEffectName } from "./effectsPanelUtils";
import styles from "./EffectsPanel.module.scss";
import type { Effect, Region, Overlay } from "../../lib/effects/types";

interface ActiveEffectsStackProps {
  effects: Effect[];
  regions: Region[];
  overlays: Overlay[];
  activeRegionId: string | null;
  activeOverlayId: string | null;
  onUpdateEffect: (id: string, updates: Partial<Effect>) => void;
  onRemoveEffect: (id: string) => void;
  onReorderEffect: (id: string, newIndex: number) => void;
  onRemoveRegion: (id: string) => void;
  onSelectRegion: (id: string | null) => void;
  onSelectOverlay: (id: string | null) => void;
  onStartDrawingRegion: () => void;
  onUpdateOverlay: (id: string, updates: Partial<Overlay>) => void;
  onAddTextOverlay: () => void;
}

export function ActiveEffectsStack({
  effects,
  regions,
  overlays,
  activeRegionId,
  activeOverlayId,
  onUpdateEffect,
  onRemoveEffect,
  onReorderEffect,
  onRemoveRegion,
  onSelectRegion,
  onSelectOverlay,
  onStartDrawingRegion,
  onUpdateOverlay,
  onAddTextOverlay,
}: ActiveEffectsStackProps) {
  const [expandedEffects, setExpandedEffects] = useState<Record<string, boolean>>({});

  const globalEffects = effects.filter((e) => !e.regionId && !e.overlayId);

  const regionEffectsMap = new Map<string, Effect[]>();
  const overlayEffectsMap = new Map<string, Effect[]>();
  effects.forEach((effect) => {
    if (effect.regionId) {
      if (!regionEffectsMap.has(effect.regionId)) regionEffectsMap.set(effect.regionId, []);
      regionEffectsMap.get(effect.regionId)!.push(effect);
    } else if (effect.overlayId) {
      if (!overlayEffectsMap.has(effect.overlayId)) overlayEffectsMap.set(effect.overlayId, []);
      overlayEffectsMap.get(effect.overlayId)!.push(effect);
    }
  });

  const toggleEffect = (effectId: string) => {
    setExpandedEffects((prev) => ({ ...prev, [effectId]: !prev[effectId] }));
  };

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
            if (cardElement) e.dataTransfer.setDragImage(cardElement, 20, 20);
          }}
        >
          <GripVertical size={14} />
        </button>
        <input
          type="checkbox"
          checked={effect.active}
          onChange={(e) => onUpdateEffect(effect.id, { active: e.target.checked })}
        />
        <button className={styles.expandButton} onClick={() => toggleEffect(effect.id)}>
          {expandedEffects[effect.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
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

  const activeOverlay = overlays.find((o) => o.id === activeOverlayId);

  return (
    <div className={styles.activeEffects}>
      <div className={styles.activeHeader}>
        <h4>Active</h4>
        <span className={styles.count}>{effects.filter((e) => e.active).length}</span>
      </div>

      <div className={styles.actionButtons}>
        <button className={styles.actionButton} onClick={onAddTextOverlay}>
          <Type size={13} />
          <span>Add Text</span>
        </button>
        <button className={styles.actionButton} onClick={onStartDrawingRegion}>
          <Square size={13} />
          <span>Draw Region</span>
        </button>
      </div>

      {activeOverlay && (
        <OverlayProperties overlay={activeOverlay} onUpdateOverlay={onUpdateOverlay} />
      )}

      <div className={styles.effectStack}>
        <div
          className={`${styles.regionGroup} ${activeRegionId === null && activeOverlayId === null ? styles.active : ""}`}
          onClick={() => onSelectRegion(null)}
        >
          <div className={styles.regionHeader}>
            <span>Global</span>
            <span className={styles.count}>{globalEffects.length}</span>
          </div>
          {globalEffects.map((effect, index) => renderEffectCard(effect, index))}
          {globalEffects.length === 0 && activeRegionId === null && activeOverlayId === null && (
            <p className={styles.zoneHint}>Add effects from above — they will apply to the whole frame.</p>
          )}
        </div>

        {regions.map((region) => {
          const regionEffects = regionEffectsMap.get(region.id) || [];
          return (
            <div
              key={region.id}
              className={`${styles.regionGroup} ${activeRegionId === region.id ? styles.active : ""}`}
              onClick={() => onSelectRegion(region.id)}
            >
              <div className={styles.regionHeader}>
                <div className={styles.regionHeaderLeft}>
                  <div className={styles.colorDot} style={{ backgroundColor: region.color }} />
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

        {overlays
          .filter((o) => {
            const hasEffects = (overlayEffectsMap.get(o.id)?.length ?? 0) > 0;
            return o.isEffectZone || activeOverlayId === o.id || hasEffects;
          })
          .map((overlay) => {
            const overlayEffects = overlayEffectsMap.get(overlay.id) || [];
            if (overlayEffects.length === 0 && activeOverlayId !== overlay.id) return null;
            const isActive = activeOverlayId === overlay.id;
            const label = overlay.isEffectZone ? `[Zone] ${overlay.name}` : overlay.name;
            return (
              <div
                key={overlay.id}
                className={`${styles.regionGroup} ${isActive ? styles.active : ""}`}
                onClick={() => onSelectOverlay(isActive ? null : overlay.id)}
              >
                <div className={styles.regionHeader}>
                  <div className={styles.regionHeaderLeft}>
                    <div
                      className={styles.colorDot}
                      style={{ backgroundColor: overlay.color || "#ccc" }}
                    />
                    <span>{label}</span>
                  </div>
                  <div className={styles.regionHeaderRight}>
                    <span className={styles.count}>{overlayEffects.length}</span>
                  </div>
                </div>
                {overlayEffects.length === 0 && isActive && (
                  <p className={styles.zoneHint}>
                    {overlay.isEffectZone
                      ? "Add effects from the panel above — they will be applied to the video showing through this overlay."
                      : "Add effects from the panel above — they will be masked to this overlay's bounds."}
                  </p>
                )}
                {overlayEffects.map((effect, index) => renderEffectCard(effect, index))}
              </div>
            );
          })}
      </div>
    </div>
  );
}
