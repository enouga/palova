'use client';
import { Member, SubscriptionPlan } from '@/lib/api';
import { Theme, ACCENTS } from '@/lib/theme';
import { fmtEuros as eur } from '@/lib/caisse';
import { eurosTrim as eurStr } from '@/lib/payments';
import { Icon } from '@/components/ui/Icon';
import { daysUntil } from '@/lib/subscriptionAdmin';

const PALETTE = ['blue', 'coral', 'apricot', 'cyan', 'emerald'] as const;

/**
 * Bandeau de pilotage affiché en contexte « Abonnés » : KPIs (revenu/mois, expirations),
 * cartes par forfait (cliquables = filtre), et sous-filtres (Expire bientôt / Sport).
 * Calculé côté client depuis la liste d'abonnés déjà chargée.
 */
export function SubscriberInsights({
  th, subscribers, plans, nowMs, multiSport, sportName,
  planFilter, onPlanFilter, expiringOnly, onToggleExpiring, sportFilter, onSportFilter,
}: {
  th: Theme;
  subscribers: Member[];           // base abonnés (recherche appliquée, avant sous-filtres)
  plans: SubscriptionPlan[];       // tous les forfaits (pour les cartes vides comprises)
  nowMs: number;
  multiSport: boolean;
  sportName: (key: string) => string;
  planFilter: string | null; onPlanFilter: (id: string | null) => void;
  expiringOnly: boolean; onToggleExpiring: () => void;
  sportFilter: string | null; onSportFilter: (key: string | null) => void;
}) {
  const active = subscribers.filter((m) => m.subscription);
  const revenueCents = active.reduce((s, m) => s + Math.round(Number(m.subscription!.monthlyPriceSnapshot) * 100), 0);
  const expiringCount = active.filter((m) => daysUntil(m.subscription!.expiresAt, nowMs) <= 30).length;
  const countByPlan = new Map<string, number>();
  for (const m of active) countByPlan.set(m.subscription!.planId, (countByPlan.get(m.subscription!.planId) ?? 0) + 1);
  const totalActive = active.length || 1;
  const sportsPresent = [...new Set(active.flatMap((m) => m.subscription!.sportKeys))];

  const stat = (icon: 'euro' | 'clock', tint: string, value: string, label: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: th.surface, borderRadius: 12, padding: '10px 14px', boxShadow: th.shadow }}>
      <span style={{ width: 32, height: 32, borderRadius: 9, background: `${tint}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={15} color={tint} /></span>
      <div>
        <div style={{ fontFamily: th.fontDisplay, fontSize: 18, fontWeight: 800, letterSpacing: -0.5, color: th.text }}>{value}</div>
        <div style={{ fontFamily: th.fontUI, fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: th.textMute }}>{label}</div>
      </div>
    </div>
  );

  const chip = (label: string, on: boolean, onClick: () => void) => (
    <button type="button" onClick={onClick} aria-pressed={on}
      style={{ border: `1px solid ${on ? th.text : th.lineStrong}`, background: on ? th.text : th.surface, color: on ? th.bg : th.textMute, borderRadius: 999, padding: '6px 12px', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
      {label}
    </button>
  );

  return (
    <div style={{ marginBottom: 14 }}>
      {/* KPIs compacts */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        {stat('euro', ACCENTS.emerald, eur(revenueCents), 'Revenu / mois')}
        {stat('clock', ACCENTS.coral, String(expiringCount), 'Expirent sous 30 j')}
      </div>

      {/* Cartes par forfait (cliquables = filtre) */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        {plans.map((p, i) => {
          const c = ACCENTS[PALETTE[i % PALETTE.length]] ?? th.accent;
          const n = countByPlan.get(p.id) ?? 0;
          const on = planFilter === p.id;
          return (
            <button key={p.id} type="button" onClick={() => onPlanFilter(on ? null : p.id)}
              style={{ flex: '1 1 190px', textAlign: 'left', background: th.surface, borderRadius: 12, padding: '11px 13px', border: 'none',
                boxShadow: on ? `0 0 0 2px ${c}` : th.shadow, borderLeft: `4px solid ${c}`, opacity: n === 0 ? 0.6 : 1, cursor: 'pointer' }}>
              <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 12.5, color: th.text }}>{p.name}
                {multiSport && p.sportKeys[0] && <span style={{ marginLeft: 6, fontSize: 10, color: th.textFaint }}>· {p.sportKeys.join(', ')}</span>}
              </div>
              <div style={{ fontFamily: th.fontUI, fontSize: 10.5, color: th.textMute }}>{eurStr(p.monthlyPrice)} €/mois</div>
              <div style={{ fontFamily: th.fontDisplay, fontSize: 18, fontWeight: 800, letterSpacing: -0.5, color: th.text, marginTop: 3 }}>{n} <small style={{ fontSize: 10.5, color: th.textMute, fontWeight: 600 }}>abonné{n > 1 ? 's' : ''}</small></div>
              <div style={{ height: 4, background: th.surface2, borderRadius: 3, marginTop: 7 }}>
                <div style={{ height: '100%', width: `${Math.round((n / totalActive) * 100)}%`, background: c, borderRadius: 3 }} />
              </div>
            </button>
          );
        })}
      </div>

      {/* Sous-filtres */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {chip('Expirent bientôt', expiringOnly, onToggleExpiring)}
        {multiSport && sportsPresent.length > 1 && sportsPresent.map((k) =>
          <span key={k}>{chip(sportName(k), sportFilter === k, () => onSportFilter(sportFilter === k ? null : k))}</span>,
        )}
        {(planFilter || expiringOnly || sportFilter) && (
          <button type="button" onClick={() => { onPlanFilter(null); if (expiringOnly) onToggleExpiring(); onSportFilter(null); }}
            style={{ border: 'none', background: 'transparent', color: th.textMute, fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
            Effacer
          </button>
        )}
      </div>
    </div>
  );
}
