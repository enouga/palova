'use client';
import { useTheme } from '@/lib/ThemeProvider';

/** Kicker éditorial des sections de Mon Palova : tiret accent + petites capitales + lien « plus ». */
export function SectionHeader({ kicker, moreLabel, moreHref }: { kicker: string; moreLabel?: string; moreHref?: string }) {
  const { th } = useTheme();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 9px' }}>
      <span aria-hidden style={{ width: 14, height: 3, borderRadius: 2, background: th.accent }} />
      <span style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 800, letterSpacing: 1.8, textTransform: 'uppercase', color: th.textMute }}>{kicker}</span>
      {moreLabel && moreHref && (
        <a href={moreHref} style={{ marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.textMute, textDecoration: 'underline', textUnderlineOffset: 3 }}>{moreLabel}</a>
      )}
    </div>
  );
}
