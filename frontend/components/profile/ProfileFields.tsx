'use client';
import { CSSProperties, ReactNode, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';

/** Libellé au-dessus d'un champ : petites capitales, même convention que le composant
 * `Field` des pages d'inscription (`components/ui/atoms.tsx`) — cohérence entre le
 * profil et l'onboarding. Peint `aria-hidden` (c'est le champ qui porte l'`aria-label`,
 * sinon un lecteur d'écran annoncerait deux fois le même mot). */
function FieldLabel({ label, focused }: { label: string; focused?: boolean }) {
  const { th } = useTheme();
  return (
    <span aria-hidden style={{
      display: 'block', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600,
      letterSpacing: 0.4, textTransform: 'uppercase', color: focused ? th.accent : th.textMute,
      marginBottom: 7,
    }}>{label}</span>
  );
}

/**
 * Bloc de champ : libellé au-dessus (petites capitales), champ dans une boîte arrondie
 * en dessous. `focused` colore le libellé + le bord de la boîte (piloté par le champ
 * qui vit dedans).
 */
export function FieldShell({ label, focused, children }: { label: string; focused?: boolean; children: ReactNode }) {
  const { th } = useTheme();
  return (
    <div>
      <FieldLabel label={label} focused={focused} />
      <div data-testid="field-box" style={{
        background: th.surface2, borderRadius: 13, padding: '12px 13px',
        boxShadow: focused
          ? `inset 0 0 0 1.5px ${th.accent}, 0 0 0 3px ${th.accent}29`
          : `inset 0 0 0 1px ${th.lineStrong}`,
        transition: 'box-shadow .15s',
      }}>
        {children}
      </div>
    </div>
  );
}

/** Style du champ nu posé dans la boîte : la boîte porte la bordure, pas l'input. */
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

/** Choix court (2-4 valeurs) en pills NUES sous le libellé — pas de boîte autour, les
 * pills portent déjà leur propre fond. `hideLabel` omet le libellé (ex. « Sport préféré »
 * quand la carte porte déjà ce titre via CardKicker juste au-dessus). */
export function PillChoice<T extends string>({ label, hideLabel, value, onChange, options }: {
  label: string; hideLabel?: boolean; value: T | null; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  const { th } = useTheme();
  return (
    <div>
      {!hideLabel && <FieldLabel label={label} />}
      <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
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
    </div>
  );
}
