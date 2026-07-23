'use client';
// Carte « Dernières réservations » du cockpit fiche membre 360 — composant PUR
// (aucun fetch), 5 dernières lignes de data.reservations (déjà triées par la page).
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { MemberHistory } from '@/lib/api';
import { matchOutcome } from '@/lib/memberStats';

const TYPE_FR: Record<string, string> = { COURT: 'Terrain', COACHING: 'Cours', TOURNAMENT: 'Tournoi', EVENT: 'Event' };
const fmtRange = (s: string, e: string) => {
  const d = new Date(s), f = new Date(e);
  const day = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
  const hm = (x: Date) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(x);
  return `${day} · ${hm(d)}–${hm(f)}`;
};

export function MemberReservationsCard({ data, onSeeAll }: { data: MemberHistory; onSeeAll: () => void }) {
  const { th } = useTheme();
  const rows = data.reservations.slice(0, 5);
  const me = data.member.userId;
  return (
    <section aria-label="Dernières réservations" style={{ background: th.surface, borderRadius: 18, padding: 18, boxShadow: th.shadow }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 16, margin: 0, color: th.text }}>Dernières réservations</h2>
        <button onClick={onSeeAll} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.accent }}>Tout l&apos;historique →</button>
      </div>
      {rows.length === 0 && <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, marginTop: 10 }}>Aucune réservation.</div>}
      {rows.map((r) => {
        const cancelled = r.status === 'CANCELLED';
        const others = r.participants.filter((p) => p.userId !== me).map((p) => `${p.firstName} ${p.lastName.charAt(0)}.`);
        const result = matchOutcome(r.match);
        return (
          <div key={r.id} style={{ border: `1px solid ${th.line}`, borderRadius: 10, padding: '8px 11px', marginTop: 8, opacity: cancelled ? 0.55 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontFamily: th.fontUI, fontSize: 13, color: th.text }}>
              <span><b>{fmtRange(r.startTime, r.endTime)}</b> · {r.resourceName} <span style={{ fontSize: 10.5, fontWeight: 700, color: th.textMute, background: th.surface2, borderRadius: 5, padding: '1px 6px' }}>{TYPE_FR[r.type]}</span></span>
              <span style={{ fontWeight: 700, color: cancelled ? th.textMute : th.text }}>
                {cancelled ? (r.lateCancel ? 'Annulée · tardive' : 'Annulée') : Number(r.attributedAmount) > 0 ? `Payé ${r.attributedAmount} € ✓` : ''}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontFamily: th.fontUI, fontSize: 11.5, color: th.textMute, marginTop: 2 }}>
              <span>{others.length > 0 ? `Avec ${others.join(', ')}` : ''}{r.isOrganizer ? (others.length ? ' · organise' : 'Organise') : ''}</span>
              {result && <b style={{ color: result.won ? ACCENTS.emerald : ACCENTS.coral }}>{result.won ? 'V' : 'D'} {result.score}</b>}
            </div>
          </div>
        );
      })}
    </section>
  );
}
