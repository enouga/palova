'use client';
import { ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, inkOn } from '@/lib/theme';
import { Icon, IconName } from '@/components/ui/Icon';
import {
  AgendaFilter, AgendaCounts, EventFilterState,
  GENDER_LABEL, KIND_LABEL, WHEN_LABEL, WHEN_ORDER, agendaFacets,
} from '@/lib/events';

// Barre de filtres de la page Events. Chaque source porte l'icône et l'accent de ses
// cartes (trophy·apricot / bolt·violet / cours·bleu) — la barre enseigne le code couleur
// de la liste. Dessous, un tiroir de facettes groupées et labellisées, avec compteurs
// live (une facette ne se compte jamais elle-même) et « Quand » transverse aux sources.

type Facets = ReturnType<typeof agendaFacets>;

const SOURCES: { key: AgendaFilter; label: string; icon: IconName; accent: string | null }[] = [
  { key: 'tout', label: 'Tout', icon: 'grid', accent: null }, // null = encre du thème
  { key: 'competitions', label: 'Compétitions', icon: 'trophy', accent: ACCENTS.apricot },
  { key: 'animations', label: 'Animations', icon: 'bolt', accent: ACCENTS.violet },
  { key: 'cours', label: 'Cours', icon: 'user', accent: ACCENTS.blue },
];

function SourceTab({ label, icon, accent, count, active, onClick }: {
  label: string; icon: IconName; accent: string | null; count: number; active: boolean; onClick: () => void;
}) {
  const { th } = useTheme();
  const acc = accent ?? th.text;
  const fg = active ? inkOn(acc) : th.text;
  // Tuile icône : teintée de l'accent de la source même inactive (code couleur des cartes).
  const tileBg = active
    ? `${inkOn(acc)}24`
    : accent
      ? (th.mode === 'floodlit' ? `${accent}24` : `${accent}40`)
      : th.surface2;
  const tileFg = active ? inkOn(acc) : accent ? (th.mode === 'floodlit' ? accent : th.ink) : th.textMute;
  return (
    <button onClick={onClick} aria-pressed={active} style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0,
      border: 'none', cursor: 'pointer', borderRadius: 999, padding: '7px 14px 7px 8px',
      fontFamily: th.fontUI, fontSize: 14, fontWeight: active ? 700 : 600,
      background: active ? acc : th.surface, color: fg,
      boxShadow: active ? 'none' : `inset 0 0 0 1px ${th.line}`,
      transition: 'all .18s', WebkitTapHighlightColor: 'transparent',
    }}>
      <span aria-hidden="true" style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: tileBg,
        transition: 'background .18s',
      }}>
        <Icon name={icon} size={15} color={tileFg} />
      </span>
      {label}
      <span style={{
        fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, lineHeight: 1,
        borderRadius: 999, padding: '4px 7px', minWidth: 22, textAlign: 'center',
        background: active ? `${inkOn(acc)}24` : th.surface2,
        color: active ? inkOn(acc) : th.textMute, transition: 'all .18s',
      }}>{count}</span>
    </button>
  );
}

function FacetChip({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void;
}) {
  const { th } = useTheme();
  // Actif = encre pleine (recette du Btn « dark ») ; option à 0 estompée mais cliquable
  // (OU intra-dimension : l'ajouter n'enlève jamais de résultats).
  const fg = active ? (th.mode === 'floodlit' ? th.text : '#f7f5ee') : th.text;
  return (
    <button onClick={onClick} aria-pressed={active} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      border: 'none', cursor: 'pointer', borderRadius: 999, padding: '5px 11px',
      fontFamily: th.fontUI, fontSize: 13, fontWeight: active ? 700 : 600,
      background: active ? th.ink : th.surface, color: fg,
      boxShadow: active ? 'none' : `inset 0 0 0 1px ${th.line}`,
      opacity: !active && count === 0 ? 0.45 : 1,
      transition: 'all .15s', WebkitTapHighlightColor: 'transparent',
    }}>
      {active && <Icon name="check" size={12} color={fg} />}
      {label}
      <span style={{ fontSize: 11.5, fontWeight: 700, color: active ? fg : th.textFaint, opacity: active ? 0.75 : 1 }}>{count}</span>
    </button>
  );
}

