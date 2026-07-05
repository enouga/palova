'use client';
import Link from 'next/link';
import { ClubPresentation, assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { cardStyle } from '@/components/clubhouse/SectionHeader';

// Carte éditoriale « Le club » du Club-house : cover avec nom en surimpression,
// extrait de présentation, 3 miniatures → /club. (Le titre de section vit dans ClubHouse.)
export function ClubPresentationCard({ presentation, clubName }: { presentation: ClubPresentation; clubName: string }) {
  const { th } = useTheme();
  if (!presentation.presentationText && presentation.photos.length === 0) return null;
  const cover = assetUrl(presentation.coverImageUrl);
  return (
    <Link href="/club" style={{ ...cardStyle(th), textDecoration: 'none', display: 'block', overflow: 'hidden' }}>
      {cover && (
        <div style={{ position: 'relative' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover} alt="" style={{ width: '100%', height: 180, objectFit: 'cover', display: 'block' }} />
          <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(transparent 30%, rgba(18,22,30,0.72))' }} />
          <div style={{ position: 'absolute', left: 16, right: 16, bottom: 12, fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 22, letterSpacing: -0.3, color: '#fff' }}>
            {clubName}
          </div>
        </div>
      )}
      <div style={{ padding: '14px 16px 16px' }}>
        {!cover && <div style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 19, color: th.text }}>{clubName}</div>}
        {presentation.presentationText && (
          <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: cover ? 0 : 6, marginBottom: 0, lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {presentation.presentationText}
          </p>
        )}
        {presentation.photos.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            {presentation.photos.slice(0, 3).map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.id} src={assetUrl(p.url) ?? ''} alt={p.caption ?? ''} style={{ width: 76, height: 56, objectFit: 'cover', borderRadius: 10 }} />
            ))}
          </div>
        )}
        <span style={{ display: 'inline-block', marginTop: 12, fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.accent }}>Découvrir le club →</span>
      </div>
    </Link>
  );
}
