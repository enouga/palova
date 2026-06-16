'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';

export interface PlayerPillData {
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  isOrganizer?: boolean;
  participantId?: string;
}

// Rangée de pastilles de joueurs façon Parties ouvertes : avatar coloré (couleur par userId),
// badge « orga », × de retrait optionnel, puis N cases « Place libre » en pointillés.
export function PlayerPills({
  players, spotsLeft = 0, onRemove, canRemove, busy = false, size = 'md', showOrgaBadge = true,
}: {
  players: PlayerPillData[];
  spotsLeft?: number;
  onRemove?: (player: PlayerPillData) => void;
  canRemove?: (player: PlayerPillData) => boolean;
  busy?: boolean;
  size?: 'sm' | 'md';
  showOrgaBadge?: boolean;
}) {
  const { th } = useTheme();
  const av = size === 'sm' ? 20 : 22;
  const fs = size === 'sm' ? 12.5 : 13;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {players.map((p) => {
        const c = colorForSeed(p.userId);
        const removable = !!onRemove && (canRemove ? canRemove(p) : true);
        return (
          <span key={p.userId} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: `${c}22`, border: `1px solid ${c}`,
            borderRadius: 999, padding: '4px 11px 4px 4px',
            fontFamily: th.fontUI, fontSize: fs, fontWeight: 600, color: th.text,
          }}>
            <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl ?? null} size={av} color={c} />
            {p.firstName} {p.lastName}
            {showOrgaBadge && p.isOrganizer && (
              <span style={{ fontSize: 10, fontWeight: 700, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.3 }}>orga</span>
            )}
            {removable && (
              <button type="button" disabled={busy} aria-label={`Retirer ${p.firstName} ${p.lastName}`} title="Retirer ce joueur"
                onClick={() => onRemove!(p)}
                style={{ border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer', color: th.textMute, fontSize: 15, lineHeight: 1, padding: 0, marginLeft: 2 }}>×</button>
            )}
          </span>
        );
      })}
      {Array.from({ length: Math.max(0, spotsLeft) }).map((_, i) => (
        <span key={`spot-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '4px 12px 4px 4px', border: `1.5px dashed ${th.lineStrong}`, fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>
          <span aria-hidden="true" style={{ width: av, height: av, borderRadius: '50%', flexShrink: 0, border: `1.5px dashed ${th.lineStrong}` }} />
          Place libre
        </span>
      ))}
    </div>
  );
}
