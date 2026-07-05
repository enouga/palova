'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { api, PublicOffers, PublicPlan, PublicPackageTemplate } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useClub } from '@/lib/ClubProvider';
import { Icon } from '@/components/ui/Icon';
import { Btn } from '@/components/ui/atoms';

const StripePaymentStep = dynamic(() => import('@/components/StripePaymentStep'), { ssr: false });

const euros = (v: string) => `${Number(v).toFixed(2).replace('.', ',')} €`;

type Target = { kind: 'plan'; plan: PublicPlan } | { kind: 'package'; tpl: PublicPackageTemplate };

// Vitrine des formules : cartes abonnements + carnets, achat en ligne via StripePaymentStep.
export function OffersShowcase({ offers, token, hasActiveSubscription, onAuthPrompt, onPurchased }: {
  offers: PublicOffers;
  token: string | null;
  hasActiveSubscription: boolean;
  onAuthPrompt: () => void;
  onPurchased: () => void;
}) {
  const { th } = useTheme();
  const { slug } = useClub();
  const [target, setTarget] = useState<Target | null>(null);
  const [done, setDone] = useState(false);

  const plans = hasActiveSubscription ? [] : offers.plans;
  if (plans.length === 0 && offers.packages.length === 0) return null;

  const planBenefits = (p: PublicPlan): string[] => [
    p.offPeakOnly ? 'Heures creuses' : 'Toutes heures',
    p.benefit === 'INCLUDED' ? 'Réservations incluses' : `−${p.discountPercent ?? 0} % sur les réservations`,
    ...(p.dailyCap ? [`${p.dailyCap} résa/jour max`] : []),
    ...(p.weeklyCap ? [`${p.weeklyCap} résa/sem. max`] : []),
    `Engagement ${p.commitmentMonths} mois`,
  ];

  const buy = (t: Target) => {
    if (!token) { onAuthPrompt(); return; }
    setDone(false);
    setTarget(t);
  };

  const amountLabel = target?.kind === 'plan'
    ? `1re mensualité · ${euros(target.plan.monthlyPrice)}`
    : target ? euros(target.tpl.price) : '';

  const cardStyle = { background: th.surface2, borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column' as const, gap: 8 };

  return (
    <section style={{ background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <Icon name="wallet" size={15} color={th.accent} />
        <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 12.5, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute }}>Abonnements &amp; offres</span>
      </div>
      <style>{`.of-grid{display:grid;grid-template-columns:1fr;gap:10px}@media(min-width:600px){.of-grid{grid-template-columns:1fr 1fr}}`}</style>
      <div className="of-grid">
        {plans.map((p) => (
          <div key={p.id} style={cardStyle}>
            <div style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 17, color: th.text }}>{p.name}</div>
            <div style={{ fontFamily: th.fontUI, fontSize: 15, fontWeight: 800, color: th.accent }}>{euros(p.monthlyPrice)} / mois</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, lineHeight: 1.7 }}>
              {planBenefits(p).map((b) => <li key={b}>{b}</li>)}
            </ul>
            {offers.onlinePurchase
              ? <Btn onClick={() => buy({ kind: 'plan', plan: p })}>Souscrire</Btn>
              : <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>Renseignez-vous à l&rsquo;accueil du club</span>}
          </div>
        ))}
        {offers.packages.map((t) => (
          <div key={t.id} style={cardStyle}>
            <div style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 17, color: th.text }}>{t.name}</div>
            <div style={{ fontFamily: th.fontUI, fontSize: 15, fontWeight: 800, color: th.accent }}>{euros(t.price)}</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, lineHeight: 1.7 }}>
              <li>{t.kind === 'ENTRIES' ? `${t.entriesCount} entrées` : `${euros(t.walletAmount ?? '0')} crédités`}</li>
              {t.validityDays ? <li>Valable {t.validityDays} jours</li> : <li>Sans expiration</li>}
            </ul>
            {offers.onlinePurchase
              ? <Btn onClick={() => buy({ kind: 'package', tpl: t })}>Souscrire</Btn>
              : <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>Renseignez-vous à l&rsquo;accueil du club</span>}
          </div>
        ))}
      </div>

      {target && token && (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: th.bgElev, borderRadius: '18px 18px 0 0', padding: 20, width: '100%', maxWidth: 520 }}>
            {done ? (
              <div style={{ textAlign: 'center', fontFamily: th.fontUI }}>
                <div style={{ fontSize: 30 }}>✓</div>
                <div style={{ fontWeight: 700, fontSize: 16, color: th.text, marginTop: 6 }}>C&rsquo;est fait !</div>
                <p style={{ fontSize: 13.5, color: th.textMute }}>Votre {target.kind === 'plan' ? 'abonnement est actif' : 'solde est disponible'} — retrouvez-le dans votre profil.</p>
                <Btn onClick={() => { setTarget(null); onPurchased(); }}>Fermer</Btn>
              </div>
            ) : (
              <StripePaymentStep
                type="payment"
                amountLabel={amountLabel}
                createIntent={async () => {
                  const r = target.kind === 'plan'
                    ? await api.createOfferPlanIntent(slug ?? '', target.plan.id, token)
                    : await api.createOfferPackageIntent(slug ?? '', target.tpl.id, token);
                  return { clientSecret: r.clientSecret, stripeAccountId: r.stripeAccountId ?? null, customerSessionClientSecret: r.customerSessionClientSecret ?? null };
                }}
                confirm={async (ids) => {
                  if (ids.stripePaymentIntentId) await api.confirmOfferPayment(slug ?? '', ids.stripePaymentIntentId, token);
                }}
                onSuccess={() => setDone(true)}
                onCancel={() => setTarget(null)}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
