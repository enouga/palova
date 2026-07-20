'use client';
import { useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { Pill } from '@/components/ui/atoms';
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

// Le compte est visuellement distinct du libellé (sinon « Paris 2 » se lit comme un seul mot).
function facetLabel(label: string, count: number): React.ReactNode {
  return (
    <>
      {label}
      <span aria-hidden style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, opacity: 0.55, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
    </>
  );
}

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
}

export function FacetPanel({ facets, state, onToggleDept, onToggleCategory, onToggleGender, onSetPreset, onSetRange, onToggleNearMe, onClear, nearMeBusy }: FacetPanelProps) {
  const { th } = useTheme();
  const [showAllDepts, setShowAllDepts] = useState(false);

  // « Autour de moi » est un tri, pas un filtre (et onClear le préserve) → exclu de hasActive.
  const hasActive = state.deptCodes.size > 0 || state.categories.size > 0 || state.genders.size > 0 || state.datePreset != null || !!state.from || !!state.to;
  const depts = showAllDepts ? facets.departments : facets.departments.slice(0, DEPT_VISIBLE);

  const Group = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 7 }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>{children}</div>
    </div>
  );

  return (
    <div style={{ padding: '4px 20px 0' }}>
      {/* Autour de moi */}
      <button
        onClick={onToggleNearMe}
        aria-pressed={state.nearMe}
        aria-label={nearMeBusy ? 'Localisation…' : state.nearMe ? 'Autour de moi ✓' : 'Autour de moi'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', border: 'none',
          borderRadius: 999, padding: '9px 15px', fontFamily: th.fontUI, fontSize: 14, fontWeight: 700,
          background: state.nearMe ? th.accent : th.surface, color: state.nearMe ? th.ink : th.text,
          boxShadow: `inset 0 0 0 1px ${th.line}`,
        }}
      >
        📍 {nearMeBusy ? 'Localisation…' : state.nearMe ? 'Autour de moi ✓' : 'Autour de moi'}
      </button>

      {/* Quand */}
      <Group label="Quand">
        {PRESETS.map((p) => (
          <Pill key={p.key} size="sm" activeBg={th.text} label={p.label} active={state.datePreset === p.key && !state.from && !state.to}
            onClick={() => onSetPreset(state.datePreset === p.key ? null : p.key)} />
        ))}
        <DateRangeChip from={state.from} to={state.to} onChange={onSetRange} />
      </Group>

      {/* Département */}
      {facets.departments.length > 0 && (
        <Group label="Département">
          {depts.map((d) => (
            <Pill key={d.code} size="sm" activeBg={th.text} label={facetLabel(d.name, d.count)} active={state.deptCodes.has(d.code)} onClick={() => onToggleDept(d.code)} />
          ))}
          {facets.departments.length > DEPT_VISIBLE && (
            <button onClick={() => setShowAllDepts((v) => !v)} style={linkBtn(th)}>
              {showAllDepts ? 'voir moins' : `+ ${facets.departments.length - DEPT_VISIBLE}`}
            </button>
          )}
        </Group>
      )}

      {/* Catégorie */}
      {facets.categories.length > 0 && (
        <Group label="Catégorie">
          {facets.categories.map((c) => (
            <Pill key={c.value} size="sm" activeBg={th.text} label={facetLabel(c.value, c.count)} active={state.categories.has(c.value)} onClick={() => onToggleCategory(c.value)} />
          ))}
        </Group>
      )}

      {/* Genre */}
      {facets.genders.length > 0 && (
        <Group label="Genre">
          {facets.genders.map((g) => (
            <Pill key={g.value} size="sm" activeBg={th.text} label={facetLabel(GENDER_LABEL[g.value], g.count)} active={state.genders.has(g.value)} onClick={() => onToggleGender(g.value)} />
          ))}
        </Group>
      )}

      {hasActive && (
        <button onClick={onClear} style={{ ...linkBtn(th), marginTop: 12, display: 'block' }}>Effacer</button>
      )}
    </div>
  );
}

function linkBtn(th: ReturnType<typeof useTheme>['th']): React.CSSProperties {
  return { border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textFaint, padding: '5px 8px' };
}
