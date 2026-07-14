'use client';
import { PlayerSuggestion } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';
import { SectionHeader, listRowStyle } from '@/components/clubhouse/SectionHeader';
import { FollowButton } from '@/components/social/FollowButton';
import { FriendButton } from '@/components/social/FriendButton';
import { suggestionReason } from '@/lib/social';

// « Suggestions » : partenaires récents pas encore dans mon cercle. Masqué si vide.
export function SuggestionsRow({ suggestions, slug, token, now, onChange, onMessage }: {
  suggestions: PlayerSuggestion[];
  slug: string;
  token: string;
  now: Date | null;
  onChange: () => void;
  onMessage: (s: { id: string }) => void;
}) {
  const { th } = useTheme();
  if (suggestions.length === 0) return null;
  return (
    <section aria-label="Suggestions">
      <SectionHeader title="Suggestions" />
      {suggestions.map((s) => (
        <div key={s.id} style={listRowStyle(th)}>
          <Avatar firstName={s.firstName} lastName={s.lastName} avatarUrl={s.avatarUrl} size={36} color={colorForSeed(s.id)} />
          <div style={{ flex: 1, minWidth: 150 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.text, fontWeight: 600 }}>{s.firstName} {s.lastName}</span>
              {s.level != null && <LevelChip level={s.level} size="xs" />}
            </div>
            <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginTop: 1 }}>{suggestionReason(s.lastPlayedAt, now)}</div>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            <button type="button" aria-label={`Écrire à ${s.firstName} ${s.lastName}`} title="Envoyer un message" onClick={() => onMessage(s)}
              style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.text, borderRadius: 999, padding: '5px 9px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
              <Icon name="chat" size={15} color={th.textMute} />
            </button>
            <FollowButton slug={slug} userId={s.id} token={token} initial={{ iFollow: false }} size="xs" onChange={onChange} />
            {s.requestable && <FriendButton slug={slug} userId={s.id} token={token} relation={{ status: 'none', requestable: true }} onChange={onChange} />}
          </span>
        </div>
      ))}
    </section>
  );
}
