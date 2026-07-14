'use client';
import { useState } from 'react';
import { Friend } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { SectionHeader } from '@/components/clubhouse/SectionHeader';

// « Favoris ★ » : chips compactes (avatar + prénom). Tap = barre d'actions rapides
// sous la rangée (💬 message / ⚡ inviter / retirer ★). Masqué si vide.
export function FavoritesRow({ favorites, onMessage, onInvite, onRemove }: {
  favorites: Friend[];
  onMessage: (f: Friend) => void;
  onInvite: (f: Friend) => void;
  onRemove: (f: Friend) => void;
}) {
  const { th } = useTheme();
  const [openId, setOpenId] = useState<string | null>(null);
  if (favorites.length === 0) return null;
  const selected = favorites.find((f) => f.id === openId) ?? null;

  const action: React.CSSProperties = {
    border: `1px solid ${th.line}`, background: 'transparent', color: th.text, borderRadius: 999,
    padding: '5px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  };

  return (
    <section aria-label="Favoris">
      <SectionHeader title={`Favoris ★ · ${favorites.length}`} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {favorites.map((f) => (
          <button key={f.id} type="button" aria-expanded={openId === f.id}
            onClick={() => setOpenId((o) => (o === f.id ? null : f.id))}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7,
              border: `1px solid ${openId === f.id ? th.accent : th.line}`, background: th.surface,
              borderRadius: 999, padding: '5px 12px 5px 5px', cursor: 'pointer' }}>
            <Avatar firstName={f.firstName} lastName={f.lastName} avatarUrl={f.avatarUrl} size={28} color={colorForSeed(f.id)} />
            <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.text }}>{f.firstName}</span>
          </button>
        ))}
      </div>
      {selected && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>{selected.firstName} {selected.lastName} :</span>
          <button type="button" style={action} onClick={() => onInvite(selected)}>⚡ Inviter</button>
          <button type="button" style={action} onClick={() => onMessage(selected)}>💬 Message</button>
          <button type="button" style={action} onClick={() => { onRemove(selected); setOpenId(null); }}>Retirer ★</button>
        </div>
      )}
    </section>
  );
}
