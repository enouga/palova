'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { ConversationSummary } from '@/lib/api';
import { inboxPreview } from '@/lib/messages';
import { relativeTime } from '@/lib/notifications';

// Boîte de réception : avatar coloré, aperçu, heure relative, badge non-lus.
// `now` posé par le parent en effet (hydration-safe) ; null au 1er rendu → pas d'heure.
export function ConversationList({ conversations, selectedId, now, onSelect }: {
  conversations: ConversationSummary[];
  selectedId: string | null;
  now: Date | null;
  onSelect: (c: ConversationSummary) => void;
}) {
  const { th } = useTheme();
  if (conversations.length === 0) {
    return (
      <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, padding: '24px 16px', textAlign: 'center' }}>
        Aucune conversation. Écrivez à un membre depuis « Mes amis », une partie ou l&apos;annuaire.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {conversations.map((c) => (
        <button key={c.id} type="button" onClick={() => onSelect(c)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', textAlign: 'left',
            border: 'none', cursor: 'pointer', borderBottom: `1px solid ${th.line}`,
            background: selectedId === c.id ? th.surface : 'transparent',
            borderLeft: selectedId === c.id ? `3px solid ${th.accent}` : '3px solid transparent' }}>
          <Avatar firstName={c.other.firstName} lastName={c.other.lastName} avatarUrl={c.other.avatarUrl}
            size={38} color={colorForSeed(c.other.userId)} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontFamily: th.fontUI, fontWeight: c.unreadCount > 0 ? 700 : 600, fontSize: 14.5, color: th.text }}>
                {c.other.firstName} {c.other.lastName}
              </span>
              {now && c.lastMessageAt && (
                <span style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, whiteSpace: 'nowrap' }}>
                  {relativeTime(c.lastMessageAt, now)}
                </span>
              )}
            </span>
            <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 13, marginTop: 1,
              color: c.unreadCount > 0 ? th.text : th.textMute, fontWeight: c.unreadCount > 0 ? 600 : 400,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {inboxPreview(c)}
            </span>
          </span>
          {c.unreadCount > 0 && (
            <span style={{ background: th.danger, color: '#fff', borderRadius: 999, minWidth: 20, height: 20,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, padding: '0 6px' }}>
              {c.unreadCount > 99 ? '99+' : c.unreadCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
