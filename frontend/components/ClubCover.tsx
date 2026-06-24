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
  logoUrl?: string | null;
};

// Couverture d'un club : photo importée (<img>) ou illustration générée déterministe
// (dégradé accent + lignes de court + emoji sport + initiales). variant=card (annuaire)
// ou banner (en-tête de page club, avec logo + nom superposés).
export function ClubCover({ club, variant }: { club: CoverClub; variant: 'card' | 'banner' }) {
  const { th } = useTheme();
  const height = variant === 'banner' ? 160 : 104;
  const src = assetUrl(club.coverImageUrl);

  if (src) {
    return (
      <div data-testid="club-cover" style={{ position: 'relative', height, overflow: 'hidden' }}>
        <img src={src} alt={`Couverture ${club.name}`}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        {variant === 'banner' && <BannerOverlay club={club} />}
      </div>
    );
  }

  const { angle, from, to } = coverGradient(club.slug, club.accentColor);
  const sportIcon = (club.sportIcons ?? []).find(Boolean) ?? null;
  return (
    <div data-testid="club-cover" style={{
      position: 'relative', height, overflow: 'hidden',
      background: `linear-gradient(${angle}deg, ${from}, ${to})`,
    }}>
      <svg viewBox="0 0 200 120" preserveAspectRatio="none" aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.16 }}>
        <g fill="none" stroke="#ffffff" strokeWidth="1.5">
          <rect x="14" y="10" width="172" height="100" />
          <line x1="100" y1="10" x2="100" y2="110" />
          <line x1="14" y1="40" x2="186" y2="40" />
          <line x1="14" y1="80" x2="186" y2="80" />
        </g>
      </svg>
      {sportIcon && (
        <span aria-hidden="true" style={{ position: 'absolute', right: 12, bottom: 8, fontSize: variant === 'banner' ? 44 : 30, opacity: 0.5 }}>{sportIcon}</span>
      )}
      {variant === 'card' ? (
        <span style={{ position: 'absolute', left: 14, bottom: 6, fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 34, color: '#ffffff', opacity: 0.92, letterSpacing: -1, textShadow: '0 1px 8px rgba(0,0,0,0.25)' }}>
          {coverInitials(club.name)}
        </span>
      ) : (
        <BannerOverlay club={club} />
      )}
    </div>
  );
}

function BannerOverlay({ club }: { club: CoverClub }) {
  const { th } = useTheme();
  const logo = assetUrl(club.logoUrl ?? null);
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0) 60%)' }} />
      <div style={{ position: 'absolute', left: 16, right: 16, bottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        {logo ? (
          <img src={logo} alt="" style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'contain', background: '#fff', flexShrink: 0 }} />
        ) : (
          <span style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: club.accentColor, color: '#10131a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 20 }}>
            {coverInitials(club.name)}
          </span>
        )}
        <span style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 26, color: '#ffffff', letterSpacing: -0.4, textShadow: '0 1px 10px rgba(0,0,0,0.4)' }}>{club.name}</span>
      </div>
    </>
  );
}
