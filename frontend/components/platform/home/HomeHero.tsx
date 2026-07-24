'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { Icon } from '@/components/ui/Icon';

// Hero « accueil » du joueur connecté — brume bleue (jamais de panneau sombre) : salutation +
// en-tête du tableau de bord. Il ne rejoue PLUS la prochaine réservation (elle vit dans
// « À venir ») et ne porte pas la promesse de recherche : la pilule de recherche
// (LocationSearchPill, cf. DiscoverSections) est rendue JUSTE après ce hero et flotte sur son
// bord bas via sa marge négative propre — d'où le padding bas généreux.
// Géométrie alignée sur le hero du visiteur (`VisitorHero`) : même rayon 26, même respiration
// haut/bas, pour que le connecté ne se retrouve pas avec un bandeau écrasé.
// (Toujours utilisé aussi par l'archive `components/legacy/MonPalova`, avec DiscoverPill.)
export function HomeHero({ firstName }: { firstName: string | null }) {
  const { th } = useTheme();
  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 26, background: HERO_GRADIENT, padding: '34px 26px 58px', color: HERO_INK }}>
      {/* Profondeur douce + filigrane balle : remplissent le côté droit sans surcharger. */}
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 90% at 88% 8%, rgba(255,255,255,0.5), transparent 55%)', pointerEvents: 'none' }} />
      <div aria-hidden style={{ position: 'absolute', right: -18, bottom: -34, opacity: 0.07, pointerEvents: 'none' }}>
        <Icon name="ball" size={178} color={HERO_INK} />
      </div>

      <div style={{ position: 'relative' }}>
        <div style={{ fontFamily: th.fontBrand, fontSize: 14, letterSpacing: 2.8, textTransform: 'uppercase', color: HERO_INK_MUTED }}>
          {firstName ? `Bonjour ${firstName}` : 'Bonjour'}
        </div>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 'clamp(25px, 6.4vw, 34px)', letterSpacing: -0.8, marginTop: 10, lineHeight: 1.08 }}>
          Prêt à jouer&nbsp;?
        </div>
        <div style={{ fontFamily: th.fontUI, fontSize: 14.5, color: HERO_INK_MUTED, marginTop: 7 }}>
          Ton agenda, tes clubs et tes parties — d'un coup d'œil.
        </div>
      </div>
    </div>
  );
}
