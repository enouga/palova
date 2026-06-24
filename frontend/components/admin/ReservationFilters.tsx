'use client';
import { CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { DateField } from '@/components/ui/DateField';
import { Icon } from '@/components/ui/Icon';
import { StatusMode, TimePreset } from '@/lib/collect';
import { PaymentMethod } from '@/lib/api';

const CORAL = '#ff7a4d';
const SETTLED = '#34b888';

export interface CourtFacet { id: string; name: string; dueCount: number }

const STATUS_OPTS: { mode: StatusMode; label: string }[] = [
  { mode: 'all', label: 'Tout' },
  { mode: 'unpaid', label: 'Non payé' },
  { mode: 'partial', label: 'Partiel' },
  { mode: 'paid', label: 'Soldé' },
  { mode: 'cancelled', label: 'Annulées' },
];

const PRESET_OPTS: { key: TimePreset; label: string }[] = [
  { key: 'now', label: 'Maintenant' },
  { key: 'morning', label: 'Matin' },
  { key: 'afternoon', label: 'Après-midi' },
  { key: 'evening', label: 'Soir' },
];

const METHOD_LABEL: Record<string, string> = {
  CARD: 'CB', CASH: 'Espèces', VOUCHER: 'Ticket CE', TRANSFER: 'Virement', MEMBER: 'Abo',
  WALLET: 'Porte-monnaie', PACK_CREDIT: 'Carnet', ONLINE: 'En ligne', SUBSCRIPTION: 'Abonnement', OTHER: 'Autre',
};

export interface ReservationFiltersProps {
  query: string; onQuery: (q: string) => void;
  date: string; onDate: (d: string) => void; onClearDate: () => void;
  status: StatusMode; statusCounts: Record<StatusMode, number>; onStatus: (s: StatusMode) => void;
  courts: CourtFacet[]; courtSel: Set<string>; onToggleCourt: (id: string) => void; onAllCourts: () => void;
  preset: TimePreset | null; onPreset: (p: TimePreset) => void;
  showCustom: boolean; onToggleCustom: () => void;
  fromHour: number | null; toHour: number | null; onCustomHour: (which: 'from' | 'to', h: number | null) => void;
  slotStart: number; closeH: number;
  methodsUsed: PaymentMethod[]; methodSel: Set<PaymentMethod>; onToggleMethod: (m: PaymentMethod) => void;
  activeCount: number; onReset: () => void;
}

/**
 * Barre de filtres de la page Encaissement, sur deux niveaux (tout reste visible) :
 *  • niveau 1 = l'essentiel (jour · recherche · statut) ;
 *  • niveau 2 = le contexte (créneau · terrain · moyen de paiement · réinitialiser).
 * Présentationnel : tout l'état vit dans la page.
 */
export function ReservationFilters(p: ReservationFiltersProps) {
  const { th } = useTheme();

  const lbl: CSSProperties = { color: th.textMute, fontWeight: 700, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, fontFamily: th.fontUI, whiteSpace: 'nowrap' };
  const mini: CSSProperties = { color: th.accent, fontSize: 12, fontWeight: 600, fontFamily: th.fontUI, background: 'none', border: 'none', cursor: 'pointer', padding: 0 };
  const sep = <span aria-hidden style={{ width: 1, height: 22, background: th.line, flexShrink: 0 }} />;

  const chip = (on: boolean): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${on ? th.accent : th.line}`,
    background: on ? th.accent : th.surface, color: on ? th.onAccent : th.text,
    borderRadius: 999, padding: '5px 11px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: th.fontUI, whiteSpace: 'nowrap',
  });

  const hourSelect = (value: number | null, onChange: (h: number | null) => void, offset: number) => (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      style={{ border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '5px 7px', fontFamily: th.fontUI, fontSize: 13 }}>
      <option value="">—</option>
      {Array.from({ length: Math.max(0, p.closeH - p.slotStart) }, (_, i) => p.slotStart + offset + i).map((h) => (
        <option key={h} value={h}>{String(h).padStart(2, '0')}h</option>
      ))}
    </select>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>

      {/* ── Niveau 1 : jour · recherche · statut ─────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
          Jour <DateField value={p.date} onChange={p.onDate} size="sm" />
        </label>
        {p.date && <button type="button" onClick={p.onClearDate} style={mini}>Tout afficher</button>}

        <input value={p.query} onChange={(e) => p.onQuery(e.target.value)} placeholder="🔍 Rechercher un client…"
          style={{ flex: '0 1 200px', minWidth: 130, border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 9, padding: '7px 11px', fontFamily: th.fontUI, fontSize: 13.5 }} />

        <div role="radiogroup" aria-label="Statut" style={{ display: 'inline-flex', border: `1px solid ${th.line}`, borderRadius: 999, overflow: 'hidden', background: th.surface }}>
          {STATUS_OPTS.map((o, i) => {
            const on = p.status === o.mode;
            const n = p.statusCounts[o.mode] ?? 0;
            const urgent = (o.mode === 'unpaid' || o.mode === 'partial') && n > 0;
            return (
              <button key={o.mode} type="button" role="radio" aria-checked={on} onClick={() => p.onStatus(o.mode)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', border: 'none',
                  borderLeft: i > 0 ? `1px solid ${th.line}` : 'none', background: on ? th.accent : 'transparent',
                  color: on ? th.onAccent : th.text, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {o.label}
                <span style={{ fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: on ? th.onAccent : urgent ? CORAL : th.textFaint }}>{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Niveau 2 : créneau · moyen · réinitialiser ───────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <span style={lbl}>Créneau</span>
        {PRESET_OPTS.map((o) => (
          <button key={o.key} type="button" onClick={() => p.onPreset(o.key)} style={chip(p.preset === o.key)}>{o.label}</button>
        ))}
        <button type="button" onClick={p.onToggleCustom} style={chip(p.showCustom)}>Plage…</button>
        {p.showCustom && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
            De {hourSelect(p.fromHour, (h) => p.onCustomHour('from', h), 0)} à {hourSelect(p.toHour, (h) => p.onCustomHour('to', h), 1)}
          </span>
        )}

        {p.methodsUsed.length > 0 && (
          <>
            {sep}
            <span style={lbl}>Moyen</span>
            {p.methodsUsed.map((m) => {
              const label = METHOD_LABEL[m] ?? m;
              // aria-label distinct du libellé visible : un bouton de moyen rapide d'encaissement
              // porte le même texte (« CB »…) — on évite la collision dans les requêtes par rôle.
              return (
                <button key={m} type="button" aria-pressed={p.methodSel.has(m)} aria-label={`Filtrer : ${label}`}
                  onClick={() => p.onToggleMethod(m)} style={chip(p.methodSel.has(m))}>{label}</button>
              );
            })}
          </>
        )}

        {p.activeCount > 0 && (
          <button type="button" onClick={p.onReset}
            style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: th.accent, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
            ⟲ Réinitialiser ({p.activeCount})
          </button>
        )}
      </div>

      {/* ── Niveau 3 : terrain, sur sa propre ligne ──────────────────────── */}
      {p.courts.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={lbl}>Terrain</span>
          {p.courts.map((c) => {
            const on = p.courtSel.has(c.id);
            return (
              <button key={c.id} type="button" role="checkbox" aria-checked={on} onClick={() => p.onToggleCourt(c.id)} style={chip(on)}>
                {c.name}
                {c.dueCount > 0
                  ? <span style={{ fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: on ? th.onAccent : CORAL }}>{c.dueCount}</span>
                  : <Icon name="check" size={12} color={on ? th.onAccent : SETTLED} />}
              </button>
            );
          })}
          {p.courtSel.size > 0 && <button type="button" onClick={p.onAllCourts} style={mini}>Tous</button>}
        </div>
      )}
    </div>
  );
}
