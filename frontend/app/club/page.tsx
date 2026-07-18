'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ClubPresentation, assetUrl } from '@/lib/api';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, inkOn } from '@/lib/theme';
import { ClubNav } from '@/components/ClubNav';
import { Screen } from '@/components/ui/Screen';
import { Icon } from '@/components/ui/Icon';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { cardStyle } from '@/components/clubhouse/SectionHeader';
import { amenityList, coverUrl, hoursRange, openNowChip, showcaseKicker } from '@/lib/clubShowcase';

// Page publique « Le club » — même langage cinéma que la vitrine du Club-house :
// hero (photo + voile ou brume bleue), récit complet, galerie mosaïque (lightbox),
// équipements, infos pratiques, encart « Envie de jouer ? ».
export default function ClubPage() {
  const { th } = useTheme();
  const { club, slug } = useClub();
  const [pres, setPres] = useState<ClubPresentation | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null); // horloge posée en effet — hydration-safe

  useEffect(() => { setNow(new Date()); }, []);
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

  const cover = pres ? assetUrl(coverUrl(pres)) : null;
  const onPhoto = !!cover;
  const sportNames = (club.clubSports ?? []).map((s) => s.sport.name).join(' · ');
  const kicker = [showcaseKicker(club.city, pres?.foundedYear ?? null), sportNames].filter(Boolean).join(' · ');
  const hours = openNowChip(hoursRange(club.clubSports), club.timezone, now);
  const amenities = amenityList(pres?.amenities);
  // Ne pas répéter la ville si l'adresse la contient déjà (ex. "12 rue du Padel, 75011 Paris").
  const addressLine = club.city && !club.address.toLowerCase().includes(club.city.toLowerCase())
    ? `${club.address}, ${club.city}`
    : club.address;
  const ink = onPhoto ? '#fff' : HERO_INK;

  const glassChip: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 999,
    fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: ink, textDecoration: 'none',
    ...(onPhoto
      ? { background: 'rgba(255,255,255,0.16)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.35)', backdropFilter: 'blur(6px)' }
      : { background: 'rgba(255,255,255,0.55)', boxShadow: 'inset 0 0 0 1.4px rgba(24,21,14,0.14)' }),
  };
  const h5: React.CSSProperties = { fontFamily: th.fontUI, fontWeight: 700, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: th.textFaint, margin: '0 0 10px' };
  const cta: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, background: th.accent, color: inkOn(th.accent), fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, padding: '9px 17px', borderRadius: 999, textDecoration: 'none', boxShadow: `0 6px 16px ${th.accent}73` };

  const paragraphs = pres?.presentationText ? pres.presentationText.split(/\n{2,}/) : [];

  return (
    <Screen>
      <ClubNav club={club} />

      {/* Hero cinéma */}
      <div style={{ position: 'relative', minHeight: 300, display: 'flex', ...(onPhoto ? {} : { background: HERO_GRADIENT }) }}>
        {onPhoto && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cover ?? ''} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(178deg, rgba(10,14,24,0.05) 30%, rgba(10,14,24,0.74) 92%)' }} />
          </>
        )}
        {!onPhoto && (
          <span aria-hidden="true" style={{ position: 'absolute', right: -22, top: -30, opacity: 0.12, pointerEvents: 'none' }}>
            <Icon name="ball" size={190} color={HERO_INK} />
          </span>
        )}
        <div style={{ position: 'relative', zIndex: 2, width: '100%', maxWidth: 900, margin: '0 auto', padding: '80px 20px 24px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          {kicker && <div style={{ fontFamily: th.fontBrand, fontSize: 11.5, letterSpacing: 2.5, textTransform: 'uppercase', color: onPhoto ? '#cfe0f5' : HERO_INK_MUTED }}>{kicker}</div>}
          <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 800, fontSize: 'clamp(28px, 5vw, 36px)', letterSpacing: -0.8, color: ink, margin: '4px 0 12px', textShadow: onPhoto ? '0 2px 18px rgba(0,0,0,0.35)' : 'none' }}>{club.name}</h1>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/reserver" style={cta}>Réserver un terrain →</Link>
            <a href={mapsHref} target="_blank" rel="noreferrer" style={glassChip}><Icon name="pin" size={13} color={ink} />Itinéraire</a>
            {pres?.contactPhone && <a href={`tel:${pres.contactPhone}`} style={glassChip}>{pres.contactPhone}</a>}
          </div>
        </div>
      </div>

      <main style={{ padding: '22px 20px 60px' }}>
        <style>{`
          .cp-grid{display:grid;grid-template-columns:1fr;gap:14px;align-items:start}
          @media(min-width:800px){.cp-grid{grid-template-columns:1.5fr 1fr}}
          .cp-gal{display:grid;grid-template-columns:repeat(2,1fr);grid-auto-rows:96px;gap:8px}
          @media(min-width:640px){.cp-gal{grid-template-columns:repeat(4,1fr)}}
          .cp-gal .big{grid-column:span 2;grid-row:span 2}
        `}</style>
        <div className="cp-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {paragraphs.length > 0 && (
              <section style={{ ...cardStyle(th), padding: '16px 18px' }}>
                <p style={h5}>Le club</p>
                {paragraphs.map((para, i) => (
                  <p key={i} style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.text, lineHeight: 1.65, whiteSpace: 'pre-wrap', margin: i === 0 ? 0 : '10px 0 0' }}>{para}</p>
                ))}
              </section>
            )}

            {pres && pres.photos.length > 0 && (
              <section>
                <p style={{ ...h5, margin: '6px 0 10px' }}>La galerie</p>
                <div className="cp-gal">
                  {pres.photos.map((p, i) => (
                    <button key={p.id} onClick={() => setLightbox(assetUrl(p.url))} aria-label={p.caption ?? 'Photo du club'}
                      className={i === 0 ? 'big' : undefined}
                      style={{ border: 'none', padding: 0, cursor: 'zoom-in', borderRadius: 12, overflow: 'hidden', background: th.surface2 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={assetUrl(p.url) ?? ''} alt={p.caption ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {amenities.length > 0 && (
              <section style={{ ...cardStyle(th), padding: '16px 18px' }}>
                <p style={h5}>Sur place</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                  {amenities.map((a) => (
                    <span key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text }}>
                      <span style={{ width: 34, height: 34, borderRadius: 10, background: `${th.accent}21`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon name={a.icon} size={16} color={th.accent} />
                      </span>
                      {a.label}
                    </span>
                  ))}
                </div>
              </section>
            )}

            <section style={{ ...cardStyle(th), padding: '16px 18px' }}>
              <p style={h5}>Infos pratiques</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
                {!pres?.openingHoursText && hours && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700 }}>
                    <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 99, background: hours.open ? ACCENTS.emerald : th.textFaint, display: 'inline-block' }} />
                    {hours.label}
                  </div>
                )}
                {pres?.openingHoursText && <div>{pres.openingHoursText}</div>}
                <div>{addressLine} — <a href={mapsHref} target="_blank" rel="noreferrer" style={{ color: th.accent, fontWeight: 700 }}>Itinéraire →</a></div>
                {pres?.contactPhone && <a href={`tel:${pres.contactPhone}`} style={{ color: th.accent }}>{pres.contactPhone}</a>}
                {pres?.contactEmail && <a href={`mailto:${pres.contactEmail}`} style={{ color: th.accent }}>{pres.contactEmail}</a>}
              </div>
            </section>

            <section style={{ borderRadius: 16, padding: '16px 18px', background: HERO_GRADIENT, color: HERO_INK }}>
              <div style={{ fontFamily: th.fontDisplay, fontWeight: 800, fontSize: 15, letterSpacing: -0.3, marginBottom: 10 }}>Envie de jouer ?</div>
              <Link href="/reserver" style={{ ...cta, fontSize: 12.5 }}>Réserver un terrain →</Link>
            </section>
          </div>
        </div>
      </main>

      {lightbox && (
        <div role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'zoom-out' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="Photo du club" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 12 }} />
        </div>
      )}
    </Screen>
  );
}
