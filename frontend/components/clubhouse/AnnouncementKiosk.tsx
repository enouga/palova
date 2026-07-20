'use client';
import { useEffect, useState } from 'react';
import { Announcement, AnnouncementKind, assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { deadlineCountdown } from '@/lib/tournament';
import { Btn } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { ACCENTS } from '@/lib/theme';
import { HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { clubPanelWash } from '@/lib/authShell';
import { isSafeHttpUrl } from '@/lib/safeLink';

// Type d'annonce → étiquette de chip (INFO n'a pas de chip).
const KIND_LABEL: Partial<Record<AnnouncementKind, string>> = {
  OFFER: 'Offre', TOURNAMENT: 'Tournoi', EVENT: 'Event',
};

// Neutralise quotes/parenthèses : une URL hostile ne peut pas sortir du url('…') CSS.
const cssSafe = (url: string | null | undefined) => url?.replace(/['"\\()]/g, '') ?? null;

// Le Kiosque « À la une » : scène cinéma des annonces du club. Une diapo à la fois,
// défilement auto (façon stories, respecte prefers-reduced-motion), segments de
// progression cliquables + flèches. Toutes les diapos (avec ou sans affiche) partagent le
// même fond : un lavis clair teinté par la couleur d'accent du club (`clubPanelWash`,
// réutilisé des pages d'auth) — coloré et à l'identité du club, jamais dépendant des
// couleurs (parfois sombres) de l'affiche uploadée, encre fixe HERO_INK toujours lisible.
// Annonce AVEC affiche → l'affiche portrait entière posée dessus, à côté du texte.
// Clic → affiche en grand (image) ou feuille du texte complet.
// Aucune annonce → repli même lavis, fin (nom du club + accroche). `now` null (avant
// hydratation) → pas de compte à rebours. `intervalSeconds` = vitesse d'auto-défilement
// réglée par le club (0 = manuel, pas de défilement auto ; défaut 6 s).
export function AnnouncementKiosk({ clubName, slides, now, intervalSeconds = 6 }: {
  clubName: string; slides: Announcement[]; now: Date | null; intervalSeconds?: number;
}) {
  const { th } = useTheme();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [detail, setDetail] = useState<Announcement | null>(null);

  // Nouveau jeu d'annonces (fetch) → on repart de la première.
  useEffect(() => { setIndex(0); }, [slides.length]);

  useEffect(() => {
    if (slides.length <= 1 || paused || intervalSeconds <= 0) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % slides.length), intervalSeconds * 1000);
    return () => clearInterval(t);
  }, [slides.length, paused, intervalSeconds]);

  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDetail(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail]);

  const shell = (children: React.ReactNode) => <div style={{ padding: '16px 20px 0' }}>{children}</div>;

  const wash = clubPanelWash(th.accent);

  // Repli : aucune annonce active → bandeau lavis fin.
  if (slides.length === 0) {
    return shell(
      <div data-testid="clubhouse-kiosk" style={{ background: wash, borderRadius: 22, padding: '26px 22px', color: HERO_INK }}>
        <div style={{ fontFamily: th.fontBrand, fontSize: 14, letterSpacing: 0.6, color: HERO_INK_MUTED }}>{clubName}</div>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 27, lineHeight: 1.12, letterSpacing: -0.5, marginTop: 8 }}>
          Réservez, jouez, retrouvez-vous.
        </div>
      </div>,
    );
  }

  const safeIndex = Math.min(index, slides.length - 1);
  const a = slides[safeIndex];
  const img = cssSafe(assetUrl(a.imageUrl));
  const hasImage = !!img;
  const ink = HERO_INK;
  const inkMuted = HERO_INK_MUTED;
  const chipBg = 'rgba(255,255,255,0.55)';
  const segActive = HERO_INK;
  const segDim = 'rgba(24,21,16,0.22)';
  const arrowBg = 'rgba(255,255,255,0.6)';
  const countdown = now && a.validUntil ? deadlineCountdown(a.validUntil, now) : null;
  const multi = slides.length > 1;
  const go = (i: number) => setIndex(((i % slides.length) + slides.length) % slides.length);

  const chips = (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
      {KIND_LABEL[a.kind] && (
        <span style={{
          display: 'inline-block', fontFamily: th.fontUI, fontSize: 11, fontWeight: 800, letterSpacing: 1,
          textTransform: 'uppercase', color: ink, background: chipBg, borderRadius: 99, padding: '4px 11px',
        }}>{KIND_LABEL[a.kind]}</span>
      )}
      {countdown && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: th.fontUI, fontSize: 12, fontWeight: 700,
          color: '#fff', background: ACCENTS.coral, borderRadius: 99, padding: '4px 11px',
        }}>
          <Icon name="clock" size={12} color="#fff" />{countdown.text}
        </span>
      )}
    </div>
  );

  const textCol = (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: th.fontBrand, fontSize: 13.5, letterSpacing: 0.6, color: inkMuted }}>{clubName}</div>
      <div style={{ marginTop: 9 }}>{chips}</div>
      <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 25, lineHeight: 1.12, letterSpacing: -0.5, marginTop: 9, color: ink }}>
        {a.title}
      </div>
      {a.body && (
        <p style={{ fontFamily: th.fontUI, fontSize: 14, color: inkMuted, lineHeight: 1.5, margin: '8px 0 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {a.body}
        </p>
      )}
      {isSafeHttpUrl(a.linkUrl) && (
        <a href={a.linkUrl!} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
          aria-label={`En savoir plus sur : ${a.title}`}
          style={{ display: 'inline-block', marginTop: 12, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, color: ink, textDecoration: 'none' }}>
          En savoir plus →
        </a>
      )}
    </div>
  );

  return shell(
    <>
      <style>{`.kio-scene{display:flex;gap:22px;align-items:center}@media(max-width:560px){.kio-scene{flex-direction:column;align-items:flex-start}.kio-poster{align-self:center}}`}</style>
      <div
        data-testid="clubhouse-kiosk"
        onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
        style={{ position: 'relative', borderRadius: 22, overflow: 'hidden' }}
      >
        <div
          role="button" tabIndex={0}
          aria-label={`Ouvrir l'annonce : ${a.title}`}
          onClick={() => setDetail(a)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetail(a); } }}
          // Marge latérale élargie quand les flèches sont là (multi) : le contenu (titre
          // ET affiche) reste dans la gouttière, jamais sous une flèche.
          style={{ position: 'relative', padding: multi ? '34px 46px 24px' : '26px 22px 24px', minHeight: 210, cursor: 'pointer', color: ink, background: wash }}
        >
          <div style={{ position: 'relative', zIndex: 1 }}>
            {hasImage ? (
              <div className="kio-scene">
                <div className="kio-poster" style={{ flex: '0 0 auto' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img ?? ''} alt="" style={{ display: 'block', maxHeight: 240, maxWidth: '100%', width: 'auto', borderRadius: 12, boxShadow: '0 12px 30px rgba(24,21,16,0.2)', outline: '1px solid rgba(24,21,16,0.08)' }} />
                </div>
                {textCol}
              </div>
            ) : textCol}
          </div>
        </div>

        {/* Progression + flèches : frères de la diapo (clic sans ouvrir le détail). */}
        {multi && (
          <div style={{ position: 'absolute', top: 12, left: 16, right: 16, display: 'flex', gap: 5, zIndex: 2 }}>
            {slides.map((s, i) => (
              <button key={s.id} type="button" aria-label={`Annonce ${i + 1} sur ${slides.length}`} onClick={() => go(i)}
                style={{ flex: 1, height: 4, borderRadius: 2, border: 'none', padding: 0, cursor: 'pointer', background: i === safeIndex ? segActive : segDim }} />
            ))}
          </div>
        )}
        {multi && (
          <>
            <button type="button" aria-label="Annonce précédente" onClick={() => go(safeIndex - 1)}
              style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 2, width: 32, height: 32, borderRadius: 99, border: 'none', cursor: 'pointer', background: arrowBg, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
              <Icon name="chevL" size={16} color={ink} />
            </button>
            <button type="button" aria-label="Annonce suivante" onClick={() => go(safeIndex + 1)}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 2, width: 32, height: 32, borderRadius: 99, border: 'none', cursor: 'pointer', background: arrowBg, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
              <Icon name="chevR" size={16} color={ink} />
            </button>
          </>
        )}
      </div>

      {detail && detail.imageUrl && <PosterLightbox announcement={detail} onClose={() => setDetail(null)} />}
      {detail && !detail.imageUrl && <AnnouncementSheet announcement={detail} onClose={() => setDetail(null)} />}
    </>,
  );
}

