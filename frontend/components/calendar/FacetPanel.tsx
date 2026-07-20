'use client';
import { useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { DateRangeChip } from '@/components/calendar/DateRangeChip';
import { CalendarFilterState, DatePreset, calendarFacets } from '@/lib/tournamentCalendar';
import { TournamentGender } from '@/lib/api';

const GENDER_LABEL: Record<string, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };
const PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'weekend', label: 'Ce week-end' },
  { key: 'thisMonth', label: 'Ce mois-ci' },
  { key: 'days30', label: '30 jours' },
  { key: 'months3', label: '3 mois' },
];
const DEPT_VISIBLE = 8; // nombre de départements montrés avant « + tous »

type Th = ReturnType<typeof useTheme>['th'];

export interface FacetPanelProps {
  facets: ReturnType<typeof calendarFacets>;
  state: CalendarFilterState;
  onToggleDept: (code: string) => void;
  onToggleCategory: (c: string) => void;
  onToggleGender: (g: TournamentGender) => void;
  onSetPreset: (p: DatePreset | null) => void;
  onSetRange: (from: string | null, to: string | null) => void;
  onToggleNearMe: () => void;
  onClear: () => void;
  nearMeBusy?: boolean;
  /** Nombre de résultats affichés (pied du tiroir) — fourni par la page hôte. */
  resultCount?: number | null;
}

// Panneau de filtres des tournois (partagé /decouvrir + /tournois) : UN tiroir compact au
// langage d'EventsFilterBar — groupes labellisés côte à côte (flex-wrap), chips ✓/compteurs,
// pied « N résultats · Effacer les filtres ». Les briques FacetChip/FacetGroup sont des copies
// LOCALES de celles d'Events (APIs différentes, et pas d'import croisé events↔calendar — même
// précédent que whenWindow) ; toujours module-scope, jamais définies dans le rendu (leçon du
// bug Group : un composant défini dans un autre est remonté à chaque rendu).
export function FacetPanel({ facets, state, onToggleDept, onToggleCategory, onToggleGender, onSetPreset, onSetRange, onToggleNearMe, onClear, nearMeBusy, resultCount }: FacetPanelProps) {
  const { th } = useTheme();
  const [showAllDepts, setShowAllDepts] = useState(false);

  // « Autour de moi » est un tri, pas un filtre (et onClear le préserve) → exclu de hasActive.
  const hasActive = state.deptCodes.size > 0 || state.categories.size > 0 || state.genders.size > 0 || state.datePreset != null || !!state.from || !!state.to;
  const depts = showAllDepts ? facets.departments : facets.departments.slice(0, DEPT_VISIBLE);

  return (
    <div style={{ padding: '4px 20px 0' }}>
      <div style={{ borderRadius: 16, background: th.bgElev, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 26px', padding: '12px 14px' }}>
          <FacetGroup th={th} label="Quand">
            {PRESETS.map((p) => (
              <FacetChip key={p.key} th={th} label={p.label} active={state.datePreset === p.key && !state.from && !state.to}
                onClick={() => onSetPreset(state.datePreset === p.key ? null : p.key)} />
            ))}
            <DateRangeChip from={state.from} to={state.to} onChange={onSetRange} />
          </FacetGroup>

          <FacetGroup th={th} label="Où">
            {/* Autour de moi = un TRI (accent, pas encre) — même sujet que les départements. */}
            <button onClick={onToggleNearMe} aria-pressed={state.nearMe}
              aria-label={nearMeBusy ? 'Localisation…' : state.nearMe ? 'Autour de moi ✓' : 'Autour de moi'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', cursor: 'pointer',
                borderRadius: 999, padding: '5px 11px', fontFamily: th.fontUI, fontSize: 13,
                fontWeight: state.nearMe ? 700 : 600,
                background: state.nearMe ? th.accent : th.surface,
                color: state.nearMe ? th.onAccent : th.text,
                boxShadow: state.nearMe ? 'none' : `inset 0 0 0 1px ${th.line}`,
                WebkitTapHighlightColor: 'transparent',
              }}>
              📍 {nearMeBusy ? 'Localisation…' : state.nearMe ? 'Autour de moi ✓' : 'Autour de moi'}
            </button>
            {depts.map((d) => (
              <FacetChip key={d.code} th={th} label={d.name} count={d.count} active={state.deptCodes.has(d.code)} onClick={() => onToggleDept(d.code)} />
            ))}
            {facets.departments.length > DEPT_VISIBLE && (
              <button onClick={() => setShowAllDepts((v) => !v)} style={linkBtn(th)}>
                {showAllDepts ? 'voir moins' : `+ ${facets.departments.length - DEPT_VISIBLE}`}
              </button>
            )}
          </FacetGroup>

          {facets.categories.length > 0 && (
            <FacetGroup th={th} label="Catégorie">
              {facets.categories.map((c) => (
                <FacetChip key={c.value} th={th} label={c.value} count={c.count} active={state.categories.has(c.value)} onClick={() => onToggleCategory(c.value)} />
              ))}
            </FacetGroup>
          )}

          {facets.genders.length > 0 && (
            <FacetGroup th={th} label="Genre">
              {facets.genders.map((g) => (
                <FacetChip key={g.value} th={th} label={GENDER_LABEL[g.value]} count={g.count} active={state.genders.has(g.value)} onClick={() => onToggleGender(g.value)} />
              ))}
            </FacetGroup>
          )}
        </div>

        {hasActive && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderTop: `1px solid ${th.line}` }}>
            <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.text }}>
              {resultCount != null && `${resultCount} résultat${resultCount > 1 ? 's' : ''}`}
            </span>
            <span style={{ flex: 1 }} />
            <button onClick={onClear} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', cursor: 'pointer',
              borderRadius: 999, padding: '4px 11px', background: 'transparent',
              boxShadow: `inset 0 0 0 1px ${th.lineStrong}`,
              fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute,
            }}>
              <Icon name="x" size={12} color={th.textMute} />Effacer les filtres
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Chip de facette (copie locale du FacetChip d'Events) : ✓ + encre pleine quand active,
// compteur en suffixe `aria-hidden` (le nom accessible reste « Paris », pas « Paris 2 » —
// contrat des tests), estompée mais cliquable à 0.
function FacetChip({ th, label, count, active, onClick }: {
  th: Th; label: string; count?: number; active: boolean; onClick: () => void;
}) {
  const fg = active ? (th.mode === 'floodlit' ? th.text : '#f7f5ee') : th.text;
  return (
    <button onClick={onClick} aria-pressed={active} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      border: 'none', cursor: 'pointer', borderRadius: 999, padding: '5px 11px',
      fontFamily: th.fontUI, fontSize: 13, fontWeight: active ? 700 : 600,
      background: active ? th.ink : th.surface, color: fg,
      boxShadow: active ? 'none' : `inset 0 0 0 1px ${th.line}`,
      opacity: !active && count === 0 ? 0.45 : 1,
      WebkitTapHighlightColor: 'transparent',
    }}>
      {active && <Icon name="check" size={12} color={fg} />}
      {label}
      {count != null && (
        <span aria-hidden style={{ fontSize: 11.5, fontWeight: 700, color: active ? fg : th.textFaint, opacity: active ? 0.75 : 1, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
      )}
    </button>
  );
}

function FacetGroup({ th, label, children }: { th: Th; label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <span style={{
        fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6,
        textTransform: 'uppercase', color: th.textFaint,
      }}>{label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>{children}</div>
    </div>
  );
}

function linkBtn(th: Th): React.CSSProperties {
  return { border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textFaint, padding: '5px 8px' };
}
