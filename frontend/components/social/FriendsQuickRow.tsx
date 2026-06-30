'use client';
import { useEffect, useState } from 'react';
import { api, Friend } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';

// Rangée horizontale « Mes amis » : ajout en un tap des amis membres de ce club.
// Filtre par `query` (optionnel) et masque `excludeIds` (déjà ajoutés). Rien si liste vide.
export function FriendsQuickRow({ slug, token, excludeIds, query, onPick }: {
  slug: string;
  token: string;
  excludeIds: string[];
  query?: string;
  onPick: (friend: Friend) => void;
}) {
  const { th } = useTheme();
  const [friends, setFriends] = useState<Friend[]>([]);

  useEffect(() => {
    let alive = true;
    api.listClubFriends(slug, token).then((fs) => { if (alive) setFriends(fs); }).catch(() => {});
    return () => { alive = false; };
  }, [slug, token]);

  const q = (query ?? '').trim().toLowerCase();
  const visible = friends.filter((f) =>
    !excludeIds.includes(f.id) &&
    (!q || `${f.firstName} ${f.lastName}`.toLowerCase().includes(q)));

  if (visible.length === 0) return null;

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Mes amis</div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        {visible.map((f) => (
          <button key={f.id} type="button" onClick={() => onPick(f)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, border: `1px solid ${th.line}`, background: th.surface2, borderRadius: 999, padding: '4px 11px 4px 4px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
            <Avatar firstName={f.firstName} lastName={f.lastName} avatarUrl={f.avatarUrl} size={26} color={colorForSeed(f.id)} />
            <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.text, fontWeight: 600 }}>{f.firstName}</span>
            <LevelChip level={f.level} size="xs" />
          </button>
        ))}
      </div>
    </div>
  );
}