function FacetGroup({ label, children }: { label: string; children: ReactNode }) {
  const { th } = useTheme();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <span style={{
        fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6,
        textTransform: 'uppercase', color: th.textFaint,
      }}>{label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{children}</div>
    </div>
  );
}

export function EventsFilterBar({ state, onChange, facets, counts, resultCount }: {
  state: EventFilterState;
  onChange: (next: EventFilterState) => void;
  facets: Facets;
  counts: AgendaCounts;
  resultCount: number | null;
}) {
  const { th } = useTheme();

  // Changer de source réinitialise les facettes de source ; « Quand » (transverse) persiste.
  const setSource = (s: AgendaFilter) =>
    onChange({ ...state, source: s, categories: new Set(), genders: new Set(), kinds: new Set(), memberOnly: false });
  const toggled = <T,>(set: Set<T>, v: T): Set<T> => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    return next;
  };
  const clearAll = () =>
    onChange({ ...state, categories: new Set(), genders: new Set(), kinds: new Set(), memberOnly: false, when: null });

  const showCategories = (state.source === 'tout' || state.source === 'competitions') && facets.categories.length > 0;
  const showGenders = state.source === 'competitions' && facets.genders.length > 0;
  const showKinds = (state.source === 'tout' || state.source === 'animations') && facets.kinds.length > 0;
  const showMemberOnly = state.source === 'animations' && facets.hasMemberOnly;
  const hasActive = state.when != null || state.categories.size > 0 || state.genders.size > 0 || state.kinds.size > 0 || state.memberOnly;

  return (
    <div>
      {/* Onglets sources — pleine largeur scrollable (mobile), identité couleur des cartes */}
      <div className="sp-scroll-x" style={{ display: 'flex', gap: 8, margin: '0 -20px', padding: '0 20px' }}>
        {SOURCES.map((s) => (
          <SourceTab key={s.key} label={s.label} icon={s.icon} accent={s.accent}
            count={counts.sources[s.key]} active={state.source === s.key} onClick={() => setSource(s.key)} />
        ))}
      </div>

      {/* Tiroir de facettes — rejoué (sp-rise) au changement de source */}
      <div key={state.source} style={{
        marginTop: 10, borderRadius: 16, background: th.bgElev,
        boxShadow: `inset 0 0 0 1px ${th.line}`, animation: 'sp-rise .22s ease both',
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 26px', padding: '12px 14px' }}>
          <FacetGroup label="Quand">
            {WHEN_ORDER.map((w) => (
              <FacetChip key={w} label={WHEN_LABEL[w]} count={counts.when[w]} active={state.when === w}
                onClick={() => onChange({ ...state, when: state.when === w ? null : w })} />
            ))}
          </FacetGroup>
          {showCategories && (
            <FacetGroup label="Catégorie">
              {counts.categories.map(({ value, count }) => (
                <FacetChip key={value} label={value} count={count} active={state.categories.has(value)}
                  onClick={() => onChange({ ...state, categories: toggled(state.categories, value) })} />
              ))}
            </FacetGroup>
          )}
          {showGenders && (
            <FacetGroup label="Genre">
              {counts.genders.map(({ value, count }) => (
                <FacetChip key={value} label={GENDER_LABEL[value]} count={count} active={state.genders.has(value)}
                  onClick={() => onChange({ ...state, genders: toggled(state.genders, value) })} />
              ))}
            </FacetGroup>
          )}
          {showKinds && (
            <FacetGroup label="Type">
              {counts.kinds.map(({ value, count }) => (
                <FacetChip key={value} label={KIND_LABEL[value]} count={count} active={state.kinds.has(value)}
                  onClick={() => onChange({ ...state, kinds: toggled(state.kinds, value) })} />
              ))}
            </FacetGroup>
          )}
          {showMemberOnly && (
            <FacetGroup label="Accès">
              <FacetChip label="Réservé membres" count={counts.memberOnly} active={state.memberOnly}
                onClick={() => onChange({ ...state, memberOnly: !state.memberOnly })} />
            </FacetGroup>
          )}
        </div>

        {hasActive && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderTop: `1px solid ${th.line}` }}>
            <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.text }}>
              {resultCount != null && `${resultCount} résultat${resultCount > 1 ? 's' : ''}`}
            </span>
            <span style={{ flex: 1 }} />
            <button onClick={clearAll} style={{
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
