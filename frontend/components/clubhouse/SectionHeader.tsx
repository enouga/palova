'use client';
import Link from 'next/link';
import { useTheme } from '@/lib/ThemeProvider';
import type { Theme } from '@/lib/theme';

/** Langage carte commun du Club-house : surface + ombre douce (remplace la bordure inset). */
export function cardStyle(th: Theme): React.CSSProperties {
  return {
    background: th.surface,
    borderRadius: 18,
    boxShadow: th.mode === 'floodlit'
      ? `0 14px 34px rgba(0,0,0,0.42), inset 0 0 0 1px ${th.line}`
      : '0 14px 34px rgba(24,21,16,0.08), 0 1px 2px rgba(24,21,16,0.05)',
  };
}

/** Titre de section éditorial : display 21px + action optionnelle à droite. */
export function SectionHeader({ title, action }: { title: string; action?: { label: string; href: string } }) {
  const { th } = useTheme();
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 13 }}>
      <h2 style={{ margin: 0, fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 21, letterSpacing: -0.3, color: th.text }}>{title}</h2>
      {action && (
        <Link href={action.href} style={{ marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.accent, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          {action.label}
        </Link>
      )}
    </div>
  );
}
