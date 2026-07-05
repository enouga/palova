'use client';
import { useEffect, useState } from 'react';
import { api, ClubPresentation, assetUrl } from '@/lib/api';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { ClubNav } from '@/components/ClubNav';

// Page publique « Le club » : présentation longue, galerie photos (lightbox), infos pratiques.
export default function ClubPage() {
  const { th } = useTheme();
  const { club, slug } = useClub();
  const [pres, setPres] = useState<ClubPresentation | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => { if (slug) api.getClubPresentation(slug).then(setPres).catch(() => setPres(null)); }, [slug]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  if (!club) return null;
  const mapsHref = pres?.latitude != null && pres?.longitude != null
    ? `https://www.google.com/maps/search/?api=1&query=${pres.latitude},${pres.longitude}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${club.address} ${club.city ?? ''}`)}`;

  return (
    <div style={{ minHeight: '100vh', background: th.bg }}>
      <ClubNav club={club} />
      {pres?.coverImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={assetUrl(pres.coverImageUrl) ?? ''} alt="" style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }} />
      )}
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '22px 20px 60px' }}>
        <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 26, color: th.text, margin: 0 }}>{club.name}</h1>
        {pres?.presentationText && (
          <div style={{ marginTop: 14 }}>
            {pres.presentationText.split(/\n{2,}/).map((para, i) => (
              <p key={i} style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.text, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{para}</p>
            ))}
          </div>
        )}

        {pres && pres.photos.length > 0 && (
          <section style={{ marginTop: 26 }}>
            <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 12 }}>Galerie</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
              {pres.photos.map((p) => (
                <button key={p.id} onClick={() => setLightbox(assetUrl(p.url))} aria-label={p.caption ?? 'Photo du club'} style={{ border: 'none', padding: 0, cursor: 'zoom-in', borderRadius: 10, overflow: 'hidden', background: th.surface2 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={assetUrl(p.url) ?? ''} alt={p.caption ?? ''} style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
                </button>
              ))}
            </div>
          </section>
        )}

        <section style={{ marginTop: 26, background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
          <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 10 }}>Infos pratiques</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
            <div>{club.address}{club.city ? `, ${club.city}` : ''} — <a href={mapsHref} target="_blank" rel="noreferrer" style={{ color: th.accent, fontWeight: 700 }}>Itinéraire →</a></div>
            {pres?.openingHoursText && <div>{pres.openingHoursText}</div>}
            {pres?.contactPhone && <a href={`tel:${pres.contactPhone}`} style={{ color: th.accent }}>{pres.contactPhone}</a>}
            {pres?.contactEmail && <a href={`mailto:${pres.contactEmail}`} style={{ color: th.accent }}>{pres.contactEmail}</a>}
          </div>
        </section>
      </main>

      {lightbox && (
        <div role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'zoom-out' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="Photo du club" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 12 }} />
        </div>
      )}
    </div>
  );
}
