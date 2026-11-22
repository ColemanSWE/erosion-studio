import { useMemo, useState } from "react";
import { Plus, ChevronDown, ChevronRight, Search } from "lucide-react";
import type { EffectType } from "../../lib/effects/types";
import type { Overlay, Region } from "../../lib/effects/types";
import { isStyleEffect, getAllEffects, type EffectDefinition } from "../../lib/effects/effect-registry";
import { useUIStore } from "../../stores/uiStore";
import styles from "./EffectsPanel.module.scss";

const CATEGORY_ORDER: EffectDefinition["category"][] = [
  "standard", "color", "glitch", "distortion", "retro", "noise", "style", "face",
];

interface EffectsCatalogProps {
  activeRegionId: string | null;
  activeOverlayId: string | null;
  regions: Region[];
  overlays: Overlay[];
  onAddEffect: (type: EffectType, regionId?: string, overlayId?: string) => void;
}

export function EffectsCatalog({ activeRegionId, activeOverlayId, regions, overlays, onAddEffect }: EffectsCatalogProps) {
  const showExperimental = useUIStore((s) => s.showExperimentalEffects);
  const setShowExperimental = useUIStore((s) => s.setShowExperimentalEffects);
  const experimentalCount = useMemo(() => getAllEffects().filter((d) => d.experimental).length, []);

  const categories = useMemo(() => {
    const byCategory = new Map<string, EffectDefinition[]>();
    for (const def of getAllEffects()) {
      if (def.experimental && !showExperimental) continue;
      if (!byCategory.has(def.category)) byCategory.set(def.category, []);
      byCategory.get(def.category)!.push(def);
    }
    for (const defs of byCategory.values()) defs.sort((a, b) => a.label.localeCompare(b.label));
    return [...byCategory.entries()].sort(
      ([a], [b]) => CATEGORY_ORDER.indexOf(a as EffectDefinition["category"]) - CATEGORY_ORDER.indexOf(b as EffectDefinition["category"]),
    );
  }, [showExperimental]);

  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  const activeOverlay = overlays.find((o) => o.id === activeOverlayId);
  const isEffectZoneSelected = activeOverlay?.isEffectZone ?? false;
  const isOverlayEffectsDisabled = activeOverlayId !== null && !isEffectZoneSelected;
  const isStyleEffectDisabled = activeRegionId !== null || activeOverlayId !== null;

  const handleAddEffect = (type: EffectType) => {
    onAddEffect(type, activeRegionId || undefined, activeOverlayId || undefined);
  };

  const targetLabel = (() => {
    if (activeOverlayId) {
      const overlay = overlays.find((o) => o.id === activeOverlayId);
      return overlay?.name ?? "Overlay";
    }
    if (activeRegionId) {
      const region = regions.find((r) => r.id === activeRegionId);
      return region?.name ?? "Region";
    }
    return "Global";
  })();

  return (
    <>
      <div className={styles.applyingTo}>
        <span className={styles.applyingToLabel}>Applying to</span>
        <span className={styles.applyingToTarget}>{targetLabel}</span>
      </div>

      <div className={styles.searchContainer}>
        <Search size={14} className={styles.searchIcon} />
        <input
          type="text"
          placeholder="Search effects..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className={styles.searchInput}
        />
      </div>

      <div className={styles.categories}>
        {categories.map(([category, defs]) => {
          const query = searchQuery.trim().toLowerCase();
          const filteredEffects = defs.filter(
            (def) => !query || def.label.toLowerCase().includes(query) || def.type.includes(query),
          );

          if (filteredEffects.length === 0) return null;

          return (
            <div key={category} className={styles.category}>
              <button
                className={styles.categoryHeader}
                onClick={() =>
                  setExpandedCategories((prev) => ({ ...prev, [category]: !prev[category] }))
                }
              >
                {expandedCategories[category] || searchQuery ? (
                  <ChevronDown size={16} />
                ) : (
                  <ChevronRight size={16} />
                )}
                <span>{category.charAt(0).toUpperCase() + category.slice(1)}</span>
                <span className={styles.count}>{filteredEffects.length}</span>
              </button>

              {(expandedCategories[category] || searchQuery) && (
                <div className={styles.effectList}>
                  {filteredEffects.map((def) => {
                    const isStyle = isStyleEffect(def.type);
                    const disabled = isOverlayEffectsDisabled || (isStyleEffectDisabled && isStyle);
                    const title = isOverlayEffectsDisabled
                      ? "Enable Effect Zone on this overlay to apply effects to the video behind it"
                      : isStyle && isStyleEffectDisabled
                        ? "Style effects can only be applied globally"
                        : undefined;
                    return (
                      <button
                        key={def.type}
                        className={styles.effectButton}
                        onClick={() => handleAddEffect(def.type)}
                        disabled={disabled}
                        title={title}
                      >
                        <Plus size={14} />
                        <span>{def.label}</span>
                        {def.experimental && <span className={styles.experimentalBadge}>beta</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {experimentalCount > 0 && (
        <label className={styles.experimentalToggle}>
          <input
            type="checkbox"
            checked={showExperimental}
            onChange={(e) => setShowExperimental(e.target.checked)}
          />
          <span>Show experimental effects ({experimentalCount})</span>
        </label>
      )}
    </>
  );
}
