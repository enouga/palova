'use client';
import { useEffect, useRef, useState } from 'react';
import { Sponsor, assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';
import { offerIsActive } from '@/lib/clubhouse';
import { deadlineCountdown } from '@/lib/tournament';
import { HERO_GRADIENT } from '@/components/agenda/AgendaHero';

// Révélation au scroll, hydration-safe : false au premier rendu (serveur ET
// client → pas de mismatch), passe à true au mount via IntersectionObserver.
// Observer indisponible (SSR/jsdom) → on révèle tout de suite : jamais de
// contenu bloqué invisible.
function useInView<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const el = ref.current;
    if (!el) { setInView(true); return; }
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setInView(true); obs.disconnect(); }
    }, { threshold: 0.12 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, inView];
}

// Offres partenaires : carte « à la une » (pinned) sur dégradé signature,
// grille de cartes pour les offres actives, logos seuls pour le reste.
// Une offre expirée (offerUntil dépassé) redescend en logo seul.
// `now` null avant le mount (hydration-safe) : pas de countdown, expiration ignorée.
//
// Animation « entrée + halo subtil » (CSS pur, désactivée sous
// prefers-reduced-motion) : chaque bloc apparaît en fade + slide-up en cascade
// au scroll, un halo lumineux respire sur la carte à la une, micro-zoom au survol.
export function PartnerOffers({ sponsors, now = null }: { sponsors: Sponsor[]; now?: Date | null }) {
  const { th } = useTheme();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sectionRef, inView] = useInView<HTMLDivElement>();
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  if (sponsors.length === 0) return null;

  const ref = now ?? new Date(0); // pas d'horloge → expiration ignorée (corrigé au tick suivant)
  const actives = sponsors.filter((s) => offerIsActive(s, ref));
  const featured = actives.find((s) => s.pinned) ?? null;
  const gridSponsors = actives.filter((s) => s !== featured);
  const logoOnly = sponsors.filter((s) => !actives.includes(s));

  const copy = async (s: Sponsor) => {
    try {
      await navigator.clipboard.writeText(s.offerCode!);
      setCopiedId(s.id);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopiedId(null), 2000);
    } catch { /* repli silencieux : le code reste lisible dans le bouton */ }
  };

  // « Expire J-5 » / « Plus que 6 h » (déjà explicite seul).
  const expiry = (s: Sponsor) => {
    if (!now || !s.offerUntil) return null;
    const c = deadlineCountdown(s.offerUntil, now);
    return c ? { ...c, text: c.text.startsWith('J-') ? `Expire ${c.text}` : c.text } : null;
  };

  const logoTile = (s: Sponsor, size: number, className?: string) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={className} src={assetUrl(s.logoUrl) ?? undefined} alt={s.name} style={{ height: size, width: size + 22, objectFit: 'contain', borderRadius: 13, background: '#fff', padding: 7, flexShrink: 0, boxSizing: 'border-box' }} />
  );

  const codeButton = (s: Sponsor, onGradient = false) => s.offerCode && (
    <button onClick={() => copy(s)} title="Copier le code"
      style={{
        cursor: 'pointer', alignSelf: 'flex-start',
        border: `1px dashed ${onGradient ? 'rgba(24,21,14,0.18)' : th.lineStrong}`,
        background: onGradient ? 'rgba(24,21,14,0.06)' : th.surface2,
        color: th.text,
        borderRadius: 9, padding: '8px 14px', fontFamily: th.fontMono, fontSize: 13.5, fontWeight: 600, letterSpacing: 0.8,
      }}>
      {copiedId === s.id ? 'Copié !' : s.offerCode}
    </button>
  );

  // Zone principale cliquable : ancre si le partenaire a un site, sinon simple bloc.
  // Le bouton code reste un sibling (un <button> dans un <a> copierait ET naviguerait).
  const clickable = (s: Sponsor, children: React.ReactNode, style: React.CSSProperties) =>
    s.linkUrl
      ? <a href={s.linkUrl} target="_blank" rel="noreferrer" aria-label={`Voir le site de ${s.name}`} style={{ textDecoration: 'none', color: 'inherit', ...style }}>{children}</a>
      : <div style={style}>{children}</div>;

  const expiryChip = (s: Sponsor, onGradient = false) => {
    const e = expiry(s);
    if (!e) return null;
    return (
      <span style={{
        fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap', borderRadius: 999, padding: '3px 9px',
        background: e.urgent ? ACCENTS.coral : onGradient ? 'rgba(24,21,14,0.06)' : th.surface2,
        color: e.urgent ? '#fff' : onGradient ? th.text : th.textMute,
      }}>
        {e.text}
      </span>
    );
  };

  return (
    <div ref={sectionRef} className={`po-sec${inView ? ' is-in' : ''}`} style={{ padding: '30px 20px 0' }}>
      <style>{`
        .po-grid{display:grid;grid-template-columns:1fr;gap:14px}
        @media(min-width:600px){.po-grid{grid-template-columns:1fr 1fr}}

        /* Entrée en cascade (fade + slide-up) déclenchée par .is-in */
        .po-sec .po-block{opacity:0;transform:translateY(16px);transition:opacity .55s ease,transform .55s ease}
        .po-sec.is-in .po-block{opacity:1;transform:none}
        .po-sec.is-in .po-d1{transition-delay:.09s}
        .po-sec.is-in .po-d2{transition-delay:.18s}

        /* Carte à la une : halo lumineux qui dérive et respire */
        .po-featured{position:relative;overflow:hidden}
        .po-halo{position:absolute;inset:-45%;pointer-events:none;border-radius:50%;
          background:radial-gradient(circle at 32% 30%,rgba(255,255,255,0.26),rgba(255,255,255,0) 62%);
          animation:po-drift 9s ease-in-out infinite}
        @keyframes po-drift{
          0%{transform:translate(-6%,-4%) scale(1);opacity:.65}
          50%{transform:translate(9%,7%) scale(1.18);opacity:1}
          100%{transform:translate(-6%,-4%) scale(1);opacity:.65}}
        .po-featured:hover .po-halo{opacity:1;transform:translate(9%,7%) scale(1.22)}

        /* Micro-zoom au survol */
        .po-card{transition:transform .25s ease,box-shadow .25s ease}
        .po-card:hover{transform:scale(1.03);box-shadow:0 10px 26px rgba(0,0,0,0.10)}
        .po-logo{transition:transform .25s ease}
        .po-logo:hover{transform:scale(1.07)}

        /* Cartes partenaires (logos seuls) : grille + reflet qui balaye au survol */
        .po-pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
        .po-pcard{position:relative;overflow:hidden}
        .po-pcard .po-shine{position:absolute;top:0;left:-120%;width:55%;height:100%;
          background:linear-gradient(115deg,transparent,rgba(255,255,255,0.45),transparent);
          transform:skewX(-18deg);transition:left .7s ease;pointer-events:none}
        .po-pcard:hover .po-shine{left:150%}

        @media(prefers-reduced-motion:reduce){
          .po-sec .po-block{opacity:1!important;transform:none!important;transition:none!important}
          .po-halo{animation:none!important}
          .po-featured:hover .po-halo{transform:none!important}
          .po-card:hover,.po-logo:hover{transform:none!important}
          .po-pcard .po-shine{display:none!important}
        }
      `}</style>
      <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase', color: th.textMute, marginBottom: 14 }}>{(featured || gridSponsors.length > 0) ? 'Offres partenaires' : 'Nos partenaires'}</div>

      {/* Partenaire à la une */}
      {featured && (
        <div data-testid="featured-partner" className="po-block po-featured" style={{ background: HERO_GRADIENT, borderRadius: 20, padding: '26px 24px', color: th.text, marginBottom: 14 }}>
          <div className="po-halo" aria-hidden="true" />
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {clickable(featured, (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', opacity: 0.8 }}>Partenaire à la une</span>
                  <span style={{ flex: 1 }} />
                  {expiryChip(featured, true)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 14 }}>
                  {logoTile(featured, 64)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: th.fontUI, fontSize: 15, fontWeight: 700, opacity: 0.85 }}>{featured.name}</div>
                    <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, letterSpacing: -0.4, lineHeight: 1.2, marginTop: 4 }}>{featured.offerText}</div>
                  </div>
                  {featured.linkUrl && <Icon name="chevR" size={20} color={th.textMute} />}
                </div>
              </>
            ), { display: 'block' })}
            {codeButton(featured, true)}
          </div>
        </div>
      )}

      {/* Offres actives en grille */}
      {gridSponsors.length > 0 && (
        <div className="po-grid po-block po-d1">
          {gridSponsors.map((s) => (
            <div key={s.id} data-testid={`partner-${s.id}`} className="po-card" style={{ background: th.surface, borderRadius: 16, padding: '16px 18px', boxShadow: `inset 0 0 0 1px ${th.line}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {clickable(s, (
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  {logoTile(s, 54)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: th.fontUI, fontSize: 15.5, fontWeight: 700, color: th.text }}>{s.name}</span>
                      <span style={{ flex: 1 }} />
                      {expiryChip(s)}
                    </div>
                    <div style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.textMute, marginTop: 3, lineHeight: 1.4 }}>{s.offerText}</div>
                  </div>
                  {s.linkUrl && <Icon name="chevR" size={18} color={th.textFaint} />}
                </div>
              ), { display: 'block' })}
              {codeButton(s)}
            </div>
          ))}
        </div>
      )}

      {/* Partenaires sans offre (ou offre expirée) : grandes cartes logo + nom */}
      {logoOnly.length > 0 && (
        <div className="po-block po-d2" style={{ marginTop: (featured || gridSponsors.length > 0) ? 20 : 0 }}>
          {(featured || gridSponsors.length > 0) && (
            <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: th.textFaint, marginBottom: 12 }}>Ils soutiennent le club</div>
          )}
          <div className="po-pgrid">
            {logoOnly.map((s) => {
              const card = (
                <>
                  <div className="po-shine" aria-hidden="true" />
                  {logoTile(s, 56)}
                  <div style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, color: th.text, textAlign: 'center', lineHeight: 1.25, position: 'relative' }}>{s.name}</div>
                </>
              );
              const cardStyle: React.CSSProperties = {
                background: th.surface, borderRadius: 16, padding: '20px 14px', boxShadow: `inset 0 0 0 1px ${th.line}`,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
              };
              return s.linkUrl
                ? <a key={s.id} className="po-card po-pcard" href={s.linkUrl} target="_blank" rel="noreferrer" aria-label={`Voir le site de ${s.name}`} style={{ textDecoration: 'none', color: 'inherit', ...cardStyle }}>{card}</a>
                : <div key={s.id} className="po-card po-pcard" style={cardStyle}>{card}</div>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}
