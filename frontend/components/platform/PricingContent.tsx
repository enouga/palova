'use client';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { eurosCompact as euros } from '@/lib/payments';
import { Icon, IconName } from '@/components/ui/Icon';
import { PLATFORM_TIERS, tierLabel } from '@/lib/platformTiers';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';

/** Plage courte d'un palier : « 0 – 50 », « 801+ »… */
function tierRange(tier: number): string {
  return tierLabel(tier).replace(' membres actifs', '');
}

/** En-tête éditorial de section : tiret accent + kicker + titre display. */
function Section({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  const { th } = useTheme();
  return (
    <section style={{ marginTop: 46 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span aria-hidden style={{ width: 22, height: 3, borderRadius: 2, background: th.accent }} />
        <span style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 800, letterSpacing: 1.1, textTransform: 'uppercase', color: th.textMute }}>
          {kicker}
        </span>
      </div>
      <h2 style={{ fontFamily: th.fontDisplay, fontSize: 25, fontWeight: 600, letterSpacing: -0.4, color: th.text, margin: '8px 0 14px' }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

const FEATURES: Array<{ icon: IconName; label: string }> = [
  { icon: 'calendar', label: 'Réservations en ligne' },
  { icon: 'home',     label: 'Page club brandée + app installable (PWA)' },
  { icon: 'users',    label: 'Membres, abonnements & carnets' },
  { icon: 'trophy',   label: 'Tournois & événements' },
  { icon: 'euro',     label: 'Caisse & comptabilité' },
  { icon: 'card',     label: 'Paiement en ligne (0 % de commission)' },
  { icon: 'ball',     label: 'Multi-sports' },
  { icon: 'mail',     label: 'Emails automatiques personnalisables' },
  { icon: 'chart',    label: 'Statistiques du club' },
];

const ACCENT_CYCLE = [ACCENTS.blue, ACCENTS.emerald, ACCENTS.coral, ACCENTS.violet, ACCENTS.apricot, ACCENTS.cyan];

const STRIPE_STEPS: Array<{ title: string; body: string }> = [
  {
    title: 'Votre club connecte SON compte Stripe',
    body: 'Création guidée en quelques minutes depuis votre espace d\'administration. Le compte est au nom de votre club — c\'est votre argent, votre compte.',
  },
  {
    title: 'Vos adhérents paient en ligne',
    body: 'Réservations, inscriptions aux tournois, formules : chaque paiement arrive directement sur le compte Stripe de votre club. Les fonds ne transitent jamais par Palova.',
  },
  {
    title: 'Stripe vire sur votre compte bancaire',
    body: 'Virements automatiques au rythme que vous choisissez, suivi complet depuis votre tableau de bord Stripe.',
  },
];

const NO_FEES: Array<{ label: string; value: string }> = [
  { label: 'Frais d\'installation ou de mise en service', value: '0 €' },
  { label: 'Commission Palova sur vos encaissements', value: '0 %' },
  { label: 'Coût par terrain, par réservation ou par sport', value: '0 €' },
  { label: 'Options ou modules payants', value: 'Aucun' },
  { label: 'Engagement de durée (formule mensuelle)', value: 'Aucun' },
];

export function PricingContent() {
  const { th } = useTheme();

  const card: CSSProperties = {
    background: th.bgElev, border: `1px solid ${th.line}`, borderRadius: 14, padding: '16px 18px',
  };
  const chip: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: 'rgba(255,255,255,0.55)', color: HERO_INK, borderRadius: 999,
    padding: '6px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700,
  };

  return (
    <div>
      {/* ---- Hero brume bleue ---- */}
      <section style={{ background: HERO_GRADIENT, borderRadius: 20, padding: '30px 26px 26px' }}>
        <div style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: HERO_INK_MUTED }}>
          Tarifs
        </div>
        <h1 style={{ fontFamily: th.fontDisplay, fontSize: 36, fontWeight: 700, letterSpacing: -0.8, color: HERO_INK, margin: '8px 0 10px', lineHeight: 1.08 }}>
          Un seul plan. Tout inclus.
        </h1>
        <p style={{ fontFamily: th.fontUI, fontSize: 15, color: HERO_INK_MUTED, margin: 0, maxWidth: 560, lineHeight: 1.5 }}>
          Le prix dépend d&apos;une seule chose : le nombre de{' '}
          <strong style={{ color: HERO_INK }}>membres actifs</strong>{' '}
          de votre club. Jamais d&apos;options payantes, jamais de commission, jamais plus
          de {euros(PLATFORM_TIERS[4].monthlyCents)} HT/mois.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          <span style={chip}><Icon name="check" size={13} color={ACCENTS.emerald} /> 0 % de commission</span>
          <span style={chip}><Icon name="check" size={13} color={ACCENTS.emerald} /> Toutes les fonctionnalités, pour tous</span>
          <span style={chip}><Icon name="check" size={13} color={ACCENTS.emerald} /> Sans engagement</span>
        </div>
      </section>

      {/* ---- Grille des paliers ---- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))', gap: 10, marginTop: 18 }}>
        {PLATFORM_TIERS.map((t) => {
          const free = t.monthlyCents === 0;
          return (
            <div key={t.tier} style={{
              background: th.bgElev, borderRadius: 14, padding: '16px 14px 13px', textAlign: 'center',
              border: `1px solid ${free ? 'transparent' : th.line}`,
              boxShadow: free ? `0 0 0 2px ${th.accent}` : undefined,
              position: 'relative',
            }}>
              {free && (
                <div style={{
                  position: 'absolute', top: -9, left: '50%', transform: 'translateX(-50%)',
                  background: th.accent, color: '#fff', fontFamily: th.fontUI, fontSize: 10.5,
                  fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase',
                  padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap',
                }}>
                  Pour démarrer
                </div>
              )}
              <div style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.textMute, marginTop: 2 }}>
                {tierRange(t.tier)}
              </div>
              <div style={{ fontFamily: th.fontUI, fontSize: 10.5, color: th.textFaint, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                membres actifs
              </div>
              <div style={{
                fontFamily: th.fontDisplay, fontSize: 26, fontWeight: 700, letterSpacing: -0.4,
                color: free ? th.accent : th.text, marginTop: 8, lineHeight: 1.05,
              }}>
                {free ? 'Gratuit' : euros(t.monthlyCents)}
              </div>
              <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, marginTop: 3, lineHeight: 1.45 }}>
                {free ? 'pour toujours' : <>/ mois HT<br />{euros(t.yearlyCents)} /an (−15 %)</>}
              </div>
            </div>
          );
        })}
      </div>
      <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint, margin: '10px 2px 0' }}>
        Prix HT. Palier plafonné : au-delà de 800 membres actifs, le prix ne bouge plus. Multi-club / franchise : contactez-nous.
      </p>

      {/* ---- Membre actif ---- */}
      <Section kicker="Le compteur" title="Comment est calculé votre prix ?">
        <div style={card}>
          <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.text, margin: 0, lineHeight: 1.55 }}>
            Un <strong>membre actif</strong> est un joueur qui a réservé un terrain, participé à un tournoi, un événement
            ou un cours, ou acheté une formule dans les <strong>90 derniers jours</strong>. Pas de déclaration à faire :
            le compteur est calculé automatiquement et visible en permanence dans votre espace d&apos;administration.
          </p>
          <ul style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, margin: '12px 0 0', paddingLeft: 20, lineHeight: 1.7 }}>
            <li>Le palier <strong>monte</strong> seulement après <strong>deux mois consécutifs</strong> au-dessus du seuil — un pic ponctuel ne change rien.</li>
            <li>Il <strong>redescend dès le premier mois</strong> en dessous.</li>
            <li><strong>Aucun prorata</strong> : le prix de la période en cours ne change jamais, tout ajustement prend effet à la facture suivante.</li>
            <li>Vous êtes prévenu par email avant tout changement de palier.</li>
          </ul>
        </div>
      </Section>

      {/* ---- Tout inclus ---- */}
      <Section kicker="Sans restriction" title="Tout est inclus, pour tous les comptes">
        <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: '0 0 14px', lineHeight: 1.55 }}>
          <strong style={{ color: th.text }}>Aucune fonctionnalité n&apos;est verrouillée derrière un palier.</strong>{' '}
          Le club de 30 joueurs a exactement le même produit que celui de 1 000 — seule la taille fait le prix.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 8 }}>
          {FEATURES.map((f, i) => {
            const color = ACCENT_CYCLE[i % ACCENT_CYCLE.length];
            return (
              <div key={f.label} style={{ ...card, display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px' }}>
                <span style={{
                  width: 32, height: 32, borderRadius: 9, background: `${color}22`,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <Icon name={f.icon} size={16} color={color} />
                </span>
                <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text, lineHeight: 1.35 }}>
                  {f.label}
                </span>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ---- Stripe ---- */}
      <Section kicker="Vos encaissements" title="Stripe, en direct : votre argent va à votre club">
        <div style={{ display: 'grid', gap: 10 }}>
          {STRIPE_STEPS.map((s, i) => (
            <div key={s.title} style={{ ...card, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <span style={{
                width: 30, height: 30, borderRadius: '50%', background: ACCENTS.blue, color: '#fff',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: th.fontDisplay, fontSize: 15, fontWeight: 700, flexShrink: 0, marginTop: 2,
              }}>{i + 1}</span>
              <div>
                <div style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, color: th.text }}>{s.title}</div>
                <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 4, lineHeight: 1.55 }}>{s.body}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{
          marginTop: 12, borderRadius: 14, padding: '14px 18px',
          background: `${ACCENTS.emerald}18`, border: `1px solid ${ACCENTS.emerald}55`,
        }}>
          <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.text, lineHeight: 1.6 }}>
            <strong>Palova ne touche jamais votre argent et ne prélève aucune commission.</strong>{' '}
            Seuls les frais bancaires standard de Stripe s&apos;appliquent aux paiements en ligne — facturés par Stripe,
            au tarif public Stripe, sans la moindre majoration Palova. Le paiement en ligne reste optionnel :
            la caisse au comptoir fonctionne sans Stripe.
          </div>
        </div>
      </Section>

      {/* ---- Zéro frais caché ---- */}
      <Section kicker="Transparence" title="Zéro frais caché">
        <div style={{ ...card, padding: '6px 18px' }}>
          {NO_FEES.map((row) => (
            <div key={row.label} style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 14,
              padding: '11px 0', borderBottom: `1px solid ${th.line}`,
            }}>
              <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>{row.label}</span>
              <span style={{ fontFamily: th.fontDisplay, fontSize: 17, fontWeight: 700, color: ACCENTS.emerald, whiteSpace: 'nowrap' }}>
                {row.value}
              </span>
            </div>
          ))}
          <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint, margin: 0, padding: '11px 0', lineHeight: 1.55 }}>
            Le seul coût Palova : votre palier mensuel (ou annuel, −15 %). Votre abonnement se règle par carte,
            vos factures sont téléchargeables à tout moment, et l&apos;annulation se fait en deux clics, effective à échéance.
          </p>
        </div>
      </Section>

      {/* ---- CTA ---- */}
      <section style={{
        marginTop: 46, background: HERO_GRADIENT, borderRadius: 20, padding: '28px 26px',
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        <div>
          <div style={{ fontFamily: th.fontDisplay, fontSize: 23, fontWeight: 700, letterSpacing: -0.4, color: HERO_INK }}>
            Prêt à équiper votre club ?
          </div>
          <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: HERO_INK_MUTED, marginTop: 4 }}>
            Gratuit jusqu&apos;à 50 membres actifs — votre club est en ligne en quelques minutes.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/clubs/new" style={{
            background: HERO_INK, color: '#fff', textDecoration: 'none', borderRadius: 11,
            padding: '11px 20px', fontFamily: th.fontUI, fontSize: 14, fontWeight: 700,
          }}>
            Créer mon club
          </Link>
          <a href="mailto:contact@palova.fr" style={{
            background: 'rgba(255,255,255,0.6)', color: HERO_INK, textDecoration: 'none', borderRadius: 11,
            padding: '11px 20px', fontFamily: th.fontUI, fontSize: 14, fontWeight: 700,
          }}>
            contact@palova.fr
          </a>
        </div>
      </section>
    </div>
  );
}
