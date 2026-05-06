import { EffectsCatalog } from "./EffectsCatalog";
import { ActiveEffectsStack } from "./ActiveEffectsStack";
import styles from "./EffectsPanel.module.scss";
import type { Effect, EffectType, Region, Overlay } from "../../lib/effects/types";

interface EffectsPanelProps {
  effects: Effect[];
  regions: Region[];
  overlays: Overlay[];
  activeRegionId: string | null;
  activeOverlayId: string | null;
  onAddEffect: (type: EffectType, regionId?: string, overlayId?: string) => void;
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

function EffectsPanel({
  effects,
  regions,
  overlays,
  activeRegionId,
  activeOverlayId,
  onAddEffect,
  onUpdateEffect,
  onRemoveEffect,
  onReorderEffect,
  onRemoveRegion,
  onSelectRegion,
  onSelectOverlay,
  onStartDrawingRegion,
  onUpdateOverlay,
  onAddTextOverlay,
}: EffectsPanelProps) {
  return (
    <aside className={styles.effectsPanel}>
      <div className={styles.header}>
        <h3>Effects</h3>
      </div>

      <div className={styles.scrollContent}>
        <EffectsCatalog
          activeRegionId={activeRegionId}
          activeOverlayId={activeOverlayId}
          onAddEffect={onAddEffect}
        />
        <ActiveEffectsStack
          effects={effects}
          regions={regions}
          overlays={overlays}
          activeRegionId={activeRegionId}
          activeOverlayId={activeOverlayId}
          onUpdateEffect={onUpdateEffect}
          onRemoveEffect={onRemoveEffect}
          onReorderEffect={onReorderEffect}
          onRemoveRegion={onRemoveRegion}
          onSelectRegion={onSelectRegion}
          onSelectOverlay={onSelectOverlay}
          onStartDrawingRegion={onStartDrawingRegion}
          onUpdateOverlay={onUpdateOverlay}
          onAddTextOverlay={onAddTextOverlay}
        />
      </div>
    </aside>
  );
}

export default EffectsPanel;
