'use client';
import { Friend } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';
import { cardStyle } from '@/components/clubhouse/SectionHeader';
import { playedTogetherLine } from '@/lib/social';

// Carte riche d'un ami confirmé : identité + niveau + ligne vivante « N parties ensemble »
// + actions ⚡ Inviter à jouer / 💬 message / Retirer.
export function FriendCard({ friend, now, busy, onInvite, onMessage, onRemove }: {
  friend: Friend;
  now: Date | null;
  busy?: boolean;
  onInvite: (f: Friend) => void;
  onMessage: (f: Friend) => void;
  onRemove: (f: Friend) => void;
}) {
  const { th } = useTheme();
  const line = playedTogetherLine(friend, now);
  return (
    <div style={{ ...cardStyle(th), padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar firstName={friend.firstName} lastName={friend.lastName} avatarUrl={friend.avatarUrl} size={40} color={colorForSeed(friend.id)} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: th.fontUI, fontSize: 15, fontWeight: 700, color: th.text }}>{friend.firstName} {friend.lastName}</div>
          {line && <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 1 }}>{line}</div>}
        </div>
        {friend.level != null && <LevelChip level={friend.level} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" disabled={busy} onClick={() => onInvite(friend)}
          style={{ border: `1px solid ${th.accent}`, background: 'transparent', color: th.accent, borderRadius: 999,
            padding: '6px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          ⚡ Inviter à jouer
        </button>
        <button type="button" aria-label={`Écrire à ${friend.firstName} ${friend.lastName}`} title="Envoyer un message"
          onClick={() => onMessage(friend)}
          style={{ border: `1px solid ${th.line}`, background: 'transparent', borderRadius: 999, padding: '6px 10px',
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
          <Icon name="chat" size={15} color={th.textMute} />
        </button>
        <button type="button" disabled={busy} onClick={() => onRemove(friend)}
          style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: th.textMute,
            fontFamily: th.fontUI, fontSize: 12.5, cursor: 'pointer' }}>
          Retirer
        </button>
      </div>
    </div>
  );
}
