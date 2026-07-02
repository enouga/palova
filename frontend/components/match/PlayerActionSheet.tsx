'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';
import { SheetShell } from '@/components/ui/SheetShell';
import type { MatchPlayerData } from '@/components/match/MatchTeams';

// Feuille d'actions d'un joueur du mini-terrain (déplacer / remplacer / retirer,
// en toutes lettres). Rendue par MatchTeams au tap sur un joueur en mode editable.
export function PlayerActionSheet({
  player,
  playerName,
  slotLabel,
  teamColor,
  team,
  busy = false,
  canMove,
  canReplace,
  canRemove,
  onMove,
  onReplace,
  onRemove,
  onClose,
}: {
  player: MatchPlayerData;
  playerName: string;
  slotLabel?: string;
  teamColor: string;
  team: 1 | 2;
  busy?: boolean;
  canMove: boolean;
  canReplace: boolean;
  canRemove: boolean;
  onMove: () => void;
  onReplace: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { th } = useTheme();
  const other = team === 1 ? 2 : 1;
  const row: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    textAlign: 'left',
    border: 'none',
    background: 'transparent',
    borderRadius: 11,
    padding: '12px 10px',
    fontFamily: th.fontUI,
    fontSize: 14.5,
    fontWeight: 600,
    color: th.text,
    cursor: busy ? 'default' : 'pointer',
  };

  return (
    <SheetShell onClose={onClose} label={`Actions pour ${playerName}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px 8px' }}>
        <Avatar
          firstName={player.firstName}
          lastName={player.lastName}
          avatarUrl={player.avatarUrl ?? null}
          size={30}
          color={colorForSeed(player.userId)}
        />
        <span style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 800, color: th.text }}>
          {playerName}
        </span>
        <LevelChip level={player.level} size="xs" />
        <span
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            background: `${teamColor}22`,
            borderRadius: 999,
            padding: '3px 10px',
            fontFamily: th.fontUI,
            fontSize: 10.5,
            fontWeight: 800,
            letterSpacing: 0.3,
            color: th.text,
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: teamColor,
              flexShrink: 0,
            }}
          />
          {`ÉQ. ${team}${slotLabel ? ` · ${slotLabel}` : ''}`}
        </span>
      </div>
      <div aria-hidden="true" style={{ height: 1, background: th.line, marginBottom: 4 }} />
      {canMove && (
        <button
          type="button"
          disabled={busy}
          style={row}
          onClick={onMove}
          onMouseEnter={(e) => { if (!busy) e.currentTarget.style.background = th.surface2; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={{ display: 'inline-flex', transform: team === 2 ? 'scaleX(-1)' : undefined }}>
            <Icon name="arrowR" size={17} color={th.textMute} />
          </span>
          {`Passer dans l'équipe ${other}`}
        </button>
      )}
      {canReplace && (
        <button
          type="button"
          disabled={busy}
          style={row}
          onClick={onReplace}
          onMouseEnter={(e) => { if (!busy) e.currentTarget.style.background = th.surface2; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <Icon name="search" size={16} color={th.textMute} />
          Remplacer par un autre joueur
        </button>
      )}
      {canRemove && (
        <button
          type="button"
          disabled={busy}
          style={{ ...row, color: ACCENTS.coral }}
          onClick={onRemove}
          onMouseEnter={(e) => { if (!busy) e.currentTarget.style.background = th.surface2; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <Icon name="x" size={17} color={ACCENTS.coral} />
          Retirer de la partie
        </button>
      )}
      <button
        type="button"
        style={{ ...row, justifyContent: 'center', color: th.textMute }}
        onClick={onClose}
        onMouseEnter={(e) => { e.currentTarget.style.background = th.surface2; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        Annuler
      </button>
    </SheetShell>
  );
}
