'use client';
import Link from 'next/link';
import { ClubPresentation, assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';

// Teaser « Le club » du Club-house : cover, extrait de présentation, 3 miniatures → /club.
export function ClubPresentationCard({ presentation, clubName }: { presentation: ClubPresentation; clubName: string }) {
  const { th } = useTheme();
  if (!presentation.presentationText && presentation.photos.length === 0) return null;
  const cover = assetUrl(presentation.coverImageUrl);
  return (
    <Link href="/club" style={{ textDecoration: 'none', display: 'block', background: th.surface, borderRadius: 16, overflow: 'hidden', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="" style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block' }} />
      )}
      <div style={{ padding: '14px 16px' }}>
        <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 12.5, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 6 }}>Le club</div>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 19, color: th.text }}>{clubName}</div>
        {presentation.presentationText && (
          <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 6, lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {presentation.presentationText}
          </p>
        )}
        {presentation.photos.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            {presentation.photos.slice(0, 3).map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.id} src={assetUrl(p.url) ?? ''} alt={p.caption ?? ''} style={{ width: 72, height: 54, objectFit: 'cover', borderRadius: 8 }} />
            ))}
          </div>
        )}
        <span style={{ display: 'inline-block', marginTop: 10, fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.accent }}>Découvrir le club →</span>
      </div>
    </Link>
  );
}
