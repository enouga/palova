'use client';

import { CSSProperties, ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';

/**
 * App shell: a centered column, full width on phones and capped on desktop, painted
 * with the current theme background. Default cap = 820px (largeur unique des pages
 * joueur) ; surchargeable via `style={{ maxWidth }}` si besoin.
 */
export function Screen({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const { th } = useTheme();
  return (
    <div style={{ minHeight: '100vh', width: '100%', display: 'flex', justifyContent: 'center', background: th.bg }}>
      <div style={{ width: '100%', maxWidth: 820, minHeight: '100vh', position: 'relative', background: th.bg, ...style }}>
        {children}
      </div>
    </div>
  );
}
