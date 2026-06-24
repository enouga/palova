'use client';
import { assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { coverGradient, coverInitials } from '@/lib/clubCover';

export type CoverClub = {
  name: string;
  slug: string;
  accentColor: string;
  coverImageUrl: string | null;
  sportIcons?: (string | null)[];
};

// Couverture d'un club pour les cartes d'annuaire : photo importée (<img>) ou, à défaut,
// illustration générée déterministe — dégradé doux dérivé de la couleur d'accent + slug
// (halo clair + vignette), initiales du club et emoji du sport en filigrane discret.
export function ClubCover({ club, height = 104 }: { club: CoverClub; height?: number }) {
  const { th } = useTheme();
  const src = assetUrl(club.coverImageUrl);

  if (src) {
    return (
      <div data-testid="club-cover" style={{ position: 'relative', height, overflow: 'hidden' }}>
        <img src={src} alt={`Couverture ${club.name}`}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>
    );
  }

  const { angle, from, to, tint } = coverGradient(club.slug, club.accentColor);
  const sportIcon = (club.sportIcons ?? []).find(Boolean) ?? null;
  return (
    <div data-testid="club-cover" style={{
      position: 'relative', height, overflow: 'hidden',
      // halo lumineux en haut-gauche + vignette douce en bas-droite, sur le dégradé d'accent.
      backgroundImage: `radial-gradient(120% 90% at 14% 0%, ${tint}cc 0%, ${tint}00 55%), `
        + `radial-gradient(120% 110% at 100% 110%, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0) 60%), `
        + `linear-gradient(${angle}deg, ${from}, ${to})`,
    }}>
      {sportIcon && (
        <span aria-hidden="true" style={{ position: 'absolute', right: 12, top: 9, fontSize: 22, opacity: 0.32 }}>{sportIcon}</span>
      )}
      <span style={{ position: 'absolute', left: 15, bottom: 7, fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 34, color: '#ffffff', opacity: 0.9, letterSpacing: -1, textShadow: '0 1px 12px rgba(0,0,0,0.22)' }}>
        {coverInitials(club.name)}
      </span>
    </div>
  );
}
