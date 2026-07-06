'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { Icon, IconName } from '@/components/ui/Icon';

type Th = ReturnType<typeof useTheme>['th'];

// Panneau B2B de la vitrine palova.fr : pitch éditorial + « aperçu produit » du back-office
// composé en CSS pur (fenêtre blanche flottante — mini planning, encaissé du jour, toast de
// réservation). Fond = dégradé brume bleue signature (le noir déplaisait au user) : la page
// s'ouvre ET se referme sur le motif du hero, encre fixe HERO_INK dans les deux thèmes.
// Icônes du design system teintées ACCENTS (pattern du rail d'offres du Club-house).
const FEATURES: Array<{ icon: IconName; label: string; color: string }> = [
  { icon: 'calendar', label: 'Réservations & planning', color: ACCENTS.blue },
  { icon: 'wallet',   label: 'Caisse & carnets',        color: ACCENTS.apricot },
  { icon: 'trophy',   label: 'Tournois & events',       color: ACCENTS.coral },
  { icon: 'users',    label: 'Membres & abonnements',   color: ACCENTS.violet },
  { icon: 'card',     label: 'Paiement en ligne',       color: ACCENTS.cyan },
  { icon: 'home',     label: 'Votre site club dédié',   color: ACCENTS.emerald },
];

// La fenêtre-mockup est un « screenshot » de l'app — blanche pour ressortir sur le
// dégradé pâle, couleurs fixes dans les deux thèmes (comme le hero brume bleue).
const WIN_BG = '#ffffff';
const WIN_INK = '#181510';
const WIN_MUTE = 'rgba(24,21,14,0.55)';
const WIN_LINE = 'rgba(24,21,14,0.10)';
// Bleu profond (brand-700) : kicker lisible sur le dégradé clair (ACCENTS.blue y est trop pâle).
const KICKER_BLUE = '#3a63a0';

