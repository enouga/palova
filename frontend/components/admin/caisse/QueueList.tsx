'use client';
import { CSSProperties, ReactNode } from 'react';
import { ClubReservation } from '@/lib/api';
import { fmtEuros } from '@/lib/caisse';
import { QueueEntry, placePaymentDots, queueDayKey } from '@/lib/caisseRegister';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { PaymentDots, SETTLED_COLOR } from '@/components/admin/PaymentDots';

function fmtTime(iso: string): string { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
function fmtDay(iso: string): string { return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }); }

export interface QueueListProps {
  toCollect: QueueEntry<ClubReservation>[];
  settled: QueueEntry<ClubReservation>[];
  playersOf: (r: ClubReservation) => number;
  selectedId: string | null;
  onSelect: (r: ClubReservation) => void;
}

/**
 * Zone « file » de la Caisse express : réservations à encaisser (chronologique)
 * puis soldées. Une ligne = heure · titulaire · terrain, pastilles, reste dû.
 */
export function QueueList({ toCollect, settled, playersOf, selectedId, onSelect }: QueueListProps) {
  const { th } = useTheme();

  const header = (label: string) => (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: th.textFaint, padding: '2px 4px', fontFamily: th.fontUI }}>{label}</div>
  );

  const row = (e: QueueEntry<ClubReservation>, done: boolean) => {
    const r = e.r;
    const who = r.title?.trim() ? r.title : r.user ? `${r.user.firstName} ${r.user.lastName}` : 'Événement';
    const sel = r.id === selectedId;
    const dots = placePaymentDots(r, playersOf(r), e.due);
    const st: CSSProperties = {
      display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
      background: th.surface, border: 'none', borderRadius: 12, padding: '10px 12px', cursor: 'pointer',
      boxShadow: sel ? `0 0 0 2px ${th.accent}` : `inset 0 0 0 1px ${th.line}`,
      opacity: done && !sel ? 0.72 : 1, fontFamily: th.fontUI,
    };
    return (
      <button key={r.id} type="button" onClick={() => onSelect(r)} aria-current={sel || undefined} style={st}>
        <span style={{ fontFamily: th.fontMono, fontSize: 16, fontWeight: 700, color: th.accent, flexShrink: 0, letterSpacing: '-0.02em' }}>{fmtTime(r.startTime)}</span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: th.textMute, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.15 }}>{who}</span>
          <span style={{ display: 'inline-flex', alignSelf: 'flex-start', maxWidth: '100%', background: `${th.accent}22`, borderRadius: 999, padding: '2px 10px' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: th.textMute, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.resource.name}</span>
          </span>
        </span>
        {dots && !done && <PaymentDots dots={dots} color={th.accent} />}
        {done
          ? <span style={{ fontSize: 12, fontWeight: 700, color: SETTLED_COLOR, whiteSpace: 'nowrap' }}>✓ Soldé</span>
          : <span style={{ fontSize: 14, fontWeight: 800, color: ACCENTS.coral, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtEuros(e.remaining)}</span>}
      </button>
    );
  };

  // Séparateur de date : la file est triée par jour (queueGroups) — une ligne de date ouvre
  // chaque groupe de jours dans chaque zone, pour toujours savoir sur quel jour on encaisse.
  const dateRow = (iso: string, keyPrefix: string) => (
    <div key={`${keyPrefix}:${queueDayKey(iso)}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px 0' }}>
      <span style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, color: th.textMute }}>{fmtDay(iso)}</span>
      <span aria-hidden style={{ flex: 1, height: 1, background: th.line }} />
    </div>
  );
  const zone = (entries: QueueEntry<ClubReservation>[], done: boolean): ReactNode[] => {
    const out: ReactNode[] = [];
    let prevDay: string | null = null;
    for (const e of entries) {
      const day = queueDayKey(e.r.startTime);
      if (day !== prevDay) { out.push(dateRow(e.r.startTime, done ? 's' : 'c')); prevDay = day; }
      out.push(row(e, done));
    }
    return out;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toCollect.length > 0 && header("À encaisser d'abord")}
      {zone(toCollect, false)}
      {settled.length > 0 && header('Soldées')}
      {zone(settled, true)}
      {toCollect.length === 0 && settled.length === 0 && (
        <div style={{ padding: '32px 12px', textAlign: 'center', fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, background: th.surface, borderRadius: 14, boxShadow: `inset 0 0 0 1px ${th.line}` }}>Aucune réservation</div>
      )}
    </div>
  );
}
