'use client';
import { ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';

interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
}

/** Interrupteur (switch) avec titre + description optionnelle. Remplace les cases à cocher brutes. */
export function SwitchRow({ checked, onChange, title, description }: Props) {
  const { th } = useTheme();
  return (
    <div
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onChange(!checked); } }}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer', padding: '4px 0' }}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0, marginTop: 1, width: 42, height: 24, borderRadius: 999,
          background: checked ? th.accent : th.line, position: 'relative', transition: 'background .15s',
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: checked ? 21 : 3, width: 18, height: 18, borderRadius: '50%',
          background: '#fff', transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
        }} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span style={{ fontFamily: th.fontUI, fontSize: 15, fontWeight: 600, color: th.text }}>{title}</span>
        {description && <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, lineHeight: 1.4 }}>{description}</span>}
      </span>
    </div>
  );
}
