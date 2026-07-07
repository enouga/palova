'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { api, ClubBilling } from '@/lib/api';
import { PLATFORM_TIERS, tierLabel } from '@/lib/platformTiers';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';

const STATE_LABEL: Record<ClubBilling['state'], string> = {
  EXEMPT: 'Offert — club partenaire',
  FREE: 'Palier gratuit',
  OK: 'Abonnement actif',
  TO_REGULARIZE: 'À régulariser',
  PAST_DUE: 'Paiement en échec',
};

// Encre bleue fixe de la jauge (lisible sur la brume bleue dans les 2 thèmes).
const GAUGE_FILL = '#2c4668';

/** 2900 → « 29 € », 101000 → « 1 010 € » (espaces normalisées, sans décimales inutiles). */
function euros(cents: number): string {
  const value = cents / 100;
  const s = (Number.isInteger(value)
    ? value.toLocaleString('fr-FR')
    : value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  ).replace(/[  ]/g, ' ');
  return `${s} €`;
}

/** Plage courte d'un palier : « 0 – 50 », « 801+ »… */
function tierRange(tier: number): string {
  return tierLabel(tier).replace(' membres actifs', '');
}

/**
 * Position (%) sur la jauge SEGMENTÉE : chaque palier occupe 20 % de la largeur,
 * la position est proportionnelle à l'intérieur de son segment (au-delà de 800,
 * progression douce vers 100 %). Échelle non linéaire mais lisible : les seuils
 * tombent pile sur les frontières de segments.
 */
function gaugePercent(count: number): number {
  for (let i = 0; i < PLATFORM_TIERS.length; i++) {
    const t = PLATFORM_TIERS[i];
    if (t.maxMembers === null) {
      return 80 + Math.min(1, Math.max(0, (count - 800) / 800)) * 20;
    }
    const min = i === 0 ? 0 : (PLATFORM_TIERS[i - 1].maxMembers as number);
    if (count <= t.maxMembers) return i * 20 + ((count - min) / (t.maxMembers - min)) * 20;
  }
  return 100;
}

/** Jauge segmentée par palier, sur fond brume bleue (encre fixe). */
function MemberGauge({ count, countedAt }: { count: number; countedAt: string | null }) {
  const { th } = useTheme();
  const pct = gaugePercent(count);
  const boundaries = [20, 40, 60, 80]; // frontières de segments (50/150/400/800)
  const boundaryLabels = ['50', '150', '400', '800'];
  return (
    <section style={{
      background: HERO_GRADIENT, borderRadius: 18, padding: '22px 24px', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: th.fontDisplay, fontSize: 46, fontWeight: 700, color: HERO_INK, lineHeight: 1 }}>
          {count}
        </span>
        <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: HERO_INK_MUTED, fontWeight: 600 }}>
          membres actifs sur les 90 derniers jours
        </span>
      </div>

      <div style={{ position: 'relative', height: 12, borderRadius: 7, background: 'rgba(24,21,14,0.10)', marginTop: 18 }}>
        {/* Remplissage */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: 0, width: `${pct}%`,
          borderRadius: 7, background: GAUGE_FILL, transition: 'width .4s ease',
        }} />
        {/* Frontières de paliers */}
        {boundaries.map((b) => (
          <div key={b} style={{
            position: 'absolute', left: `${b}%`, top: -4, bottom: -4, width: 2,
            background: 'rgba(24,21,14,0.28)', borderRadius: 1,
          }} />
        ))}
        {/* Curseur */}
        <div aria-hidden style={{
          position: 'absolute', left: `${pct}%`, top: '50%', transform: 'translate(-50%, -50%)',
          width: 20, height: 20, borderRadius: '50%', background: '#fff',
          border: `4px solid ${GAUGE_FILL}`, boxShadow: '0 2px 8px rgba(24,21,14,0.25)',
        }} />
      </div>

      {/* Libellés des seuils, alignés sur les frontières */}
      <div style={{ position: 'relative', height: 16, marginTop: 7 }}>
        <span style={{ position: 'absolute', left: 0, fontFamily: th.fontUI, fontSize: 11.5, color: HERO_INK_MUTED }}>0</span>
        {boundaries.map((b, i) => (
          <span key={b} style={{
            position: 'absolute', left: `${b}%`, transform: 'translateX(-50%)',
            fontFamily: th.fontUI, fontSize: 11.5, color: HERO_INK_MUTED, fontWeight: 600,
          }}>{boundaryLabels[i]}</span>
        ))}
        <span style={{ position: 'absolute', right: 0, fontFamily: th.fontUI, fontSize: 11.5, color: HERO_INK_MUTED }}>800+</span>
      </div>

      {countedAt && (
        <div style={{ marginTop: 10, fontFamily: th.fontUI, fontSize: 11.5, color: HERO_INK_MUTED }}>
          Compté le {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(countedAt))}
        </div>
      )}
    </section>
  );
}

