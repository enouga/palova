'use client';
import { useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import type { MatchAlert } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { LevelRangeSlider } from '@/components/player/LevelRangeSlider';
import { fmtLevel } from '@/lib/levelMatch';
import { alertChipLabel } from '@/lib/matchAlerts';

export type KindFilter = 'all' | 'competitive' | 'friendly';

const LEVEL_MIN = 1;
const LEVEL_MAX = 8;

// Chip de filtre — actif = encre pleine + coche, inactif = pill fine contourée
// (même langage que FacetChip d'EventsFilterBar).
function Chip({ label, active, onClick, ariaExpanded }: {
  label: string; active: boolean; onClick: () => void; ariaExpanded?: boolean;
}) {
  const { th } = useTheme();
  const fg = active ? (th.mode === 'floodlit' ? th.text : '#f7f5ee') : th.textMute;
  return (
    <button type="button" aria-pressed={active} aria-expanded={ariaExpanded} onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      border: 'none', cursor: 'pointer', borderRadius: 999, padding: '5px 11px',
      fontFamily: th.fontUI, fontSize: 12, fontWeight: active ? 700 : 600,
      background: active ? th.ink : 'transparent', color: fg,
      boxShadow: active ? 'none' : `inset 0 0 0 1px ${th.line}`,
      transition: 'all .15s', WebkitTapHighlightColor: 'transparent',
    }}>
      {active && <Icon name="check" size={11} color={fg} />}
      {label}
    </button>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  const { th } = useTheme();
  return (
    <span style={{
      fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6,
      textTransform: 'uppercase', color: th.textFaint,
    }}>{children}</span>
  );
}

export interface MatchesFilterBarProps {
  levelEnabled: boolean;
  authenticated: boolean;
  myLevel: number | null;
  myLevelMin: number | null;
  myLevelMax: number | null;
  fMin: number;
  fMax: number;
  onLevelChange: (min: number, max: number) => void;
  kindFilter: KindFilter;
  onKindChange: (k: KindFilter) => void;
  resultCount: number;
  alerts: MatchAlert[];
  timezone: string;
  onDeleteAlert: (id: string) => void;
  onCreateAlert: () => void;
}

// Tiroir de filtres de /parties — même langage que la barre Events (EventsFilterBar) :
// groupes labellisés, chips encre pleine, pied avec compteur + alertes.
export function MatchesFilterBar({
  levelEnabled, authenticated, myLevel, myLevelMin, myLevelMax, fMin, fMax, onLevelChange,
  kindFilter, onKindChange, resultCount, alerts, timezone, onDeleteAlert, onCreateAlert,
}: MatchesFilterBarProps) {
  const { th } = useTheme();
  const [sliderOpen, setSliderOpen] = useState(false);

  const showLevelGroup = levelEnabled && authenticated;
  const isMyLevel = myLevel != null && myLevelMin != null && myLevelMax != null && fMin === myLevelMin && fMax === myLevelMax;
  const isDefaultAll = !isMyLevel && fMin === LEVEL_MIN && fMax === LEVEL_MAX;
  const isCustom = showLevelGroup && !isDefaultAll && !isMyLevel;
  const arrow = sliderOpen ? '▴' : '▾';
  const adjustLabel = isCustom ? `Niveau ${fmtLevel(fMin)}–${fmtLevel(fMax)} ${arrow}` : `Régler ${arrow}`;

  // Le pied s'affiche pour tout connecté (showFooter ci-dessous) ; ce flag ne sert
  // qu'à un anonyme, dont le seul filtre disponible est le type de partie.
  const hasActiveFilter = kindFilter !== 'all';
  const showFooter = authenticated || hasActiveFilter;

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ borderRadius: 16, background: th.bgElev, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 26px', padding: '12px 14px' }}>
          {showLevelGroup && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <GroupLabel>Niveau</GroupLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {myLevel != null && myLevelMin != null && myLevelMax != null && (
                  <Chip label={`À mon niveau · ${fmtLevel(myLevelMin)}–${fmtLevel(myLevelMax)}`}
                    active={isMyLevel} onClick={() => onLevelChange(myLevelMin, myLevelMax)} />
                )}
                <Chip label="Tous" active={isDefaultAll} onClick={() => onLevelChange(LEVEL_MIN, LEVEL_MAX)} />
                <Chip label={adjustLabel} active={isCustom} ariaExpanded={sliderOpen}
                  onClick={() => setSliderOpen((v) => !v)} />
              </div>
              {sliderOpen && (
                <div style={{ maxWidth: 430, marginTop: 4 }}>
                  <LevelRangeSlider compact min={fMin} max={fMax} onChange={onLevelChange} />
                </div>
              )}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <GroupLabel>Type de partie</GroupLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <Chip label="Toutes" active={kindFilter === 'all'} onClick={() => onKindChange('all')} />
              <Chip label="Pour de vrai" active={kindFilter === 'competitive'} onClick={() => onKindChange('competitive')} />
              <Chip label="Pour le fun" active={kindFilter === 'friendly'} onClick={() => onKindChange('friendly')} />
            </div>
          </div>
        </div>

        {showFooter && (
          <div data-testid="matches-filter-footer" style={{
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10,
            padding: '9px 14px', borderTop: `1px solid ${th.line}`,
          }}>
            <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.text }}>
              {resultCount} partie{resultCount > 1 ? 's' : ''}
            </span>
            {alerts.map((al) => (
              <span key={al.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, background: th.surface2,
                borderRadius: 999, padding: '6px 10px 6px 12px', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute,
              }}>
                {alertChipLabel(al, timezone)}
                <button aria-label="Supprimer l'alerte" onClick={() => onDeleteAlert(al.id)} style={{
                  border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontSize: 15, lineHeight: 1,
                }}>✕</button>
              </span>
            ))}
            <span style={{ flex: 1 }} />
            {authenticated && (
              <button onClick={onCreateAlert} style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.accent, whiteSpace: 'nowrap',
              }}>
                🔔 Créer une alerte
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