// Affiche en grand — lightbox plein écran (clic sur une diapo avec image).
function PosterLightbox({ announcement, onClose }: { announcement: Announcement; onClose: () => void }) {
  const { th } = useTheme();
  return (
    <div role="dialog" aria-modal="true" aria-label={announcement.title} onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.85)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'zoom-out',
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={assetUrl(announcement.imageUrl) ?? ''} alt={announcement.title} onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '100%', maxHeight: '72vh', borderRadius: 12, cursor: 'default' }} />
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, marginTop: 14, textAlign: 'center', cursor: 'default' }}>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 18, color: '#fff' }}>{announcement.title}</div>
        {announcement.body && <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: 'rgba(255,255,255,0.8)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{announcement.body}</p>}
        {isSafeHttpUrl(announcement.linkUrl) && (
          <a href={announcement.linkUrl!} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 10, fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, color: '#fff', textDecoration: 'underline' }}>
            En savoir plus →
          </a>
        )}
      </div>
      <button onClick={onClose} aria-label="Fermer" style={{ position: 'absolute', top: 16, right: 16, border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', width: 36, height: 36, borderRadius: 99, fontSize: 18, cursor: 'pointer' }}>✕</button>
    </div>
  );
}

// Feuille « annonce complète » — top-sheet calquée sur ConfirmDialog (annonce sans image).
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
          <Btn variant="surface" onClick={onClose} style={{ flex: isSafeHttpUrl(announcement.linkUrl) ? '0 0 42%' : 1 }}>Fermer</Btn>
          {isSafeHttpUrl(announcement.linkUrl) && (
            <a href={announcement.linkUrl!} target="_blank" rel="noreferrer"
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
