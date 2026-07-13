'use client';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Sponsor, assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { offerIsActive } from '@/lib/clubhouse';
import { deadlineCountdown } from '@/lib/tournament';
import { ACCENTS } from '@/lib/theme';
import { SectionHeader } from '@/components/clubhouse/SectionHeader';

// « Cartes vivantes » : grille de tuiles logo qui se retournent en 3D, une à la
// fois en cascade, pour révéler l'offre du partenaire au dos (dégradé bleu nuit).
// Tap = flip manuel (ignore alors la cascade). Reduced-motion → pas de cascade.
const CASCADE_MS = 3500;

export function SponsorFlipDeck({ sponsors, now = null }: { sponsors: Sponsor[]; now?: Date | null }) {
  const { th } = useTheme();
  const rootRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [autoIdx, setAutoIdx] = useState(-1);
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Révélation à l'entrée dans le viewport (section basse de page).
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setShown(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setShown(true); io.disconnect(); }
    }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Cascade automatique (désactivée en reduced-motion).
  useEffect(() => {
    if (sponsors.length < 1) return;
    const reduce = typeof window !== 'undefined' && !!window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const id = setInterval(() => setAutoIdx((i) => (i + 1) % sponsors.length), CASCADE_MS);
    return () => clearInterval(id);
  }, [sponsors.length]);

  if (sponsors.length === 0) return null;
  const ref = now ?? new Date(0);

  const flipped = (i: number, id: string) => (id in manual ? manual[id] : autoIdx === i);

  const toggle = (i: number, id: string) => setManual((m) => ({ ...m, [id]: !(id in m ? m[id] : autoIdx === i) }));

  const copy = async (s: Sponsor, e: React.MouseEvent) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(s.offerCode ?? ''); setCopiedId(s.id); setTimeout(() => setCopiedId(null), 1600); } catch { /* silencieux */ }
  };

  const card = (s: Sponsor, i: number) => {
    const active = offerIsActive(s, ref);
    const expiry = active && s.offerUntil && now ? deadlineCountdown(s.offerUntil, now) : null;
    const isFlip = flipped(i, s.id);
    return (
      <div className="fd-cell" key={s.id} style={{ ['--i']: i } as CSSProperties}>
        <div
          className="fd-scene"
          role="button"
          tabIndex={0}
          aria-pressed={isFlip}
          aria-label={s.name}
          onClick={() => toggle(i, s.id)}
          onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(i, s.id); } }}
        >
          <div className={`fd-card${isFlip ? ' is-flipped' : ''}`}>
            {/* FACE — logo */}
            <div className="fd-face fd-front">
              <div className="fd-logo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={assetUrl(s.logoUrl) ?? ''} alt={s.name} />
              </div>
              {/* face avant TOUJOURS blanche → encre fixe (th.text vire au clair en thème sombre = illisible) */}
              <div className="fd-nm" style={{ fontFamily: th.fontUI, color: '#17233a' }}>{s.name}</div>
            </div>
            {/* DOS — offre ou statut partenaire */}
            <div className="fd-face fd-back">
              {active && (s.offerText || s.offerCode) ? (
                <>
                  <span className="fd-lb" style={{ fontFamily: th.fontUI }}>Offre membres</span>
                  {s.offerText && <span className="fd-of" style={{ fontFamily: th.fontUI }}>{s.offerText}</span>}
                  {s.offerCode && (
                    <button className="fd-code" onClick={(e) => copy(s, e)} aria-label={`Copier le code ${s.offerCode}`} style={{ fontFamily: th.fontMono }}>
                      {copiedId === s.id ? '✓ Copié' : s.offerCode}
                    </button>
                  )}
                  {expiry?.urgent && <span className="fd-exp" style={{ fontFamily: th.fontUI, color: ACCENTS.coral }}>{expiry.text}</span>}
                </>
              ) : (
                <>
                  <span className="fd-back-nm" style={{ fontFamily: th.fontUI }}>{s.name}</span>
                  <span className="fd-lb" style={{ fontFamily: th.fontUI }}>Partenaire du club</span>
                  {s.linkUrl && (
                    <a className="fd-visit" href={s.linkUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontFamily: th.fontUI }}>
                      Visiter →
                    </a>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <section style={{ padding: '26px 0 8px' }}>
      <div style={{ padding: '0 20px' }}>
        <SectionHeader title="Nos partenaires" />
      </div>
      <style>{`
        .fd-grid { display: flex; flex-wrap: wrap; gap: 16px; padding: 4px 20px 6px; }
        .fd-anim .fd-cell { opacity: 0; transform: translateY(16px); }
        .fd-anim.fd-in .fd-cell { animation: fd-rise .55s cubic-bezier(.22,.7,.28,1) both; animation-delay: calc(var(--i, 0) * 80ms); }
        @keyframes fd-rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }

        .fd-scene { width: 150px; height: 122px; perspective: 900px; background: none; border: none; padding: 0; cursor: pointer; display: block; transition: transform .25s cubic-bezier(.2,.7,.3,1); outline: none; }
        .fd-scene:hover { transform: translateY(-4px); }
        .fd-scene:focus-visible { outline: 2px solid ${th.accent}; outline-offset: 3px; border-radius: 12px; }
        .fd-card { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; transition: transform .6s cubic-bezier(.4,.1,.2,1); will-change: transform; }
        .fd-card.is-flipped { transform: rotateY(180deg); }
        .fd-face { position: absolute; inset: 0; -webkit-backface-visibility: hidden; backface-visibility: hidden; border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; }
        .fd-front { background: #fff; box-shadow: 0 2px 8px rgba(20,40,80,.16); }
        .fd-front .fd-logo { flex: 1; display: flex; align-items: center; justify-content: center; width: 100%; padding: 14px 16px 4px; }
        .fd-front .fd-logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .fd-front .fd-nm { font-size: 10.5px; font-weight: 800; letter-spacing: 1.4px; text-transform: uppercase; padding: 0 6px 12px; text-align: center; }
        .fd-back { background: linear-gradient(150deg, #2f5fa8, #17233a); color: #fff; transform: rotateY(180deg); box-shadow: 0 4px 14px rgba(20,40,80,.32); align-items: center; justify-content: center; gap: 6px; padding: 12px 12px 14px; text-align: center; }
        .fd-back .fd-lb { font-size: 9px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; opacity: .7; }
        .fd-back .fd-of { font-size: 14px; font-weight: 800; line-height: 1.22; }
        .fd-back .fd-back-nm { font-size: 13px; font-weight: 800; letter-spacing: .3px; }
        .fd-back .fd-code { font-size: 12px; font-weight: 700; color: #fff; background: rgba(255,255,255,.16); border: 1px dashed rgba(255,255,255,.55); border-radius: 6px; padding: 3px 10px; cursor: pointer; }
        .fd-back .fd-exp { font-size: 10.5px; font-weight: 700; }
        .fd-back .fd-visit { font-size: 11px; font-weight: 700; color: #fff; text-decoration: none; background: rgba(255,255,255,.16); border-radius: 999px; padding: 3px 12px; }

        @media (prefers-reduced-motion: reduce) {
          .fd-anim .fd-cell { opacity: 1; transform: none; animation: none; }
          .fd-card { transition: none; }
          .fd-scene, .fd-scene:hover { transition: none; transform: none; }
        }
      `}</style>
      <div className={`fd-grid fd-anim${shown ? ' fd-in' : ''}`} ref={rootRef}>
        {sponsors.map((s, i) => card(s, i))}
      </div>
    </section>
  );
}
