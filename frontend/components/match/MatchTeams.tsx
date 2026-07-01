'use client';
import { Fragment, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { UserLevel } from '@/lib/api';
import { LevelChip } from '@/components/player/LevelChip';

export interface MatchPlayerData {
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  isOrganizer?: boolean;
  participantId?: string;
  level?: UserLevel | null;
  team: 1 | 2;
}

const SIDE_COLOR: Record<1 | 2, string> = { 1: ACCENTS.blue, 2: ACCENTS.coral };

// Deux équipes côte à côte (Éq.1 gauche / Éq.2 droite) avec « VS » central. Padel : 2 slots par côté
// (single : 1). Côte à côte même sur mobile (flex, pas de scroll horizontal). Prop `editable` :
// tap-pour-permuter (toucher un joueur puis un 2e pour échanger, ou une place libre pour déplacer).
export function MatchTeams({
  players, capacity, friendIds, size = 'md', busy = false,
  onRemove, canRemove, addSlot, editable = false, onSetTeams,
}: {
  players: MatchPlayerData[];
  capacity: number;
  friendIds?: Set<string>;
  size?: 'sm' | 'md';
  busy?: boolean;
  onRemove?: (player: MatchPlayerData) => void;
  canRemove?: (player: MatchPlayerData) => boolean;
  addSlot?: React.ReactNode;               // ex. AddPlayerPill, posé dans le 1er slot libre (côté 1 d'abord)
  editable?: boolean;
  onSetTeams?: (teamsByUserId: Record<string, 1 | 2>) => void;
}) {
  const { th } = useTheme();
  const [picked, setPicked] = useState<string | null>(null);
  const av = size === 'sm' ? 20 : 22;
  const fs = size === 'sm' ? 12.5 : 13;
  const half = Math.max(1, Math.floor(capacity / 2));

  const sideOf = (t: 1 | 2) => players.filter((p) => p.team === t);
  const currentTeams = (): Record<string, 1 | 2> =>
    Object.fromEntries(players.map((p) => [p.userId, p.team]));

  // 1er slot libre global : côté 1 s'il reste de la place, sinon côté 2 (là où va `addSlot`).
  const firstFreeSide: 1 | 2 | null =
    sideOf(1).length < half ? 1 : sideOf(2).length < half ? 2 : null;

  const commit = (next: Record<string, 1 | 2>) => { setPicked(null); onSetTeams?.(next); };

  const onPick = (p: MatchPlayerData) => {
    if (!editable || busy) return;
    if (picked === null) { setPicked(p.userId); return; }
    if (picked === p.userId) { setPicked(null); return; }
    // échange des deux côtés
    const a = players.find((x) => x.userId === picked)!;
    const next = currentTeams();
    next[a.userId] = p.team;
    next[p.userId] = a.team;
    commit(next);
  };

  const onPickFree = (side: 1 | 2) => {
    if (!editable || busy || picked === null) return;
    const a = players.find((x) => x.userId === picked)!;
    if (a.team === side) { setPicked(null); return; }
    if (sideOf(side).length >= half) return;   // côté plein : pas de place libre à occuper
    const next = currentTeams();
    next[a.userId] = side;
    commit(next);
  };

  const renderPlayer = (p: MatchPlayerData) => {
    const c = colorForSeed(p.userId);
    const removable = !!onRemove && (canRemove ? canRemove(p) : true);
    const isFriend = !!friendIds?.has(p.userId);
    const isPicked = picked === p.userId;
    const avatar = <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl ?? null} size={av} color={c} />;
    return (
      <span
        key={p.userId}
        onClick={editable ? () => onPick(p) : undefined}
        role={editable ? 'button' : undefined}
        tabIndex={editable ? 0 : undefined}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%',
          background: `${c}22`, border: `1px solid ${isPicked ? th.accent : c}`,
          outline: isPicked ? `2px solid ${th.accent}` : 'none',
          borderRadius: 999, padding: '4px 11px 4px 4px',
          fontFamily: th.fontUI, fontSize: fs, fontWeight: 600, color: th.text,
          cursor: editable ? 'pointer' : 'default',
        }}
      >
        {isFriend ? (
          <span title="Vous suivez ce joueur" style={{ display: 'inline-flex', borderRadius: '50%', padding: 1.5, background: th.accent, flexShrink: 0 }}>{avatar}</span>
        ) : avatar}
        {/* Nom tronqué (ellipsis) → jamais de débordement horizontal en colonne étroite (mobile). */}
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.firstName} {p.lastName}</span>
        <LevelChip level={p.level} size="xs" />
        {p.isOrganizer && (
          <span style={{ fontSize: 10, fontWeight: 700, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.3 }}>orga</span>
        )}
        {removable && (
          <button type="button" disabled={busy} aria-label={`Retirer ${p.firstName} ${p.lastName}`} title="Retirer ce joueur"
            onClick={(e) => { e.stopPropagation(); onRemove!(p); }}
            style={{ border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer', color: th.textMute, fontSize: 15, lineHeight: 1, padding: 0, marginLeft: 2 }}>×</button>
        )}
      </span>
    );
  };

  const renderFree = (side: 1 | 2, key: string, withAdd: boolean) =>
    withAdd && addSlot ? (
      <Fragment key={key}>{addSlot}</Fragment>
    ) : (
      <span key={key}
        onClick={editable ? () => onPickFree(side) : undefined}
        role={editable && picked ? 'button' : undefined}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '4px 12px 4px 4px', border: `1.5px dashed ${th.lineStrong}`, fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint, cursor: editable && picked ? 'pointer' : 'default' }}>
        <span aria-hidden="true" style={{ width: av, height: av, borderRadius: '50%', flexShrink: 0, border: `1.5px dashed ${th.lineStrong}` }} />
        Place libre
      </span>
    );

  const column = (side: 1 | 2) => {
    const list = sideOf(side);
    const freeCount = Math.max(0, half - list.length);
    return (
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: SIDE_COLOR[side], flexShrink: 0 }} />
          <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 11.5, letterSpacing: 0.3, textTransform: 'uppercase', color: th.textMute }}>Équipe {side}</span>
        </div>
        {list.map(renderPlayer)}
        {Array.from({ length: freeCount }).map((_, i) =>
          renderFree(side, `free-${side}-${i}`, i === 0 && firstFreeSide === side),
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 10 }}>
      {column(1)}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <span style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 12, color: th.textFaint, letterSpacing: 0.5 }}>VS</span>
      </div>
      {column(2)}
    </div>
  );
}
