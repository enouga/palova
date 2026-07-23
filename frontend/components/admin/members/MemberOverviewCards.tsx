'use client';
// Trois petites cartes lecture seule du cockpit fiche membre 360 — composants PURS
// (aucun fetch) : à venir, paiements (raccourci d'encaissement), fidélité & habitudes.
import { ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { MemberHistory } from '@/lib/api';
import { fmtEuros, toCents } from '@/lib/caisse';
import { lastVisitLabel, cancellationLabel } from '@/lib/memberStats';

const KIND_FR: Record<string, string> = { reservation: 'résa', tournament: 'tournoi', event: 'event', lesson: 'cours' };
const STATUS_FR: Record<string, string> = { CONFIRMED: 'inscrit', WAITLISTED: 'en attente' };

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const { th } = useTheme();
  return (
    <section aria-label={title} style={{ background: th.surface, borderRadius: 18, padding: 18, boxShadow: th.shadow }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 16, margin: 0, color: th.text }}>{title}</h2>{action}
      </div>
      <div style={{ marginTop: 8 }}>{children}</div>
    </section>
  );
}

export function MemberUpcomingCard({ data }: { data: MemberHistory }) {
  const { th } = useTheme();
  const fmt = (iso: string) => new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  return (
    <Card title="À venir">
      {data.upcoming.length === 0 && <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint }}>Rien de prévu.</span>}
      {data.upcoming.map((u) => (
        <div key={`${u.kind}-${u.id}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', fontFamily: th.fontUI, fontSize: 13, color: th.text }}>
          <span>{fmt(u.startTime)} · {u.title}</span>
          <b style={{ color: th.textMute }}>{u.status ? STATUS_FR[u.status] ?? u.status : KIND_FR[u.kind]}</b>
        </div>
      ))}
    </Card>
  );
}

export function MemberPaymentsCard({ data, onCollect }: { data: MemberHistory; onCollect: () => void }) {
  const { th } = useTheme();
  const due = toCents(data.finance.outstanding);
  return (
    <Card title="Paiements" action={<button onClick={onCollect} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.accent }}>Encaisser →</button>}>
      <div style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 26, color: due > 0 ? th.danger : th.text }}>
        {due > 0 ? `${fmtEuros(due)} dus` : 'Soldé ✓'}
      </div>
      <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 4 }}>Total dépensé : {fmtEuros(toCents(data.finance.totalSpent))}</div>
    </Card>
  );
}

export function MemberLoyaltyCard({ data }: { data: MemberHistory }) {
  const { th } = useTheme();
  const l = data.loyalty;
  const row = { display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontFamily: th.fontUI, fontSize: 13, color: th.text } as const;
  return (
    <Card title="Fidélité & habitudes">
      <div style={row}><span>Fréquence</span><b>{l.playsPerMonth} résas/mois</b></div>
      <div style={row}><span>Dernière visite</span><b>{lastVisitLabel(l.daysSinceLastVisit)}</b></div>
      <div style={row}><span>Annulations</span><b>{cancellationLabel(l.cancellationRate)}{data.counts.lateCancelled > 0 ? ` (${data.counts.lateCancelled} tardives)` : ''}</b></div>
      {data.favorites.resource && <div style={row}><span>Habitudes</span><b>{data.favorites.resource.name}</b></div>}
    </Card>
  );
}
