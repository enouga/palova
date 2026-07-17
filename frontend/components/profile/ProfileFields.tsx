'use client';
import { CSSProperties, ReactNode, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';

/**
 * Bloc de champ « label intégré » : le libellé vit DANS le bloc, en petites capitales.
 * Le libellé peint est `aria-hidden` — c'est le champ qui porte l'`aria-label`, sinon
 * un lecteur d'écran annoncerait deux fois le même mot.
 * `focused` colore le bord + le libellé (piloté par le champ qui vit dedans).
 */
export function FieldShell({ label, focused, children }: { label: string; focused?: boolean; children: ReactNode }) {
  const { th } = useTheme();
  return (
    <div style={{
      background: th.surface2, borderRadius: 13, padding: '19px 13px 12px', position: 'relative',
      boxShadow: focused
        ? `inset 0 0 0 1.5px ${th.accent}, 0 0 0 3px ${th.accent}29`
        : `inset 0 0 0 1px ${th.lineStrong}`,
      transition: 'box-shadow .15s',
    }}>
      <span aria-hidden style={{
        position: 'absolute', top: 7, left: 13, fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700,
        letterSpacing: 0.4, textTransform: 'uppercase', color: focused ? th.accent : th.textFaint,
      }}>{label}</span>
      {children}
    </div>
  );
}

/** Style du champ nu posé dans un FieldShell : le bloc porte la bordure, pas l'input. */
function useBareStyle(): CSSProperties {
  const { th } = useTheme();
  return {
    width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none', outline: 'none',
    padding: 0, margin: 0, fontFamily: th.fontUI, fontSize: 16.5, color: th.text,
  };
}

export function ProfileInput({ label, value, onChange, type = 'text', placeholder, autoComplete }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: 'text' | 'password'; placeholder?: string; autoComplete?: string;
}) {
  const [focused, setFocused] = useState(false);
  const bare = useBareStyle();
  return (
    <FieldShell label={label} focused={focused}>
      <input
        type={type} value={value} placeholder={placeholder} autoComplete={autoComplete} aria-label={label}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value)} style={bare}
      />
    </FieldShell>
  );
}

export function ProfileSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const { th } = useTheme();
  const [focused, setFocused] = useState(false);
  const bare = useBareStyle();
  return (
    <FieldShell label={label} focused={focused}>
      <select
        value={value} aria-label={label}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value)}
        // Fond opaque : sans lui, le popup d'options hérite du blanc UA et th.text (quasi blanc
        // en floodlit) devient illisible dessus. Le bloc FieldShell est déjà th.surface2 fermé,
        // donc ça ne change rien visuellement quand le select est fermé.
        style={{ ...bare, cursor: 'pointer', background: th.surface2 }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </FieldShell>
  );
}

/** Choix court (2-4 valeurs) rendu en pills DANS le bloc de champ : sexe, sport préféré… */
export function PillChoice<T extends string>({ label, value, onChange, options }: {
  label: string; value: T | null; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  const { th } = useTheme();
  return (
    <FieldShell label={label}>
      <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 3 }}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value} type="button" aria-pressed={active} onClick={() => onChange(o.value)}
              style={{
                cursor: 'pointer', border: 'none', borderRadius: 999, padding: '8px 17px',
                fontFamily: th.fontUI, fontSize: 14.5, fontWeight: active ? 700 : 600,
                background: active ? th.accent : th.surfaceHi,
                color: active ? th.onAccent : th.textMute,
              }}
            >{o.label}</button>
          );
        })}
      </div>
    </FieldShell>
  );
}
