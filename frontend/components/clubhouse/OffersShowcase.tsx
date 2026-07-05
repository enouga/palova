'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { api, PublicOffers, PublicPlan, PublicPackageTemplate } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useClub } from '@/lib/ClubProvider';
import { ACCENTS } from '@/lib/theme';
import { Btn } from '@/components/ui/atoms';
import { SectionHeader, cardStyle } from '@/components/clubhouse/SectionHeader';

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

  // Chaque carte du rail prend une teinte de la palette (cycle par position) : lavis en
  // tête, chip de type et CTA assortis — de la couleur sans casser le fond clair.
  const OFFER_TINTS = [ACCENTS.blue, ACCENTS.apricot, ACCENTS.emerald, ACCENTS.violet, ACCENTS.cyan];

  // Carte compacte du rail : prix en chiffre vedette, bénéfices en 2 lignes, CTA fin.
  const OfferCard = ({ name, price, suffix, lines, kindLabel, tint, onBuy }: {
    name: string; price: string; suffix: string | null; lines: string[]; kindLabel: string; tint: string; onBuy: () => void;
  }) => (
    <div className="of-card" style={{ ...cardStyle(th), flex: '0 0 236px', scrollSnapAlign: 'start', padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 4, position: 'relative', overflow: 'hidden' }}>
      <span aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 72, background: `linear-gradient(180deg, ${tint}${th.mode === 'floodlit' ? '26' : '33'}, transparent)`, pointerEvents: 'none' }} />
      <span aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: tint }} />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', borderRadius: 999, padding: '3px 8px', background: th.mode === 'floodlit' ? `${tint}26` : `${tint}40`, color: th.mode === 'floodlit' ? tint : th.ink }}>
          {kindLabel}
        </span>
      </div>
      <div style={{ position: 'relative', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5, color: th.text, marginTop: 6 }}>{name}</div>
      <div style={{ position: 'relative', fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 27, letterSpacing: -0.5, color: th.text }}>
        <span>{price}</span>{suffix && <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute, letterSpacing: 0 }}> {suffix}</span>}
      </div>
      <div style={{ position: 'relative', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, lineHeight: 1.55, flex: 1 }}>
        {lines.join(' · ')}
      </div>
      {offers.onlinePurchase ? (
        <button onClick={onBuy} style={{
          marginTop: 10, border: `1.5px solid ${tint}`, background: 'transparent', color: th.mode === 'floodlit' ? tint : th.ink,
          borderRadius: 10, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, cursor: 'pointer',
        }}>
          Souscrire
        </button>
      ) : (
        <span style={{ marginTop: 10, fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>Renseignez-vous à l&rsquo;accueil du club</span>
      )}
    </div>
  );

  return (
    <section>
      <SectionHeader title="Abonnements & offres" />
      <style>{`.of-card{transition:transform .18s ease}.of-card:hover{transform:translateY(-3px)}`}</style>
      <div className="sp-scroll-x" style={{ display: 'flex', gap: 12, margin: '0 -20px', padding: '4px 20px 14px', scrollSnapType: 'x mandatory' }}>
        {plans.map((p, i) => (
          <OfferCard key={p.id} name={p.name} price={euros(p.monthlyPrice)} suffix="/ mois"
            kindLabel="Abonnement" tint={OFFER_TINTS[i % OFFER_TINTS.length]}
            lines={planBenefits(p)} onBuy={() => buy({ kind: 'plan', plan: p })} />
        ))}
        {offers.packages.map((t, i) => (
          <OfferCard key={t.id} name={t.name} price={euros(t.price)} suffix={null}
            kindLabel={t.kind === 'ENTRIES' ? 'Carnet' : 'Porte-monnaie'}
            tint={OFFER_TINTS[(plans.length + i) % OFFER_TINTS.length]}
            lines={[
              t.kind === 'ENTRIES' ? `${t.entriesCount} entrées` : `${euros(t.walletAmount ?? '0')} crédités`,
              t.validityDays ? `Valable ${t.validityDays} jours` : 'Sans expiration',
            ]}
            onBuy={() => buy({ kind: 'package', tpl: t })} />
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
