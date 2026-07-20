'use client';
import { useTheme } from '@/lib/ThemeProvider';

// Pastille « la grille vit toute seule » : point accent qui pulse. En coupure,
// EventSource se reconnecte nativement → « Reconnexion… » (jamais d'état figé muet).
export function LiveDot({ status }: { status: 'live' | 'reconnecting' }) {
  const { th } = useTheme();
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontFamily: th.fontUI, fontSize: 12, color: th.textMute, whiteSpace: 'nowrap',
    }}>
      <style>{`@keyframes pl-live-pulse{0%,100%{opacity:1}50%{opacity:.35}}
        @media (prefers-reduced-motion: reduce){.pl-live-dot{animation:none !important}}`}</style>
      <span className="pl-live-dot" aria-hidden style={{
        width: 7, height: 7, borderRadius: '50%',
        background: status === 'live' ? th.accent : th.textFaint,
        animation: status === 'live' ? 'pl-live-pulse 2s ease-in-out infinite' : 'none',
      }} />
      {status === 'live' ? 'En direct' : 'Reconnexion…'}
    </span>
  );
}
