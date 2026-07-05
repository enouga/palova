'use client';
import { useState } from 'react';
import { Sponsor, assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { offerIsActive } from '@/lib/clubhouse';
import { deadlineCountdown } from '@/lib/tournament';
import { ACCENTS } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';

// Rivière des partenaires : cartes riches défilantes (logo + nom + offre + code),
// boucle CSS pure avec pause au survol ; statique si ≤ 2 sponsors ou reduced-motion.
export function SponsorMarquee({ sponsors, now = null }: { sponsors: Sponsor[]; now?: Date | null }) {
  const { th } = useTheme();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  if (sponsors.length === 0) return null;
  const ref = now ?? new Date(0);
  const scrolling = sponsors.length > 2;
  const track = scrolling ? [...sponsors, ...sponsors] : sponsors;

  const copy = async (s: Sponsor) => {
    try { await navigator.clipboard.writeText(s.offerCode ?? ''); setCopiedId(s.id); setTimeout(() => setCopiedId(null), 1600); } catch { /* silencieux */ }
  };

  const card = (s: Sponsor, i: number) => {
    const active = offerIsActive(s, ref);
    const expiry = active && s.offerUntil && now ? deadlineCountdown(s.offerUntil, now) : null;
    const inner = (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assetUrl(s.logoUrl) ?? ''} alt={s.name} style={{ width: 46, height: 46, borderRadius: 11, objectFit: 'contain', background: '#fff', padding: 4, flexShrink: 0 }} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 13, fontWeight: 800, color: th.text, whiteSpace: 'nowrap' }}>{s.name}</span>
          {active && s.offerText && (
            <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 11.5, color: th.textMute, whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.offerText}</span>
          )}
          {expiry?.urgent && (
            <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, color: ACCENTS.coral }}>{expiry.text}</span>
          )}
        </span>
      </>
    );
    return (
      <span key={`${s.id}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, background: th.surface, borderRadius: 14, padding: '10px 14px', boxShadow: `inset 0 0 0 1px ${th.line}`, flexShrink: 0 }}>
        {s.linkUrl
          ? <a href={s.linkUrl} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>{inner}</a>
          : <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{inner}</span>}
        {active && s.offerCode && (
          <button onClick={() => copy(s)} aria-label={`Copier le code ${s.offerCode}`} style={{
            border: 'none', cursor: 'pointer', fontFamily: th.fontMono, fontSize: 11, fontWeight: 700,
            color: th.accent, background: `${th.accent}1c`, borderRadius: 8, padding: '4px 8px',
          }}>
            {copiedId === s.id ? '✓ Copié' : s.offerCode}
          </button>
        )}
      </span>
    );
  };

  return (
    <section style={{ padding: '26px 0 8px' }}>
      <div style={{ padding: '0 20px', display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
        <Icon name="share" size={15} color={th.textMute} />
        <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 12.5, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute }}>Nos partenaires</span>
      </div>
      <style>{`
        .sp-marquee { overflow: hidden; position: relative; }
        .sp-marquee::before, .sp-marquee::after { content: ''; position: absolute; top: 0; bottom: 0; width: 32px; z-index: 2; pointer-events: none; }
        .sp-marquee::before { left: 0; background: linear-gradient(90deg, ${th.bg}, transparent); }
        .sp-marquee::after { right: 0; background: linear-gradient(-90deg, ${th.bg}, transparent); }
        .sp-track { display: flex; gap: 12px; width: max-content; padding: 2px 20px; }
        .sp-track[data-scrolling='true'] { animation: sp-slide ${Math.max(18, sponsors.length * 6)}s linear infinite; }
        .sp-track[data-scrolling='true']:hover { animation-play-state: paused; }
        @keyframes sp-slide { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @media (prefers-reduced-motion: reduce) {
          .sp-track[data-scrolling='true'] { animation: none; flex-wrap: wrap; width: auto; }
        }
      `}</style>
      <div className="sp-marquee">
        <div className="sp-track" data-scrolling={scrolling}>
          {track.map((s, i) => card(s, i))}
        </div>
      </div>
    </section>
  );
}
