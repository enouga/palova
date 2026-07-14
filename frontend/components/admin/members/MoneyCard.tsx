'use client';
import { useState, CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import {
  api, Member, MemberHistory, MemberUnpaidReservation, PaymentMethod,
  SubscriptionPlanSummary,
} from '@/lib/api';
import { fmtEuros, toCents, DEFAULT_QUICK_METHODS, QUICK_METHOD_LABEL } from '@/lib/caisse';
import { daysUntil } from '@/lib/subscriptionAdmin';
import { methodLabel } from '@/lib/memberStats';
import { MonthlyRevenueChart } from '@/components/admin/stats/MonthlyRevenueChart';
import { PaymentMethodChart } from '@/components/admin/stats/PaymentMethodChart';
import { PackageBalanceDialog } from '@/components/admin/members/PackageBalanceDialog';
import { SubscriptionActions } from '@/components/admin/subscriptions/SubscriptionActions';

const CORAL = '#ff7a4d';
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');
const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const money = (v: string) => fmtEuros(toCents(v));

type SubAction = 'renew' | 'change' | 'cancel';
type Bal = MemberHistory['finance']['prepaid']['balances'][number];

export function MoneyCard({ member, history, clubId, token, quickMethods, payAtClubOnly, onChanged, onError }: {
  member: Member;
  history: MemberHistory;
  clubId: string;
  token: string;
  quickMethods: PaymentMethod[];
  payAtClubOnly: boolean;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const { th } = useTheme();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pkgAction, setPkgAction] = useState<{ mode: 'recharge' | 'adjust'; bal: Bal } | null>(null);
  const [subAction, setSubAction] = useState<SubAction | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlanSummary[] | null>(null);

  const f = history.finance;
  const methods: PaymentMethod[] = payAtClubOnly ? ['CLUB'] : (quickMethods.length ? quickMethods : DEFAULT_QUICK_METHODS);

  const collect = async (u: MemberUnpaidReservation, method: PaymentMethod) => {
    const key = `${u.reservationId}:${u.participantId ?? 'org'}`;
    if (busyKey) return;
    setBusyKey(key);
    try {
      await api.adminAddPayment(clubId, u.reservationId, {
        amount: toCents(u.dueAmount) / 100,
        method,
        participantId: u.participantId ?? undefined,
      }, token);
      onChanged();
    } catch (e) {
      onError((e as Error).message === 'PAYMENT_EXCEEDS_DUE'
        ? 'Le reste dû a changé — fiche rechargée.' : (e as Error).message);
      onChanged();
    } finally { setBusyKey(null); }
  };

  const openSubAction = async (kind: SubAction) => {
    if (plans === null) {
      try {
        const p = await api.adminGetSubscriptionPlans(clubId, token);
        setPlans(p.map((x) => ({
          id: x.id, name: x.name, monthlyPrice: x.monthlyPrice, benefit: x.benefit,
          discountPercent: x.discountPercent, sportKeys: x.sportKeys, isActive: x.isActive, activeCount: 0,
        })));
      } catch { setPlans([]); }
    }
    setSubAction(kind);
  };

  const lbl: CSSProperties = { fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute };
  const line: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 0', borderBottom: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 13, color: th.text };
  const smallBtn: CSSProperties = { border: `1px solid ${th.lineStrong}`, background: th.surface, color: th.text, borderRadius: 999, padding: '4px 10px', fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' };

  const sub = member.subscription ?? null;
  const subDays = sub ? daysUntil(sub.expiresAt, Date.now()) : null;

  return (
    <div id="cockpit-money" style={{ background: th.surface, borderRadius: 16, padding: 16, boxShadow: th.shadow }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={lbl}>💶 Argent</span>
        <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>
          {money(f.totalSpent)} au total · panier moyen {money(f.averageBasket)}
        </span>
      </div>

      {/* Impayés */}
      {f.unpaid.length === 0 ? (
        <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, padding: '6px 0' }}>✓ Rien à encaisser.</div>
      ) : f.unpaid.map((u) => {
        const key = `${u.reservationId}:${u.participantId ?? 'org'}`;
        return (
          <div key={key} style={line}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: CORAL, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 140 }}>{u.resourceName} · {fmtDateTime(u.startTime)}</span>
            <b>{money(u.dueAmount)}</b>
            <span style={{ display: 'flex', gap: 5 }}>
              {methods.map((mth) => (
                <button key={mth} disabled={busyKey !== null} onClick={() => collect(u, mth)}
                  aria-label={`Encaisser ${money(u.dueAmount)} — ${payAtClubOnly ? 'Au club' : QUICK_METHOD_LABEL[mth] ?? mth}`}
                  style={{ ...smallBtn, opacity: busyKey && busyKey !== key ? 0.5 : 1 }}>
                  {busyKey === key ? '…' : payAtClubOnly ? `Encaissé · ${money(u.dueAmount)}` : (QUICK_METHOD_LABEL[mth] ?? mth)}
                </button>
              ))}
            </span>
          </div>
        );
      })}

      {/* Soldes prépayés */}
      {f.prepaid.balances.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {f.prepaid.balances.map((b) => {
            const expired = !!b.expiresAt && new Date(b.expiresAt).getTime() < Date.now();
            return (
              <div key={b.id} style={line}>
                <span style={{ flex: 1, minWidth: 140 }}>{b.name}</span>
                <b>{b.kind === 'ENTRIES' ? `${b.creditsRemaining ?? 0} entrée(s)` : `${b.amountRemaining ? money(b.amountRemaining) : '0,00 €'}`}</b>
                {b.expiresAt && <span style={{ fontSize: 12, color: expired ? CORAL : th.textFaint }}>{expired ? 'expiré' : `→ ${fmtDate(b.expiresAt)}`}</span>}
                <button style={smallBtn} disabled={expired} onClick={() => setPkgAction({ mode: 'recharge', bal: b })}>Recharger</button>
                <button style={{ ...smallBtn, color: th.textMute }} onClick={() => setPkgAction({ mode: 'adjust', bal: b })}>Corriger</button>
              </div>
            );
          })}
        </div>
      )}

      {/* Abonnement géré */}
      {sub && (
        <div style={{ ...line, borderBottom: 'none', marginTop: 4 }}>
          <span style={{ flex: 1, minWidth: 140 }}>{sub.planName}</span>
          <span style={{
            fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '3px 10px',
            background: subDays !== null && subDays <= 30 ? '#fdeee2' : '#e3f0e6',
            color: subDays !== null && subDays <= 30 ? '#b45309' : '#2c7a44',
          }}>
            {subDays !== null && subDays <= 30 ? `Expire dans ${subDays} j` : `Actif → ${fmtDate(sub.expiresAt)}`}
          </span>
          <button style={smallBtn} onClick={() => openSubAction('renew')}>Renouveler</button>
          <button style={smallBtn} onClick={() => openSubAction('change')}>Changer</button>
          <button style={{ ...smallBtn, color: CORAL, borderColor: '#f0b8a4' }} onClick={() => openSubAction('cancel')}>Résilier</button>
        </div>
      )}

      {/* Dépliant : graphiques + consommation */}
      <button onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.accent, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, padding: '10px 0 0' }}>
        {expanded ? 'Réduire ▴' : 'Détails (CA, moyens de paiement) ▾'}
      </button>
      {expanded && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <MonthlyRevenueChart series={f.revenueByMonth} />
          <PaymentMethodChart byMethod={f.paymentsByMethod} />
          {f.prepaid.consumption.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {f.prepaid.consumption.slice(0, 10).map((c, i) => (
                <li key={i} style={{ display: 'flex', gap: 8, fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>
                  <span>{fmtDateTime(c.at)}</span><span>· {c.packageName}</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 600, color: th.text }}>{methodLabel(c.method)} {money(c.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {pkgAction && (
        <PackageBalanceDialog clubId={clubId} userId={member.userId} token={token}
          mode={pkgAction.mode} bal={pkgAction.bal}
          onClose={() => setPkgAction(null)} onDone={() => { setPkgAction(null); onChanged(); }} />
      )}
      {subAction && sub && plans !== null && (
        <SubscriptionActions action={subAction}
          sub={{ id: sub.id, planId: sub.planId, planName: sub.planName, expiresAt: sub.expiresAt, monthlyPriceSnapshot: sub.monthlyPriceSnapshot }}
          plans={plans} clubId={clubId} token={token}
          onClose={() => setSubAction(null)} onDone={() => { setSubAction(null); onChanged(); }} />
      )}
    </div>
  );
}
