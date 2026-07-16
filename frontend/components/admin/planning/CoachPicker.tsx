'use client';
import { useRef, useState } from 'react';
import type { Coach } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';

export interface CoachPickerProps {
  coaches: Coach[];
  value: Coach | null;
  onSelect: (c: Coach) => void;
  onClear: () => void;
  placeholder?: string;
}

// « Lucas Moreau » → { first: 'Lucas', last: 'Moreau' } (initiales de repli de l'Avatar).
function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}

// Sélecteur de coach cherchable — même identité visuelle que PlayerPicker (Membre) :
// loupe + bordure accent, liste avatar+nom, chip « Changer » une fois sélectionné.
// Contrairement à PlayerPicker, pas de flux de création : un coach se nomme depuis /admin/membres.
export function CoachPicker({ coaches, value, onSelect, onClear, placeholder }: CoachPickerProps) {
  const { th } = useTheme();
  const [query, setQuery] = useState('');
  const [open, setOpen]   = useState(false);
  const inputRef          = useRef<HTMLInputElement>(null);

  const showChip = !!value;
  const q = query.trim().toLowerCase();
  const showList = !showChip && (open || q.length > 0);
  const matches = showList
    ? (q ? coaches.filter((c) => c.name.toLowerCase().includes(q)) : coaches).slice(0, 8)
    : [];

  const pick = (c: Coach) => { setQuery(''); setOpen(false); onSelect(c); };

  const input = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '8px 10px', fontFamily: th.fontUI, fontSize: 14 } as const;
  const searchInput = { ...input, border: `1.5px solid ${th.accent}`, borderRadius: 10, padding: '11px 12px 11px 38px', fontSize: 14.5, outline: 'none', boxShadow: open ? `0 0 0 3px ${th.accent}22` : 'none', transition: 'box-shadow .15s ease' } as const;

  return (
    <div style={{ position: 'relative' }}>
      {showChip ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${th.line}`, borderRadius: 8, padding: '8px 10px' }}>
          <Avatar firstName={splitName(value!.name).first} lastName={splitName(value!.name).last} avatarUrl={value!.photoUrl} size={26} color={colorForSeed(value!.id)} />
          <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14, color: th.text }}>{value!.name}</span>
          <button type="button" onClick={() => { setQuery(''); setOpen(true); onClear(); }}
            style={{ border: 'none', background: th.surface2, cursor: 'pointer', borderRadius: 8, padding: '3px 8px', color: th.textMute, fontSize: 12 }}>Changer</button>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <span data-testid="coach-search-loupe" aria-hidden style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', pointerEvents: 'none' }}>
            <Icon name="search" size={16} color={th.textMute} />
          </span>
          <input ref={inputRef} type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder ?? 'Rechercher un coach…'}
            onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
            style={{ ...searchInput, width: '100%', boxSizing: 'border-box' }} />
        </div>
      )}

      {showList && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 10, maxHeight: 240, overflowY: 'auto', background: th.surface, border: `1px solid ${th.line}`, borderRadius: 8, marginTop: 4, boxShadow: th.shadowSoft, padding: 4 }}>
          {matches.length === 0 ? (
            <div style={{ padding: '8px 10px', fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
              {coaches.length === 0 ? 'Aucun coach actif dans ce club — nommez-en un depuis Membres.' : 'Aucun coach trouvé.'}
            </div>
          ) : matches.map((c) => {
            const { first, last } = splitName(c.name);
            return (
              <button key={c.id} type="button" onClick={() => pick(c)}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={(e) => { e.currentTarget.style.background = th.surface2; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 10, padding: '8px 6px', fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
                <Avatar firstName={first} lastName={last} avatarUrl={c.photoUrl} size={28} color={colorForSeed(c.id)} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{c.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
