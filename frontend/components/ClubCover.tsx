'use client';
import { useState } from 'react';
import { assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { coverBackground, coverInitials, coverPhoto } from '@/lib/clubCover';

export type CoverClub = {
  name: string;
  slug: string;
  accentColor: string;
  coverImageUrl: string | null;
};

// Couverture d'un club pour les cartes d'annuaire. Ordre de préférence :
//  1. photo importée par le club (coverImageUrl) ;
//  2. à défaut, une belle photo de court de la banque par défaut (déterministe par slug) ;
//  3. repli si l'image ne charge pas : « mesh gradient » dérivé de la couleur d'accent + initiales.
export function ClubCover({ club, height = 104 }: { club: CoverClub; height?: number }) {
  const { th } = useTheme();
  const [photoFailed, setPhotoFailed] = useState(false);

  const uploaded = assetUrl(club.coverImageUrl);
  const src = uploaded ?? (photoFailed ? null : coverPhoto(club.slug));

  if (src) {
    return (
      <div data-testid="club-cover" style={{ position: 'relative', height, overflow: 'hidden' }}>
        <img src={src} alt={`Couverture ${club.name}`}
          onError={uploaded ? undefined : () => setPhotoFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        {/* léger voile bas pour asseoir la photo dans la carte */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.18), rgba(0,0,0,0) 45%)', pointerEvents: 'none' }} />
      </div>
    );
  }

  // Repli : illustration générée (mesh gradient + initiales).
  return (
    <div data-testid="club-cover" style={{
      position: 'relative', height, overflow: 'hidden',
      backgroundImage: coverBackground(club.slug, club.accentColor),
    }}>
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
