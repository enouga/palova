'use client';
import Link from 'next/link';
import { ClubDetail, ClubPresentation, assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, inkOn } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { cardStyle } from '@/components/clubhouse/SectionHeader';
import {
  amenityList, courtsChipLabel, courtsSummary, coverUrl, hoursRange, openNowChip,
  railPhotos, showcaseKicker,
} from '@/lib/clubShowcase';

// Vitrine « Le club » du Club-house : scène cinéma (photo du club + voile) ou repli
// « brume bleue » (jamais de grand panneau sombre), chips d'infos automatiques
// (pistes/horaires dérivés de club.clubSports), bande « Sur place ». Tout mène à /club.
export function ClubShowcase({ presentation, club, now }: { presentation: ClubPresentation; club: ClubDetail; now: Date | null }) {
  const { th } = useTheme();
  const cover = assetUrl(coverUrl(presentation));
  const onPhoto = !!cover;
  const kicker = showcaseKicker(club.city, presentation.foundedYear);
  const courts = courtsChipLabel(courtsSummary(club.clubSports));
  const hours = openNowChip(hoursRange(club.clubSports), club.timezone, now);
  const rail = railPhotos(presentation);
  const amenities = amenityList(presentation.amenities);
  const logo = assetUrl(club.logoUrl);

  const ink = onPhoto ? '#fff' : HERO_INK;
  const inkMuted = onPhoto ? 'rgba(255,255,255,0.86)' : HERO_INK_MUTED;
  const chip: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999,
    fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, color: ink,
    ...(onPhoto
      ? { background: 'rgba(255,255,255,0.16)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.35)', backdropFilter: 'blur(6px)' }
      : { background: 'rgba(255,255,255,0.55)', boxShadow: 'inset 0 0 0 1.4px rgba(24,21,14,0.14)' }),
  };

  return (
    <div>
      <style>{`
        .cs-scene{position:relative;display:block;height:400px;border-radius:18px;overflow:hidden;text-decoration:none}
        .cs-rail{display:none}
        .cs-photochip{position:absolute;top:16px;right:16px;z-index:3}
        @media(min-width:700px){
          .cs-scene{height:340px}
          .cs-rail{display:flex;gap:8px;position:absolute;right:20px;bottom:20px;z-index:3}
          .cs-photochip{display:none !important} /* bat le display inline-flex du style inline */
        }
        .cs-amen-label{font-family:${th.fontUI};font-size:12px;font-weight:600}
        @media(max-width:479px){.cs-amen-label{display:none}}
      `}</style>

      <Link href="/club" aria-label={`Découvrir ${club.name}`} className="cs-scene"
        style={{ boxShadow: th.shadow, ...(onPhoto ? {} : { background: HERO_GRADIENT }) }}>
        {onPhoto && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cover} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(178deg, rgba(10,14,24,0.02) 32%, rgba(10,14,24,0.74) 90%)' }} />
          </>
        )}
        {!onPhoto && (
          <span aria-hidden="true" style={{ position: 'absolute', right: -22, top: -30, opacity: 0.12, pointerEvents: 'none' }}>
            <Icon name="ball" size={190} color={HERO_INK} />
          </span>
        )}

        <span aria-hidden="true" style={{ position: 'absolute', top: 16, left: 18, zIndex: 3, width: 44, height: 44, borderRadius: 13, background: 'rgba(255,255,255,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(0,0,0,0.22)' }}>
          {logo
            /* eslint-disable-next-line @next/next/no-img-element */
            ? <img src={logo} alt="" style={{ width: 32, height: 32, objectFit: 'contain' }} />
            : <Icon name="ball" size={26} color={th.accent} />}
        </span>

        {presentation.photos.length > 0 && (
          <span className="cs-photochip" style={chip}>
            <Icon name="camera" size={13} color={ink} />{presentation.photos.length} photos
          </span>
        )}

        <div style={{ position: 'absolute', inset: 0, zIndex: 2, padding: 20, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'flex-start' }}>
          {kicker && <div style={{ fontFamily: th.fontBrand, fontSize: 11.5, letterSpacing: 2.5, textTransform: 'uppercase', color: onPhoto ? '#cfe0f5' : HERO_INK_MUTED }}>{kicker}</div>}
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 800, fontSize: 'clamp(29px, 5vw, 37px)', letterSpacing: -0.8, color: ink, margin: '4px 0 8px', textShadow: onPhoto ? '0 2px 18px rgba(0,0,0,0.35)' : 'none' }}>
            {club.name}
          </div>
          {presentation.presentationText && (
            <p style={{ fontFamily: th.fontUI, fontSize: 13.5, lineHeight: 1.55, color: inkMuted, maxWidth: 440, margin: '0 0 14px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {presentation.presentationText}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {courts && <span style={chip}><Icon name="ball" size={13} color={ink} />{courts}</span>}
            {hours && (
              <span style={chip}>
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 99, background: hours.open ? ACCENTS.emerald : ACCENTS.apricot, display: 'inline-block' }} />
                {hours.label}
              </span>
            )}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: th.accent, color: inkOn(th.accent), fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, padding: '9px 17px', borderRadius: 999, boxShadow: `0 6px 16px ${th.accent}73` }}>
              Découvrir le club →
            </span>
          </div>
        </div>

        {rail.tiles.length > 0 && (
          <span className="cs-rail">
            {rail.tiles.map((ph) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img key={ph.id} src={assetUrl(ph.url) ?? ''} alt={ph.caption ?? ''} style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 11, boxShadow: '0 5px 16px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,255,255,0.45)' }} />
            ))}
            {rail.more > 0 && <span style={{ ...chip, width: 80, height: 60, borderRadius: 11, justifyContent: 'center', padding: 0 }}>+{rail.more}</span>}
          </span>
        )}
      </Link>

      {amenities.length > 0 && (
        <div style={{ ...cardStyle(th), marginTop: 10, padding: '11px 18px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: th.textFaint }}>Sur place</span>
          {amenities.map((a) => (
            <span key={a.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 30, height: 30, borderRadius: 9, background: `${th.accent}21`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={a.icon} size={15} color={th.accent} />
              </span>
              <span className="cs-amen-label" style={{ color: th.text }}>{a.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
