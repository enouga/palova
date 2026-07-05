'use client';
import { useEffect, useState } from 'react';
import { Announcement, AnnouncementKind, assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { posterLayout } from '@/lib/clubhouse';
import { Icon } from '@/components/ui/Icon';

const KIND_LABEL: Partial<Record<AnnouncementKind, string>> = {
  OFFER: 'Offre', TOURNAMENT: 'Tournoi', EVENT: 'Event',
};

// Mosaïque « À l'affiche » : visuels uploadés par le club (bento), clic → lightbox plein écran.
export function PosterMosaic({ posters }: { posters: Announcement[] }) {
  const { th } = useTheme();
  const [open, setOpen] = useState<Announcement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (posters.length === 0) return null;
  const layout = posterLayout(posters.length);

  const tile = (a: Announcement, big: boolean) => (
    <button key={a.id} onClick={() => setOpen(a)} aria-label={a.title} style={{
      border: 'none', cursor: 'pointer', padding: 0, position: 'relative', overflow: 'hidden',
      borderRadius: 14, background: th.surface2, textAlign: 'left', width: '100%',
      minHeight: big ? 220 : 106, gridRow: big ? 'span 2' : undefined, display: 'block',
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={assetUrl(a.imageUrl) ?? ''} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '22px 12px 10px', background: 'linear-gradient(transparent, rgba(0,0,0,0.72))' }}>
        {KIND_LABEL[a.kind] && (
          <span style={{ display: 'inline-block', fontFamily: th.fontUI, fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: '#fff', background: 'rgba(255,255,255,0.22)', borderRadius: 99, padding: '2px 8px', marginBottom: 4 }}>
            {KIND_LABEL[a.kind]}
          </span>
        )}
        <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: big ? 15 : 12.5, fontWeight: 700, color: '#fff' }}>{a.title}</span>
      </span>
    </button>
  );

  return (
    <section>
      <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 7 }}>
        <Icon name="bolt" size={15} color={th.accentWarm} /> À l&apos;affiche
      </div>
      <div data-testid="poster-grid" data-layout={layout} style={{
        display: 'grid', gap: 8,
        gridTemplateColumns: layout === 'single' ? '1fr' : layout === 'duo' ? '1fr 1fr' : '1.6fr 1fr',
        gridAutoRows: layout === 'bento' ? '106px' : undefined,
      }}>
        {layout === 'bento'
          ? [tile(posters[0], true), ...posters.slice(1).map((a) => tile(a, false))]
          : posters.map((a) => tile(a, layout === 'single'))}
      </div>

      {open && (
        <div role="dialog" aria-modal="true" aria-label={open.title} onClick={() => setOpen(null)} style={{
          position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.85)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'zoom-out',
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assetUrl(open.imageUrl) ?? ''} alt={open.title} onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '100%', maxHeight: '72vh', borderRadius: 12, cursor: 'default' }} />
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, marginTop: 14, textAlign: 'center', cursor: 'default' }}>
            <div style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 18, color: '#fff' }}>{open.title}</div>
            {open.body && <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: 'rgba(255,255,255,0.8)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{open.body}</p>}
            {open.linkUrl && (
              <a href={open.linkUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 10, fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, color: '#fff', textDecoration: 'underline' }}>
                En savoir plus →
              </a>
            )}
          </div>
          <button onClick={() => setOpen(null)} aria-label="Fermer" style={{ position: 'absolute', top: 16, right: 16, border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', width: 36, height: 36, borderRadius: 99, fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
      )}
    </section>
  );
}
