'use client';
import { Fragment } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { UserLevel } from '@/lib/api';
import { LevelChip } from './LevelChip';

export interface PlayerPillData {
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  isOrganizer?: boolean;
  participantId?: string;
  level?: UserLevel | null;
}

// Rangée de pastilles de joueurs façon Parties ouvertes : avatar coloré (couleur par userId),
// badge « orga », × de retrait optionnel, puis N cases « Place libre » en pointillés.
export function PlayerPills({
  players, spotsLeft = 0, onRemove, canRemove, busy = false, size = 'md', showOrgaBadge = true, firstSpotSlot, friendIds,
  onMessage, viewerUserId,
}: {
  players: PlayerPillData[];
  spotsLeft?: number;
  onRemove?: (player: PlayerPillData) => void;
  canRemove?: (player: PlayerPillData) => boolean;
  busy?: boolean;
  size?: 'sm' | 'md';
  showOrgaBadge?: boolean;
  firstSpotSlot?: React.ReactNode;
  /** Ids des joueurs suivis (amis) : anneau d'accent autour de leur avatar. Absent ⇒ markup inchangé. */
  friendIds?: Set<string>;
  /** Additif (messagerie 1-à-1) : bouton 💬 sur les pastilles des AUTRES joueurs. Absent ⇒ markup inchangé. */
  onMessage?: (player: PlayerPillData) => void;
  viewerUserId?: string;
}) {
  const { th } = useTheme();
  const av = size === 'sm' ? 20 : 22;
  const fs = size === 'sm' ? 12.5 : 13;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {players.map((p) => {
        const c = colorForSeed(p.userId);
        const removable = !!onRemove && (canRemove ? canRemove(p) : true);
        const isFriend = !!friendIds?.has(p.userId);
        const avatar = <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl ?? null} size={av} color={c} />;
        return (
          <span key={p.userId} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: `${c}22`, border: `1px solid ${c}`,
            borderRadius: 999, padding: '4px 11px 4px 4px',
            fontFamily: th.fontUI, fontSize: fs, fontWeight: 600, color: th.text,
          }}>
            {isFriend ? (
              <span title="Vous suivez ce joueur" style={{ display: 'inline-flex', borderRadius: '50%', padding: 1.5, background: th.accent, flexShrink: 0 }}>{avatar}</span>
            ) : avatar}
            {p.firstName} {p.lastName}
            <LevelChip level={p.level} size="xs" />
            {showOrgaBadge && p.isOrganizer && (
              <span style={{ fontSize: 10, fontWeight: 700, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.3 }}>orga</span>
            )}
            {onMessage && p.userId !== viewerUserId && (
              <button type="button" disabled={busy} aria-label={`Écrire à ${p.firstName}`} title="Envoyer un message"
                onClick={() => onMessage(p)}
                style={{ border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer', color: th.textMute, fontSize: 13, lineHeight: 1, padding: 0, marginLeft: 2 }}>💬</button>
            )}
            {removable && (
              <button type="button" disabled={busy} aria-label={`Retirer ${p.firstName} ${p.lastName}`} title="Retirer ce joueur"
                onClick={() => onRemove!(p)}
                style={{ border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer', color: th.textMute, fontSize: 15, lineHeight: 1, padding: 0, marginLeft: 2 }}>×</button>
            )}
          </span>
        );
      })}
      {Array.from({ length: Math.max(0, spotsLeft) }).map((_, i) =>
        i === 0 && firstSpotSlot ? (
          <Fragment key="first-spot">{firstSpotSlot}</Fragment>
        ) : (
          <span key={`spot-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '4px 12px 4px 4px', border: `1.5px dashed ${th.lineStrong}`, fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>
            <span aria-hidden="true" style={{ width: av, height: av, borderRadius: '50%', flexShrink: 0, border: `1.5px dashed ${th.lineStrong}` }} />
            Place libre
          </span>
        ),
      )}
    </div>
  );
}
