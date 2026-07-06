'use client';
import { ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { inkOn } from '@/lib/theme';

/** Palette fixe du wizard (fond sombre théâtral, volontairement indépendante du thème clair/sombre). */
export const WIZ = {
  bg: '#0d1017',
  bg2: '#131b2c',
  text: '#ffffff',
  mute: '#9aa3b5',
  faint: '#6b7383',
  line: 'rgba(255,255,255,.18)',
  card: 'rgba(255,255,255,.06)',
} as const;

/** Surtitre accent + titre display + sous-titre rassurant d'une étape. */
export function WizHeader({ surtitle, title, sub, accent }: { surtitle: string; title: ReactNode; sub?: string; accent: string }) {
  const { th } = useTheme();
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ color: accent, fontFamily: th.fontUI, fontSize: 11, letterSpacing: 2.5, textTransform: 'uppercase', fontWeight: 700, marginBottom: 10 }}>{surtitle}</div>
      <div style={{ color: WIZ.text, fontFamily: th.fontDisplay, fontSize: 32, lineHeight: 1.08, fontWeight: 600 }}>{title}</div>
      {sub && <div style={{ color: WIZ.mute, fontFamily: th.fontUI, fontSize: 13.5, lineHeight: 1.5, marginTop: 8 }}>{sub}</div>}
    </div>
  );
}

export function WizLabel({ children }: { children: ReactNode }) {
  const { th } = useTheme();
  return <div style={{ color: WIZ.mute, fontFamily: th.fontUI, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>{children}</div>;
}

export function WizError({ children }: { children: ReactNode }) {
  const { th } = useTheme();
  return (
    <div role="alert" style={{ background: 'rgba(255,122,77,.14)', color: '#ffb59d', borderRadius: 10, padding: '10px 13px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
      {children}
    </div>
  );
}

/** CTA « Continuer → » (garde busy) + « Passer cette étape » discret. */
export function WizActions({ accent, busy, onNext, onSkip, nextLabel = 'Continuer →' }: {
  accent: string; busy: boolean; onNext: () => void; onSkip?: () => void; nextLabel?: string;
}) {
  const { th } = useTheme();
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 22, flexWrap: 'wrap' }}>
      <button type="button" onClick={onNext} disabled={busy} style={{
        background: accent, color: inkOn(accent), border: 'none', borderRadius: 12,
        padding: '12px 26px', fontFamily: th.fontUI, fontSize: 14, fontWeight: 800,
        cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
      }}>
        {busy ? 'Enregistrement…' : nextLabel}
      </button>
      {onSkip && (
        <button type="button" onClick={onSkip} disabled={busy}
          style={{ background: 'transparent', border: 'none', color: WIZ.mute, fontFamily: th.fontUI, fontSize: 13, cursor: 'pointer' }}>
          Passer cette étape
        </button>
      )}
    </div>
  );
}
