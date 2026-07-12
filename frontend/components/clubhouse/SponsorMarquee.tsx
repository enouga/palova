'use client';
import { useState } from 'react';
import { Sponsor, assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { offerIsActive } from '@/lib/clubhouse';
import { deadlineCountdown } from '@/lib/tournament';
import { ACCENTS } from '@/lib/theme';
import { SectionHeader } from '@/components/clubhouse/SectionHeader';

// Rivière des partenaires : le logo est la carte (tuile blanche XL), nom +
// offre dessous ; boucle CSS pure avec pause au survol, statique si ≤ 2
// sponsors ou reduced-motion.
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
    const tile = (
      <div style={{ width: 150, height: 84, borderRadius: 12, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 1px 4px rgba(20,40,80,.14)`, padding: 10 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assetUrl(s.logoUrl) ?? ''} alt={s.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
      </div>
    );
    const name = (
      <div style={{ marginTop: 8, fontFamily: th.fontUI, fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: th.text, textAlign: 'center' }}>
        {s.name}
      </div>
    );
    return (
      <div key={`${s.id}-${i}`} style={{ width: 150, flexShrink: 0, textAlign: 'center' }}>
        {s.linkUrl
          ? <a href={s.linkUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', display: 'block' }}>{tile}{name}</a>
          : <>{tile}{name}</>}
        {active && (s.offerText || s.offerCode) && (
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            {s.offerText && (
              <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, color: th.accent, background: `${th.accent}1c`, borderRadius: 7, padding: '3px 8px', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.offerText}
              </span>
            )}
            {s.offerCode && (
              <button onClick={() => copy(s)} aria-label={`Copier le code ${s.offerCode}`} style={{
                border: 'none', cursor: 'pointer', fontFamily: th.fontMono, fontSize: 11, fontWeight: 700,
                color: '#fff', background: th.text, borderRadius: 7, padding: '3px 8px',
              }}>
                {copiedId === s.id ? '✓ Copié' : s.offerCode}
              </button>
            )}
            {expiry?.urgent && (
              <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, color: ACCENTS.coral }}>{expiry.text}</span>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <section style={{ padding: '26px 0 8px' }}>
      <div style={{ padding: '0 20px' }}>
        <SectionHeader title="Nos partenaires" />
      </div>
      <style>{`
        .sp-marquee { overflow: hidden; position: relative; }
        .sp-marquee::before, .sp-marquee::after { content: ''; position: absolute; top: 0; bottom: 0; width: 32px; z-index: 2; pointer-events: none; }
        .sp-marquee::before { left: 0; background: linear-gradient(90deg, ${th.bg}, transparent); }
        .sp-marquee::after { right: 0; background: linear-gradient(-90deg, ${th.bg}, transparent); }
        .sp-track { display: flex; gap: 16px; width: max-content; padding: 2px 20px; align-items: flex-start; }
        .sp-track[data-scrolling='true'] { animation: sp-slide ${Math.max(22, sponsors.length * 8)}s linear infinite; }
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