/** Rangée des paliers de prix — le palier courant du club est mis en avant. */
function TierPricingRow({ observedTier, subscribedTier }: { observedTier: number; subscribedTier: number | null }) {
  const { th } = useTheme();
  return (
    <section style={{ marginBottom: 16 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 10,
      }}>
        {PLATFORM_TIERS.map((t) => {
          const isObserved = t.tier === observedTier;
          const isSubscribed = subscribedTier !== null && t.tier === subscribedTier;
          return (
            <div key={t.tier} style={{
              position: 'relative',
              background: th.bgElev,
              border: `1px solid ${isObserved ? 'transparent' : th.line}`,
              boxShadow: isObserved ? `0 0 0 2px ${th.accent}` : undefined,
              borderRadius: 14,
              padding: '14px 14px 12px',
              textAlign: 'center',
            }}>
              {(isObserved || isSubscribed) && (
                <div style={{
                  position: 'absolute', top: -9, left: '50%', transform: 'translateX(-50%)',
                  background: isObserved ? th.accent : th.textMute, color: '#fff',
                  fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4,
                  textTransform: 'uppercase', padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap',
                }}>
                  {isObserved ? 'Votre palier' : 'Souscrit'}
                </div>
              )}
              <div style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, color: th.textMute, marginTop: 2 }}>
                {tierRange(t.tier)}
              </div>
              <div style={{ fontFamily: th.fontUI, fontSize: 10.5, color: th.textFaint, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                membres actifs
              </div>
              <div style={{
                fontFamily: th.fontDisplay, fontSize: 25, fontWeight: 700, letterSpacing: -0.4,
                color: isObserved ? th.accent : th.text, marginTop: 8, lineHeight: 1.05,
              }}>
                {t.monthlyCents === 0 ? 'Gratuit' : euros(t.monthlyCents)}
              </div>
              <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, marginTop: 3 }}>
                {t.monthlyCents === 0 ? 'tout inclus' : <>/ mois HT<br />{euros(t.yearlyCents)} /an (−15 %)</>}
              </div>
            </div>
          );
        })}
      </div>
      <p style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint, margin: '10px 2px 0' }}>
        Toutes les fonctionnalités sont incluses à tous les paliers — seul le nombre de membres actifs fait le prix,
        plafonné à {euros(PLATFORM_TIERS[4].monthlyCents)}/mois.
      </p>
    </section>
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
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, color: th.text, margin: '0 0 4px' }}>
        Abonnement Palova
      </h1>
      <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, margin: '0 0 20px' }}>
        Un seul plan tout inclus — le prix dépend du nombre de membres actifs de votre club.
      </p>

      {/* Jauge sur brume bleue */}
      <MemberGauge count={billing.activeMembers} countedAt={billing.countedAt} />

      {/* Grille des paliers de prix */}
      <TierPricingRow observedTier={billing.observedTier} subscribedTier={sub ? sub.tier : null} />

      {/* État + actions */}
      <section style={{ ...card, borderLeft: needsAction ? '4px solid #e8804f' : `1px solid ${th.line}` }}>
        <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>
          {STATE_LABEL[billing.state]}
        </div>

        {sub && (
          <div style={{ marginTop: 8, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
            {sub.tierLabel} · {sub.interval === 'year' ? 'annuel' : 'mensuel'} · {euros(sub.priceCents)} HT
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
                Souscrire — mensuel · {euros(billing.monthlyPriceCents)} HT
              </button>
              <button style={{ ...btn, background: 'transparent', color: th.accent, border: `1.5px solid ${th.accent}` }}
                disabled={busy !== null} onClick={() => go('checkout-year')}>
                Souscrire — annuel −15 % · {euros(billing.yearlyPriceCents)} HT
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
