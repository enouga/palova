'use client';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { Sponsor, assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { offerIsActive } from '@/lib/clubhouse';
import { deadlineCountdown } from '@/lib/tournament';
import { ACCENTS, inkOn } from '@/lib/theme';
import { SectionHeader } from '@/components/clubhouse/SectionHeader';
import { isSafeHttpUrl } from '@/lib/safeLink';

// « Cartes vivantes » : grille de tuiles logo qui se retournent en 3D, une à la
// fois en cascade, pour révéler l'offre du partenaire au dos (coupon bleu nuit
// à encoches). Tap = flip manuel (ignore alors la cascade), tilt 3D au survol
// (desktop), pastille « % » sur la face avant des cartes à offre.
// Reduced-motion → tout statique, bascule instantanée au tap.
const CASCADE_MS = 3500;

export function SponsorFlipDeck({ sponsors, now = null }: { sponsors: Sponsor[]; now?: Date | null }) {
  const { th } = useTheme();
  const rootRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [autoIdx, setAutoIdx] = useState(-1);
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Révélation à l'entrée dans le viewport (section basse de page). Filet de sécurité :
  // si l'observer ne détecte jamais d'intersection (ex. capture pleine page sans scroll
  // réel, timing de layout défavorable…), un délai de repli révèle quand même les cartes
  // — jamais de section « titre sans cartes » indéfiniment invisible.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setShown(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setShown(true); io.disconnect(); }
    }, { threshold: 0.15 });
    io.observe(el);
    const fallback = setTimeout(() => setShown(true), 1500);
    return () => { io.disconnect(); clearTimeout(fallback); };
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

  const copy = async (s: Sponsor, e: MouseEvent) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(s.offerCode ?? ''); setCopiedId(s.id); setTimeout(() => setCopiedId(null), 1600); } catch { /* silencieux */ }
  };

  // Tilt 3D au survol : la carte s'incline vers le curseur (variables CSS,
  // consommées seulement en pointeur fin — aucun effet tactile/reduced-motion).
  const onTilt = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', String(((e.clientX - r.left) / r.width - 0.5) * 2));
    e.currentTarget.style.setProperty('--my', String(((e.clientY - r.top) / r.height - 0.5) * 2));
  };
  const offTilt = (e: MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.setProperty('--mx', '0');
    e.currentTarget.style.setProperty('--my', '0');
  };

  const card = (s: Sponsor, i: number) => {
    const active = offerIsActive(s, ref);
    const hasOffer = active && !!(s.offerText || s.offerCode);
    const expiry = active && s.offerUntil && now ? deadlineCountdown(s.offerUntil, now) : null;
    const isFlip = flipped(i, s.id);
    return (
      <div className="fd-cell" key={s.id} style={{ '--i': i } as CSSProperties}>
        <div
          className={`fd-scene${isFlip ? ' is-open' : ''}`}
          role="button"
          tabIndex={0}
          aria-pressed={isFlip}
          aria-label={s.name}
          onClick={() => toggle(i, s.id)}
          onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(i, s.id); } }}
          onMouseMove={onTilt}
          onMouseLeave={offTilt}
        >
          <div className={`fd-card${isFlip ? ' is-flipped' : ''}`}>
            {/* FACE — logo */}
            <div className="fd-face fd-front">
              {hasOffer && (
                <span className="fd-hint" aria-label="Offre disponible" title="Offre disponible" style={{ background: th.accentWarm, color: inkOn(th.accentWarm) }}>%</span>
              )}
              <div className="fd-logo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={assetUrl(s.logoUrl) ?? ''} alt={s.name} />
              </div>
              {/* face avant TOUJOURS blanche → encre fixe (th.text vire au clair en thème sombre = illisible) */}
              <div className="fd-nm" style={{ fontFamily: th.fontUI, color: '#17233a' }}>{s.name}</div>
            </div>
            {/* DOS — coupon d'offre ou statut partenaire */}
            <div className="fd-face fd-back">
              {hasOffer ? (
                <>
                  {/* encoches de coupon (couleur du fond de page → semblent découpées) */}
                  <span className="fd-notch fd-nl" aria-hidden style={{ background: th.bg }} />
                  <span className="fd-notch fd-nr" aria-hidden style={{ background: th.bg }} />
                  <span className="fd-wm" aria-hidden>%</span>
                  <span className="fd-lb" style={{ fontFamily: th.fontUI }}>Offre membres</span>
                  {s.offerText && <span className="fd-of" style={{ fontFamily: th.fontUI }}>{s.offerText}</span>}
                  {s.offerCode && (
                    <button className={`fd-code${copiedId === s.id ? ' is-copied' : ''}`} onClick={(e) => copy(s, e)} aria-label={`Copier le code ${s.offerCode}`} style={{ fontFamily: th.fontMono }}>
                      {copiedId === s.id ? '✓ Copié' : s.offerCode}
                    </button>
                  )}
                  {expiry?.urgent && <span className="fd-exp" style={{ fontFamily: th.fontUI, color: ACCENTS.coral }}>{expiry.text}</span>}
                </>
              ) : (
                <>
                  <span className="fd-back-nm" style={{ fontFamily: th.fontUI }}>{s.name}</span>
                  <span className="fd-lb" style={{ fontFamily: th.fontUI }}>Partenaire du club</span>
                  {isSafeHttpUrl(s.linkUrl) && (
                    <a className="fd-visit" href={s.linkUrl!} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontFamily: th.fontUI }}>
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
        .fd-grid { display: flex; flex-wrap: wrap; gap: 16px; padding: 4px 20px 10px; }
        .fd-cell { perspective: 700px; }

        /* Entrée « distribution » : la carte arrive tournée et se pose avec un léger ressort */
        .fd-anim .fd-cell { opacity: 0; transform: translateY(26px) rotate(-5deg) scale(.94); }
        .fd-anim.fd-in .fd-cell { animation: fd-deal .7s cubic-bezier(.34,1.56,.64,1) both; animation-delay: calc(var(--i, 0) * 90ms); }
        @keyframes fd-deal { from { opacity: 0; transform: translateY(26px) rotate(-5deg) scale(.94); } to { opacity: 1; transform: none; } }

        .fd-scene { width: 150px; height: 122px; perspective: 900px; background: none; border: none; padding: 0; cursor: pointer; display: block; transition: transform .18s ease-out; outline: none; }
        .fd-scene:hover { transform: translateY(-4px); }
        @media (hover: hover) and (pointer: fine) {
          .fd-scene:hover { transform: translateY(-4px) rotateY(calc(var(--mx, 0) * 7deg)) rotateX(calc(var(--my, 0) * -6deg)); }
        }
        .fd-scene:focus-visible { outline: 2px solid ${th.accent}; outline-offset: 3px; border-radius: 12px; }
        .fd-scene.is-open { animation: fd-pop .6s cubic-bezier(.34,1.56,.64,1); }
        @keyframes fd-pop { 0% { transform: scale(1); } 45% { transform: scale(1.06); } 100% { transform: scale(1); } }

        .fd-card { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; transition: transform .6s cubic-bezier(.4,.1,.2,1); will-change: transform; }
        .fd-card.is-flipped { transform: rotateY(180deg); }
        .fd-face { position: absolute; inset: 0; -webkit-backface-visibility: hidden; backface-visibility: hidden; border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; }

        .fd-front { background: #fff; box-shadow: 0 2px 8px rgba(20,40,80,.16); }
        .fd-front .fd-logo { flex: 1; display: flex; align-items: center; justify-content: center; width: 100%; padding: 14px 16px 4px; }
        .fd-front .fd-logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .fd-front .fd-nm { font-size: 10.5px; font-weight: 800; letter-spacing: 1.4px; text-transform: uppercase; padding: 0 6px 12px; text-align: center; }
        .fd-hint { position: absolute; top: 8px; right: 8px; z-index: 2; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 900; box-shadow: 0 1px 4px rgba(20,40,80,.25); animation: fd-hintbeat 2.6s ease-in-out infinite; }
        @keyframes fd-hintbeat { 0%, 70%, 100% { transform: scale(1); } 82% { transform: scale(1.18); } }

        .fd-back { background: linear-gradient(150deg, #2f5fa8, #17233a); color: #fff; transform: rotateY(180deg); box-shadow: 0 10px 26px rgba(47,95,168,.42); align-items: center; justify-content: center; gap: 6px; padding: 12px 14px 14px; text-align: center; }
        .fd-back::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(115deg, transparent 42%, rgba(255,255,255,.22) 50%, transparent 58%); transform: translateX(-160%); }
        .fd-card.is-flipped .fd-back::after { animation: fd-sheen 1s ease .25s both; }
        @keyframes fd-sheen { from { transform: translateX(-160%); } to { transform: translateX(160%); } }
        .fd-notch { position: absolute; top: 50%; width: 14px; height: 14px; border-radius: 50%; transform: translateY(-50%); }
        .fd-notch.fd-nl { left: -7px; } .fd-notch.fd-nr { right: -7px; }
        .fd-wm { position: absolute; right: -12px; bottom: -24px; font-size: 88px; font-weight: 900; color: rgba(255,255,255,.07); pointer-events: none; line-height: 1; }
        .fd-back .fd-lb { font-size: 9px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; opacity: .7; }
        .fd-back .fd-of { font-size: 14px; font-weight: 800; line-height: 1.22; position: relative; }
        .fd-back .fd-back-nm { font-size: 13px; font-weight: 800; letter-spacing: .3px; }
        .fd-back .fd-code { font-size: 12px; font-weight: 700; color: #fff; background: rgba(255,255,255,.16); border: 1px dashed rgba(255,255,255,.55); border-radius: 6px; padding: 3px 10px; cursor: pointer; position: relative; }
        .fd-back .fd-code.is-copied { animation: fd-copied .35s cubic-bezier(.34,1.56,.64,1); }
        @keyframes fd-copied { 0% { transform: scale(1); } 50% { transform: scale(1.15); } 100% { transform: scale(1); } }
        .fd-back .fd-exp { font-size: 10.5px; font-weight: 700; position: relative; }
        .fd-back .fd-visit { font-size: 11px; font-weight: 700; color: #fff; text-decoration: none; background: rgba(255,255,255,.16); border-radius: 999px; padding: 3px 12px; }

        @media (prefers-reduced-motion: reduce) {
          .fd-anim .fd-cell { opacity: 1; transform: none; animation: none; }
          .fd-card { transition: none; }
          .fd-scene, .fd-scene:hover { transition: none; transform: none; }
          .fd-scene.is-open { animation: none; }
          .fd-hint { animation: none; }
          .fd-back::after, .fd-card.is-flipped .fd-back::after { animation: none; }
        }
      `}</style>
      <div className={`fd-grid fd-anim${shown ? ' fd-in' : ''}`} ref={rootRef}>
        {sponsors.map((s, i) => card(s, i))}
      </div>
    </section>
  );
}
