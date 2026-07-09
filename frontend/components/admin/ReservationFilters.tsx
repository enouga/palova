'use client';
import { CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { DateField } from '@/components/ui/DateField';
import { SportPicker } from '@/components/reserve/SportPicker';
import { PeriodMode, StatusMode } from '@/lib/collect';

export interface SportFacet { key: string; name: string }
export interface MethodFacet { key: string; label: string }

const STATUS_LABELS: [StatusMode, string][] = [
  ['all', 'Tout'], ['unpaid', 'Non payé'], ['partial', 'Partiel'], ['paid', 'Soldé'], ['cancelled', 'Annulées'],
];

export interface ReservationFiltersProps {
  query: string; onQuery: (q: string) => void;
  date: string; onDate: (d: string) => void; onClearDate: () => void;
  /** Sports présents le jour donné ; le sélecteur n'est rendu que si length > 1. */
  sports: SportFacet[];
  selectedSports: Set<string>; onSports: (keys: string[]) => void;
  period: PeriodMode; onPeriod: (p: PeriodMode) => void;
  dueOnly: boolean; onDueOnly: (v: boolean) => void;
  /** Nombre de filtres non par défaut (pour « Réinitialiser »). */
  activeCount: number; onReset: () => void;
  /** Filtre par statut d'encaissement (page Paiements) — omis → groupe masqué. */
  status?: StatusMode; onStatus?: (s: StatusMode) => void;
  /** Filtre par moyen (page Paiements) : facettes présentes le jour + sélection multi.
   *  Omis / liste vide → groupe masqué. */
  methodFacets?: MethodFacet[]; selectedMethods?: Set<string>; onMethods?: (keys: string[]) => void;
}

/**
 * Barre de filtres de la page Encaissement, allégée : sport (multi, si >1),
 * « À venir / Tout le jour », « À encaisser », recherche et jour. Présentationnel :
 * tout l'état vit dans la page.
 */
export function ReservationFilters(p: ReservationFiltersProps) {
  const { th } = useTheme();

  const segBtn = (on: boolean): CSSProperties => ({
    padding: '6px 13px', border: 'none', background: on ? th.accent : 'transparent',
    color: on ? th.onAccent : th.text, cursor: 'pointer', fontFamily: th.fontUI,
    fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>

      {/* ── Ligne 1 : sports (si multi) + recherche ──────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {p.sports.length > 1 && (
          <SportPicker
            sports={p.sports.map((s) => ({ id: s.key, name: s.name }))}
            selectedIds={[...p.selectedSports]}
            onChange={p.onSports}
          />
        )}
        <input value={p.query} onChange={(e) => p.onQuery(e.target.value)} placeholder="🔍 Rechercher un client…"
          style={{ flex: '0 1 220px', minWidth: 140, border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 9, padding: '7px 11px', fontFamily: th.fontUI, fontSize: 13.5 }} />
      </div>

      {/* ── Ligne 2 : à venir | tout · à encaisser · jour · réinitialiser ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div role="radiogroup" aria-label="Période" style={{ display: 'inline-flex', border: `1px solid ${th.line}`, borderRadius: 999, overflow: 'hidden', background: th.surface }}>
          {(([['next', 'Prochain créneau'], ['upcoming', 'À venir'], ['all', 'Tout le jour']]) as [PeriodMode, string][]).map(([mode, label], i) => (
            <button key={mode} type="button" role="radio" aria-checked={p.period === mode} onClick={() => p.onPeriod(mode)}
              style={i === 0 ? segBtn(p.period === mode) : { ...segBtn(p.period === mode), borderLeft: `1px solid ${th.line}` }}>
              {label}
            </button>
          ))}
        </div>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, color: th.text }}>
          <input type="checkbox" checked={p.dueOnly} onChange={(e) => p.onDueOnly(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: th.accent, cursor: 'pointer' }} />
          À encaisser
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
          Jour <DateField value={p.date} onChange={p.onDate} size="sm" />
        </label>
        {p.date && <button type="button" onClick={p.onClearDate} style={{ border: 'none', background: 'none', cursor: 'pointer', color: th.accent, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, padding: 0 }}>Tout afficher</button>}

        {p.activeCount > 0 && (
          <button type="button" onClick={p.onReset}
            style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: th.accent, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
            ⟲ Réinitialiser ({p.activeCount})
          </button>
        )}
      </div>

      {/* ── Ligne 3 (page Paiements) : statut d'encaissement ─────────────────── */}
      {p.status !== undefined && p.onStatus && (
        <div role="radiogroup" aria-label="Statut" style={{ display: 'inline-flex', flexWrap: 'wrap', border: `1px solid ${th.line}`, borderRadius: 999, overflow: 'hidden', background: th.surface, alignSelf: 'flex-start' }}>
          {STATUS_LABELS.map(([mode, label], i) => (
            <button key={mode} type="button" role="radio" aria-checked={p.status === mode} onClick={() => p.onStatus!(mode)}
              style={i === 0 ? segBtn(p.status === mode) : { ...segBtn(p.status === mode), borderLeft: `1px solid ${th.line}` }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── Ligne 4 (page Paiements) : moyens présents le jour (chips multi) ──── */}
      {p.methodFacets && p.methodFacets.length > 0 && p.onMethods && (
        <div role="group" aria-label="Moyens" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute }}>Moyen</span>
          {p.methodFacets.map((m) => {
            const on = p.selectedMethods?.has(m.key) ?? false;
            const next = () => {
              const cur = new Set(p.selectedMethods ?? []);
              on ? cur.delete(m.key) : cur.add(m.key);
              p.onMethods!([...cur]);
            };
            return (
              <button key={m.key} type="button" aria-pressed={on} onClick={next}
                style={{ padding: '5px 12px', borderRadius: 999, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap',
                  border: `1px solid ${on ? th.accent : th.line}`, background: on ? th.accent : 'transparent', color: on ? th.onAccent : th.text }}>
                {m.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
