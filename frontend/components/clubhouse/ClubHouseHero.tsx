'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Announcement } from '@/lib/api';
import { PulseChip } from '@/lib/clubhouse';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';
import { Icon, IconName } from '@/components/ui/Icon';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';

const PULSE_ICON: Record<PulseChip['kind'], IconName> = { slot: 'bolt', matches: 'users', event: 'trophy' };

// Hero du Club-house : toujours présent. Identité club (fontBrand) + contenu adaptatif —
// annonce épinglée (titre + corps clampé 2 lignes, clic → top-sheet complète) sinon accroche —
// + CTA « Réserver un terrain » + rangée « pouls du club » (chips créneau/parties/event).
// Fond = imageUrl de l'annonce (voile sombre) sinon le dégradé signature brume bleue.
export function ClubHouseHero({ clubName, announcement, pulse }: {
  clubName: string; announcement: Announcement | null; pulse: PulseChip[];
}) {
  const { th } = useTheme();
  const [open, setOpen] = useState(false);
  // Neutralise quotes/parenthèses : une URL hostile ne peut pas sortir du url('…') CSS.
  const safeImageUrl = announcement?.imageUrl?.replace(/['"\\()]/g, '') ?? null;
  const hasImage = !!safeImageUrl;
  const ink = hasImage ? '#fff' : HERO_INK;
  const inkMuted = hasImage ? 'rgba(255,255,255,0.78)' : HERO_INK_MUTED;

  const bg: React.CSSProperties = safeImageUrl
    ? { backgroundImage: `linear-gradient(rgba(18,22,30,0.62), rgba(18,22,30,0.55)), url('${safeImageUrl}')`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: HERO_GRADIENT };

  const interactive = !!announcement;

  const goMatches = (e: React.MouseEvent) => {
    e.stopPropagation();
    document.getElementById('ch-matches')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div style={{ padding: '16px 20px 0' }}>
      <div
        data-testid="clubhouse-hero"
        {...(interactive ? {
          role: 'button' as const, tabIndex: 0,
          'aria-label': `Lire l'annonce : ${announcement.title}`,
          onClick: () => setOpen(true),
          onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); } },
        } : {})}
        style={{ ...bg, borderRadius: 22, padding: '26px 22px 20px', color: ink, cursor: interactive ? 'pointer' : 'default' }}
      >
        <div style={{ fontFamily: th.fontBrand, fontSize: 14, letterSpacing: 0.6, color: inkMuted }}>{clubName}</div>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 29, lineHeight: 1.12, letterSpacing: -0.5, marginTop: 8, maxWidth: 560 }}>
          {announcement ? announcement.title : 'Réservez, jouez, retrouvez-vous.'}
        </div>
        {announcement?.body && (
          <p style={{ fontFamily: th.fontUI, fontSize: 14.5, color: inkMuted, lineHeight: 1.5, margin: '8px 0 0', maxWidth: 520, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {announcement.body}
          </p>
        )}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
          <Link href="/reserver" onClick={(e) => e.stopPropagation()} style={{
            background: hasImage ? '#fff' : HERO_INK, color: hasImage ? '#1d2733' : '#f7f6f0',
            borderRadius: 12, padding: '11px 18px', fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, textDecoration: 'none',
          }}>
            Réserver un terrain
          </Link>
          {announcement?.linkUrl && (
            <a href={announcement.linkUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
              aria-label={`En savoir plus sur : ${announcement.title}`}
              style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, color: ink, textDecoration: 'none', padding: '11px 6px' }}>
              En savoir plus →
            </a>
          )}
        </div>
        {pulse.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 16 }}>
            {pulse.map((c) => {
              const style: React.CSSProperties = {
                display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '6px 12px',
                background: hasImage ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.5)',
                fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: ink,
              };
              // La chip « parties » scrolle vers la section vedette — c'est un vrai bouton.
              return c.kind === 'matches' ? (
                <button key={c.kind} type="button" onClick={goMatches} style={{ ...style, border: 'none', cursor: 'pointer' }}>
                  <Icon name={PULSE_ICON[c.kind]} size={13} color={ink} />{c.label}
                </button>
              ) : (
                <span key={c.kind} style={style}>
                  <Icon name={PULSE_ICON[c.kind]} size={13} color={ink} />{c.label}
                </span>
              );
            })}
          </div>
        )}
      </div>
      {open && announcement && <AnnouncementSheet announcement={announcement} onClose={() => setOpen(false)} />}
    </div>
  );
}

// Feuille « annonce complète » — top-sheet calquée sur ConfirmDialog (sans confirm/danger).
function AnnouncementSheet({ announcement, onClose }: { announcement: Announcement; onClose: () => void }) {
  const { th } = useTheme();
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 95, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', animation: 'sp-fade .25s ease' }} />
      <div role="dialog" aria-modal="true" aria-label={announcement.title} style={{ position: 'relative', width: '100%', maxWidth: 480, margin: '0 auto', background: th.bgElev, borderRadius: '0 0 28px 28px', padding: '12px 20px 36px', boxShadow: '0 10px 40px rgba(0,0,0,0.3)', animation: 'sp-sheet-in-top .34s cubic-bezier(.2,.8,.2,1)' }}>
        <div style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: th.textFaint }}>À la une</div>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, color: th.text, letterSpacing: -0.3, marginTop: 6 }}>{announcement.title}</div>
        <p style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.textMute, lineHeight: 1.55, margin: '12px 0 0', whiteSpace: 'pre-wrap', maxHeight: '60vh', overflowY: 'auto' }}>{announcement.body}</p>
        <div style={{ display: 'flex', gap: 11, marginTop: 24, alignItems: 'center' }}>
          <Btn variant="surface" onClick={onClose} style={{ flex: announcement.linkUrl ? '0 0 42%' : 1 }}>Fermer</Btn>
          {announcement.linkUrl && (
            <a href={announcement.linkUrl} target="_blank" rel="noreferrer"
              style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 54, background: th.accent, color: th.onAccent, borderRadius: 14, fontFamily: th.fontUI, fontSize: 16, fontWeight: 600, textDecoration: 'none' }}>
              En savoir plus →
            </a>
          )}
        </div>
        <div style={{ width: 38, height: 5, borderRadius: 3, background: th.lineStrong, margin: '18px auto 0' }} />
      </div>
    </div>
  );
}
