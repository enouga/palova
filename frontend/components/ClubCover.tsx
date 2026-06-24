'use client';
import { assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { coverBackground, coverInitials } from '@/lib/clubCover';

export type CoverClub = {
  name: string;
  slug: string;
  accentColor: string;
  coverImageUrl: string | null;
};

// Couverture d'un club pour les cartes d'annuaire : photo importée (<img>) ou, à défaut,
// illustration générée déterministe — « mesh gradient » multicolore dérivé de la couleur
// d'accent + slug, avec les initiales du club en filigrane.
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

  return (
    <div data-testid="club-cover" style={{
      position: 'relative', height, overflow: 'hidden',
      backgroundImage: coverBackground(club.slug, club.accentColor),
    }}>
      {/* léger voile sombre en bas pour asseoir les initiales */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.26), rgba(0,0,0,0) 52%)' }} />
      <span style={{
        position: 'absolute', left: 16, bottom: 9, fontFamily: th.fontDisplay, fontWeight: 800,
        fontSize: 34, color: '#ffffff', opacity: 0.96, letterSpacing: -1, textShadow: '0 1px 16px rgba(0,0,0,0.3)',
      }}>
        {coverInitials(club.name)}
      </span>
    </div>
  );
}
