'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { api, ClubBilling } from '@/lib/api';
import { PLATFORM_TIERS, tierLabel } from '@/lib/platformTiers';
import { eurosFromCents } from '@/lib/payments';

const STATE_LABEL: Record<ClubBilling['state'], string> = {
  EXEMPT: 'Offert — club partenaire',
  FREE: 'Palier gratuit',
  OK: 'Abonnement actif',
  TO_REGULARIZE: 'À régulariser',
  PAST_DUE: 'Paiement en échec',
};

/** Jauge de membres actifs avec les seuils de paliers (50/150/400/800, échelle plafonnée à 1000). */
function MemberGauge({ count }: { count: number }) {
  const { th } = useTheme();
  const MAX = 1000;
  const pct = Math.min(100, (count / MAX) * 100);
  const thresholds = PLATFORM_TIERS.filter((t) => t.maxMembers !== null).map((t) => t.maxMembers as number);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontFamily: th.fontMono, fontSize: 40, fontWeight: 700, color: th.text }}>{count}</span>
        <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>membres actifs (90 derniers jours)</span>
      </div>
      <div style={{ position: 'relative', height: 10, borderRadius: 6, background: th.line, marginTop: 12 }}>
        <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, borderRadius: 6, background: th.accent }} />
        {thresholds.map((m) => (
          <div key={m} title={`${m} membres`} style={{
            position: 'absolute', left: `${(m / MAX) * 100}%`, top: -3, bottom: -3, width: 2,
            background: th.textFaint, opacity: 0.6,
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint }}>
        <span>0</span><span>50</span><span>150</span><span>400</span><span>800+</span>
      </div>
    </div>
  );
}

export default function AdminBillingPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;

  const [billing, setBilling] = useState<ClubBilling | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token || !clubId) return;
    api.adminGetBilling(clubId, token).then(setBilling).catch(() => setBilling(null));
    api.getMyClubs(token)
      .then((clubs) => setIsOwner(clubs.find((c) => c.clubId === clubId)?.role === 'OWNER'))
      .catch(() => setIsOwner(false));
  }, [ready, token, clubId]);

  async function go(kind: 'checkout-month' | 'checkout-year' | 'portal') {
    if (!token || !clubId || busy) return;
    setBusy(kind); setError(null);
    const returnUrl = `${window.location.origin}/admin/billing`;
    try {
      const { url } = kind === 'portal'
        ? await api.adminBillingPortal(clubId, returnUrl, token)
        : await api.adminBillingCheckout(clubId, kind === 'checkout-year' ? 'year' : 'month', returnUrl, token);
      window.location.assign(url);
    } catch (err) {
      const m = (err as Error).message;
      setError(m === 'ALREADY_SUBSCRIBED' ? 'Votre club a déjà un abonnement actif.'
        : m === 'NOTHING_TO_SUBSCRIBE' ? 'Votre club est dans le palier gratuit : rien à souscrire.'
        : m === 'NO_BILLING_ACCOUNT' ? "Aucun abonnement n'a encore été souscrit pour ce club."
        : 'Le paiement en ligne est indisponible pour le moment. Réessayez plus tard.');
      setBusy(null);
    }
  }

  const card: CSSProperties = {
    background: th.bgElev, border: `1px solid ${th.line}`, borderRadius: 14, padding: '18px 20px', marginBottom: 16,
  };
  const btn: CSSProperties = {
    padding: '10px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
    fontFamily: th.fontUI, fontWeight: 700, fontSize: 14, background: th.accent, color: '#fff',
  };

  if (!billing) return <div style={{ color: th.textFaint, fontFamily: th.fontUI }}>Chargement…</div>;

  const sub = billing.subscription;
  const needsAction = billing.state === 'TO_REGULARIZE' || billing.state === 'PAST_DUE';

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, color: th.text, margin: '0 0 4px' }}>
        Abonnement Palova
      </h1>
      <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, margin: '0 0 20px' }}>
        Un seul plan tout inclus — le prix dépend du nombre de membres actifs de votre club.
      </p>

      {/* Jauge */}
      <section style={card}>
        <MemberGauge count={billing.activeMembers} />
        <div style={{ marginTop: 12, fontFamily: th.fontUI, fontSize: 13.5, color: th.text }}>
          Palier observé : <strong>{billing.tierLabel}</strong> — {billing.monthlyPriceCents === 0
            ? 'gratuit'
            : `${eurosFromCents(billing.monthlyPriceCents)} HT/mois ou ${eurosFromCents(billing.yearlyPriceCents)} HT/an (−15 %)`}
        </div>
        {billing.countedAt && (
          <div style={{ marginTop: 4, fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint }}>
            Compté le {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(billing.countedAt))}
          </div>
        )}
      </section>

      {/* État + actions */}
      <section style={{ ...card, borderLeft: needsAction ? '4px solid #e8804f' : `1px solid ${th.line}` }}>
        <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>
          {STATE_LABEL[billing.state]}
        </div>

        {sub && (
          <div style={{ marginTop: 8, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
            {sub.tierLabel} · {sub.interval === 'year' ? 'annuel' : 'mensuel'} · {eurosFromCents(sub.priceCents)} HT
            {sub.currentPeriodEnd && <> · prochaine échéance le {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(sub.currentPeriodEnd))}</>}
            {sub.cancelAtPeriodEnd && <> · <strong>s&apos;arrête à échéance</strong></>}
          </div>
        )}

        {billing.state === 'FREE' && (
          <p style={{ marginTop: 8, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
            Palova est gratuit jusqu&apos;à 50 membres actifs — toutes les fonctionnalités sont incluses.
          </p>
        )}
        {billing.state === 'TO_REGULARIZE' && (
          <p style={{ marginTop: 8, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
            Votre club dépasse le palier gratuit. Toutes vos fonctionnalités restent ouvertes —
            souscrivez pour régulariser.
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
          {isOwner && !sub && billing.observedTier >= 1 && (
            <>
              <button style={btn} disabled={busy !== null} onClick={() => go('checkout-month')}>
                Souscrire — mensuel · {eurosFromCents(billing.monthlyPriceCents)} HT
              </button>
              <button style={{ ...btn, background: 'transparent', color: th.accent, border: `1.5px solid ${th.accent}` }}
                disabled={busy !== null} onClick={() => go('checkout-year')}>
                Souscrire — annuel −15 % · {eurosFromCents(billing.yearlyPriceCents)} HT
              </button>
            </>
          )}
          {isOwner && sub && (
            <button style={btn} disabled={busy !== null} onClick={() => go('portal')}>
              Gérer mon abonnement &amp; factures
            </button>
          )}
          {!isOwner && (billing.observedTier >= 1 || sub) && (
            <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint }}>
              La souscription est réservée au gérant du club.
            </span>
          )}
        </div>
        {error && <div style={{ marginTop: 10, fontFamily: th.fontUI, fontSize: 13, color: '#c4472e' }}>{error}</div>}
      </section>

      {/* Historique */}
      {billing.snapshots.length > 0 && (
        <section style={card}>
          <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14, color: th.text, marginBottom: 10 }}>
            Historique mensuel
          </div>
          {billing.snapshots.map((s) => (
            <div key={s.month} style={{
              display: 'flex', justifyContent: 'space-between', padding: '7px 0',
              borderBottom: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 13.5, color: th.text,
            }}>
              <span style={{ fontFamily: th.fontMono }}>{s.month}</span>
              <span>{s.activeMembers} membres actifs</span>
              <span style={{ color: th.textMute }}>{tierLabel(s.tier)}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
