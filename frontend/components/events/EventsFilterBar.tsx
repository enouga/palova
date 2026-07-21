'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { FacetChip, FacetGroup, FILTER_TINTS } from '@/components/ui/FacetChip';
import {
  AgendaFilter, AgendaCounts, EventFilterState,
  GENDER_LABEL, KIND_LABEL, WHEN_LABEL, WHEN_ORDER, agendaFacets,
} from '@/lib/events';

// Barre de filtres de la page Events — même langage graphique que /parties
// (MatchesFilterBar) : un seul panneau bordé, groupes labellisés en petites
// capitales, chips plates (encre pleine + coche si actif, contour fin sinon).
// La source (Tout/Compétitions/Animations/Cours) est un groupe de facette
// comme les autres, plus un onglet à part avec tuiles d'icônes colorées.

type Facets = ReturnType<typeof agendaFacets>;

const SOURCES: { key: AgendaFilter; label: string }[] = [
  { key: 'tout', label: 'Tout' },
  { key: 'competitions', label: 'Compétitions' },
  { key: 'animations', label: 'Animations' },
  { key: 'cours', label: 'Cours' },
];

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
    <div style={{ marginTop: 14 }}>
      <div style={{ borderRadius: 16, background: th.bgElev, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 26px', padding: '12px 14px' }}>
          <FacetGroup label="Source" tint={FILTER_TINTS.source}>
            {SOURCES.map((s) => (
              <FacetChip key={s.key} label={s.label} count={counts.sources[s.key]} active={state.source === s.key}
                tint={FILTER_TINTS.source} onClick={() => setSource(s.key)} />
            ))}
          </FacetGroup>
          {/* Rejoué (sp-rise) au changement de source : les facettes qui suivent en dépendent */}
          <div key={state.source} style={{ display: 'contents' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 26px', animation: 'sp-rise .22s ease both' }}>
              <FacetGroup label="Quand" tint={FILTER_TINTS.quand}>
                {WHEN_ORDER.map((w) => (
                  <FacetChip key={w} label={WHEN_LABEL[w]} count={counts.when[w]} active={state.when === w}
                    tint={FILTER_TINTS.quand} onClick={() => onChange({ ...state, when: state.when === w ? null : w })} />
                ))}
              </FacetGroup>
              {showCategories && (
                <FacetGroup label="Catégorie" tint={FILTER_TINTS.categorie}>
                  {counts.categories.map(({ value, count }) => (
                    <FacetChip key={value} label={value} count={count} active={state.categories.has(value)}
                      tint={FILTER_TINTS.categorie} onClick={() => onChange({ ...state, categories: toggled(state.categories, value) })} />
                  ))}
                </FacetGroup>
              )}
              {showGenders && (
                <FacetGroup label="Genre" tint={FILTER_TINTS.genre}>
                  {counts.genders.map(({ value, count }) => (
                    <FacetChip key={value} label={GENDER_LABEL[value]} count={count} active={state.genders.has(value)}
                      tint={FILTER_TINTS.genre} onClick={() => onChange({ ...state, genders: toggled(state.genders, value) })} />
                  ))}
                </FacetGroup>
              )}
              {showKinds && (
                <FacetGroup label="Type" tint={FILTER_TINTS.typeAnimation}>
                  {counts.kinds.map(({ value, count }) => (
                    <FacetChip key={value} label={KIND_LABEL[value]} count={count} active={state.kinds.has(value)}
                      tint={FILTER_TINTS.typeAnimation} onClick={() => onChange({ ...state, kinds: toggled(state.kinds, value) })} />
                  ))}
                </FacetGroup>
              )}
              {showMemberOnly && (
                <FacetGroup label="Accès" tint={FILTER_TINTS.acces}>
                  <FacetChip label="Réservé membres" count={counts.memberOnly} active={state.memberOnly}
                    tint={FILTER_TINTS.acces} onClick={() => onChange({ ...state, memberOnly: !state.memberOnly })} />
                </FacetGroup>
              )}
            </div>
          </div>
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
