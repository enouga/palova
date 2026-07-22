'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { Icon } from '@/components/ui/Icon';

// Hero « accueil » de Mon Palova — brume bleue (jamais de panneau sombre) : salutation +
// accroche recherche, comme les heros de la vitrine et de /decouvrir. Il ne rejoue PLUS la
// prochaine réservation (celle-ci vit dans « À venir » → plus de doublon). La pilule de
// recherche (LocationSearchPill) flotte sur le bord bas via sa marge négative propre : elle
// est rendue en frère JUSTE après ce hero (cf. MonPalova) — d'où le padding bas généreux.
export function HomeHero({ firstName }: { firstName: string | null }) {
  const { th } = useTheme();
  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 22, background: HERO_GRADIENT, padding: '24px 26px 44px', color: HERO_INK }}>
      {/* Profondeur douce + filigrane balle : remplissent le côté droit sans surcharger. */}
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 90% at 88% 8%, rgba(255,255,255,0.5), transparent 55%)', pointerEvents: 'none' }} />
      <div aria-hidden style={{ position: 'absolute', right: -18, bottom: -34, opacity: 0.07, pointerEvents: 'none' }}>
        <Icon name="ball" size={178} color={HERO_INK} />
      </div>

      <div style={{ position: 'relative' }}>
        <div style={{ fontFamily: th.fontBrand, fontSize: 13, letterSpacing: 2.5, textTransform: 'uppercase', color: HERO_INK_MUTED }}>
          {firstName ? `Bonjour ${firstName}` : 'Bonjour'}
        </div>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 'clamp(21px, 5.4vw, 28px)', letterSpacing: -0.5, marginTop: 7, lineHeight: 1.12 }}>
          Où veux-tu jouer&nbsp;?
        </div>
        <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: HERO_INK_MUTED, marginTop: 4 }}>
          Un club, un créneau, une partie ouverte — près de chez toi.
        </div>
      </div>
    </div>
  );
}