export function ClubPitch() {
  const { th } = useTheme();

  return (
    <div style={{ margin: '46px 20px 0' }}>
      <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 26, background: HERO_GRADIENT, color: HERO_INK, padding: '30px 26px 28px' }}>
        {/* halos de lumière */}
        <span aria-hidden="true" style={{ position: 'absolute', right: -120, top: -140, width: 380, height: 380, borderRadius: '50%', background: `radial-gradient(circle, ${ACCENTS.blue}3a, transparent 62%)` }} />
        <span aria-hidden="true" style={{ position: 'absolute', left: -140, bottom: -180, width: 360, height: 360, borderRadius: '50%', background: `radial-gradient(circle, ${ACCENTS.apricot}30, transparent 62%)` }} />

        <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(272px, 1fr))', gap: '26px 30px', alignItems: 'center' }}>
          {/* ── colonne pitch ── */}
          <div>
            <div style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: KICKER_BLUE }}>
              Pour les clubs
            </div>
            <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 28, letterSpacing: -0.6, margin: '10px 0 0' }}>
              Vous gérez un club ?
            </h2>
            <p style={{ fontFamily: th.fontUI, fontSize: 14.5, lineHeight: 1.55, color: HERO_INK_MUTED, margin: '10px 0 0', maxWidth: 440 }}>
              Palova gère votre quotidien de A à Z — vos membres réservent et paient en ligne,
              vous pilotez tout depuis un seul back-office.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(196px, 1fr))', gap: '10px 14px', marginTop: 20 }}>
              {FEATURES.map((f) => (
                <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span aria-hidden="true" style={{
                    width: 30, height: 30, borderRadius: 9, flexShrink: 0, background: `${f.color}26`,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon name={f.icon} size={16} color={f.color} />
                  </span>
                  <span style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, opacity: 0.92 }}>{f.label}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 24 }}>
              <a href="/offres" style={{ ...cta(th), background: HERO_INK, color: '#f7f5ee' }}>Découvrir Palova pour les clubs →</a>
              <a href="/clubs/new" style={{ ...cta(th), background: '#ffffff', color: HERO_INK }}>Créer mon club</a>
              <a href="/tarifs" style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, color: HERO_INK, opacity: 0.7, textDecoration: 'none' }}>Voir les tarifs →</a>
            </div>
          </div>

          {/* ── colonne aperçu produit (décorative) ── */}
          <div aria-hidden="true" style={{ position: 'relative', padding: '4px 6px 8px', justifySelf: 'center', width: '100%', maxWidth: 340 }}>
            {/* toast posé AU-DESSUS de la fenêtre : le recouvrement (-12px) reste dans le
                padding de la fenêtre (15px) → ne masque jamais son contenu, à toute largeur */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', position: 'relative', zIndex: 1, marginBottom: -12, paddingRight: 2 }}>
              <div style={{
                transform: 'rotate(2.2deg)',
                background: '#ffffff', color: WIN_INK, borderRadius: 14, padding: '9px 13px 9px 10px',
                display: 'flex', alignItems: 'center', gap: 9, boxShadow: '0 10px 28px rgba(24,21,14,0.20)',
              }}>
                <span style={{ width: 27, height: 27, borderRadius: 8, background: `${ACCENTS.emerald}26`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name="check" size={15} color={ACCENTS.emerald} />
                </span>
                <span>
                  <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, lineHeight: 1.2 }}>Nouvelle réservation</span>
                  <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 11, color: WIN_MUTE, lineHeight: 1.3 }}>Court 3 · 18h00 — payée en ligne</span>
                </span>
              </div>
            </div>
            {/* fenêtre planning */}
            <div style={{ background: WIN_BG, color: WIN_INK, borderRadius: 18, padding: '15px 16px 16px', transform: 'rotate(-1.4deg)', boxShadow: '0 16px 42px rgba(24,21,14,0.20), 0 2px 8px rgba(24,21,14,0.10)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700 }}>Planning · aujourd&apos;hui</span>
                <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, background: `${ACCENTS.blue}26`, color: WIN_INK, borderRadius: 999, padding: '3px 9px' }}>14 résas</span>
              </div>

              {/* mini grille terrains × créneaux */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 12 }}>
                {['Court 1', 'Court 2', 'Court 3'].map((c) => (
                  <div key={c} style={{ fontFamily: th.fontUI, fontSize: 10, fontWeight: 700, color: WIN_MUTE, textAlign: 'center' }}>{c}</div>
                ))}
                {([
                  ['solid', 'soft', 'empty'],
                  ['soft', 'solid', 'warm'],
                  ['empty', 'solid', 'soft'],
                ] as const).flatMap((row, ri) => row.map((cell, ci) => (
                  <span key={`${ri}-${ci}`} style={{
                    height: 19, borderRadius: 6, boxSizing: 'border-box',
                    background: cell === 'solid' ? ACCENTS.blue : cell === 'soft' ? `${ACCENTS.blue}2e` : cell === 'warm' ? `${ACCENTS.apricot}59` : 'transparent',
                    border: cell === 'empty' ? `1.5px dashed rgba(24,21,14,0.18)` : 'none',
                  }} />
                )))}
              </div>

              {/* encaissé du jour */}
              <div style={{ borderTop: `1px solid ${WIN_LINE}`, marginTop: 14, paddingTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: th.fontUI, fontSize: 11.5, color: WIN_MUTE, fontWeight: 600 }}>Encaissé aujourd&apos;hui</span>
                  <span style={{ fontFamily: th.fontDisplay, fontSize: 17, fontWeight: 700, letterSpacing: -0.3 }}>420 €</span>
                </div>
                <div style={{ height: 7, borderRadius: 99, background: 'rgba(24,21,14,0.08)', marginTop: 8, overflow: 'hidden' }}>
                  <span style={{ display: 'block', width: '75%', height: '100%', borderRadius: 99, background: ACCENTS.blue }} />
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

function cta(th: Th): React.CSSProperties {
  return { display: 'inline-block', borderRadius: 30, padding: '12px 20px', fontFamily: th.fontUI, fontWeight: 800, fontSize: 14.5, textDecoration: 'none', whiteSpace: 'nowrap' };
}
