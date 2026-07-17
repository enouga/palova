'use client';
import { ReactNode } from 'react';
import { ACCENTS } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeProvider';

/**
 * Kicker éditorial d'une carte : tiret accent + libellé en petites capitales.
 * Remplace les anciens `cardTitle` gris. `tone='coral'` est réservé aux zones
 * sensibles (suppression de compte) — il colore aussi le texte.
 */
export function CardKicker({ children, tone = 'accent' }: { children: ReactNode; tone?: 'accent' | 'coral' }) {
  const { th } = useTheme();
  const dash = tone === 'coral' ? ACCENTS.coral : th.accent;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span aria-hidden style={{ width: 16, height: 3, borderRadius: 2, background: dash, flexShrink: 0 }} />
      <span style={{
        fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 1.2,
        textTransform: 'uppercase', color: tone === 'coral' ? ACCENTS.coral : th.textFaint,
      }}>{children}</span>
    </div>
  );
}
