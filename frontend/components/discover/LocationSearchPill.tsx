'use client';
import { useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';

// Barre de recherche flottante des heros brume (vitrine + /decouvrir) : pilule BLANCHE à encres
// fixes (elle vit sur la brume — identique clair/sombre), épingle accent, bouton « Autour de
// moi » en encre. Posée à cheval sur le bord bas du hero (margin-top négatif). Contrôlée par le
// parent : la vitrine navigue au submit, /decouvrir filtre en direct (onSubmit omis).
const PILL_INK = '#1b2a3f';

export function LocationSearchPill({ value, onChange, onSubmit, onNearMe, nearActive, locating }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  onNearMe: () => void;
  nearActive: boolean;
  locating: boolean;
}) {
  const { th } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '-29px 20px 0', position: 'relative', zIndex: 3 }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: 'min(640px, 100%)', height: 58,
          background: '#ffffff', borderRadius: 999, padding: '8px 8px 8px 18px',
          boxShadow: `0 2px 6px rgba(27,42,63,.08), 0 18px 44px rgba(27,42,63,.22)${focused ? `, 0 0 0 3px ${ACCENTS.blue}55` : ''}`,
        }}
      >
        <svg aria-hidden="true" width="18" height="22" viewBox="0 0 16 22" style={{ flexShrink: 0 }}>
          <path fill={ACCENTS.blue} d="M8 0C3.6 0 0 3.6 0 8c0 5.2 8 14 8 14s8-8.8 8-14c0-4.4-3.6-8-8-8z" />
          <circle fill="#fff" cx="8" cy="8" r="3" />
        </svg>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSubmit?.(); }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Ville, code postal ou département"
          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
            fontFamily: th.fontUI, fontSize: 15, color: PILL_INK }}
        />
        <button
          onClick={onNearMe}
          style={{ flexShrink: 0, border: 'none', cursor: 'pointer', height: 42, borderRadius: 999,
            background: PILL_INK, color: '#f4f6fa', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700,
            padding: '0 18px', whiteSpace: 'nowrap' }}
        >
          {locating ? 'Localisation…' : nearActive ? 'Autour de moi ✓' : 'Autour de moi'}
        </button>
      </div>
    </div>
  );
}
