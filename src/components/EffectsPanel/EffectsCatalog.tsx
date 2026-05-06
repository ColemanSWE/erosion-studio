import { useState } from "react";
import { Plus, ChevronDown, ChevronRight, Search } from "lucide-react";
import type { EffectType } from "../../lib/effects/types";
import { isStyleEffect, getAllEffects } from "../../lib/effects/effect-registry";
import { formatEffectName } from "./effectsPanelUtils";
import styles from "./EffectsPanel.module.scss";

interface EffectsCatalogProps {
  activeRegionId: string | null;
  activeOverlayId: string | null;
  onAddEffect: (type: EffectType, regionId?: string, overlayId?: string) => void;
}

export function EffectsCatalog({ activeRegionId, activeOverlayId, onAddEffect }: EffectsCatalogProps) {
  const allDefs = getAllEffects();
  const EFFECT_CATEGORIES = allDefs.reduce(
    (acc, def) => {
      if (!acc[def.category]) acc[def.category] = [];
      acc[def.category].push(def.type);
      return acc;
    },
    {} as Record<string, string[]>,
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  const isStyleEffectDisabled = activeRegionId !== null || activeOverlayId !== null;

  const handleAddEffect = (type: EffectType) => {
    onAddEffect(type, activeRegionId || undefined, activeOverlayId || undefined);
  };

  return (
    <>
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
        {Object.entries(EFFECT_CATEGORIES).map(([category, effectTypes]) => {
          const filteredEffects = effectTypes.filter((type) =>
            formatEffectName(type).toLowerCase().includes(searchQuery.toLowerCase()),
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
                  {filteredEffects.map((type) => {
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
          );
        })}
      </div>
    </>
  );
}
