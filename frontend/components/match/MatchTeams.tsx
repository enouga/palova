'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { colorForSeed } from '@/lib/playerColors';
import { UserLevel } from '@/lib/api';
import { LevelChip } from '@/components/player/LevelChip';
import { AddPlayerPill } from '@/components/player/AddPlayerPill';

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

// Deux équipes côte à côte (Éq.1 gauche / Éq.2 droite) avec « VS » central, joueurs empilés.
// Repère G/D (1er = gauche, 2e = droite) en double. Côte à côte même sur mobile.
// En mode `editable`, chaque joueur porte des boutons explicites (un tap = une action) :
//   → (passe dans l'autre équipe ; si pleine, échange avec le joueur en face),
//   loupe (remplacer par un autre membre), × (retirer).
// Chaque emplacement libre montre un « + » (ajout ciblé sur cette équipe) via `onAddToTeam`.
export function MatchTeams({
  players, capacity, friendIds, size = 'md', busy = false,
  onRemove, canRemove, onReplace, canReplace, onAddToTeam, editable = false, onSetTeams,
}: {
  players: MatchPlayerData[];
  capacity: number;
  friendIds?: Set<string>;
  size?: 'sm' | 'md';
  busy?: boolean;
  onRemove?: (player: MatchPlayerData) => void;
  canRemove?: (player: MatchPlayerData) => boolean;
  onReplace?: (player: MatchPlayerData) => void;
  canReplace?: (player: MatchPlayerData) => boolean;
  onAddToTeam?: (team: 1 | 2) => void;
  editable?: boolean;
  onSetTeams?: (teamsByUserId: Record<string, 1 | 2>) => void;
}) {
  const { th } = useTheme();
  const av = size === 'sm' ? 20 : 22;
  const fs = size === 'sm' ? 12.5 : 13;
  const half = Math.max(1, Math.floor(capacity / 2));
  const showGD = half >= 2;               // repère Gauche/Droite seulement en double
  const canMove = editable && !!onSetTeams;

  const sideOf = (t: 1 | 2) => players.filter((p) => p.team === t);
  const currentTeams = (): Record<string, 1 | 2> =>
    Object.fromEntries(players.map((p) => [p.userId, p.team]));

  // Déplace le joueur dans l'autre équipe : place libre → simple déplacement ;
  // sinon échange avec le joueur d'en face (même position). Émet la map complète.
  const onMove = (p: MatchPlayerData) => {
    if (busy) return;
    const target: 1 | 2 = p.team === 1 ? 2 : 1;
    const next = currentTeams();
    const targetSide = sideOf(target);
    if (targetSide.length < half) {
      next[p.userId] = target;
    } else {
      const myIdx = sideOf(p.team).findIndex((x) => x.userId === p.userId);
      const opp = targetSide[myIdx] ?? targetSide[0];
      next[p.userId] = target;
      if (opp) next[opp.userId] = p.team;
    }
    onSetTeams?.(next);
  };

  const iconBtn = { border: 'none', background: 'transparent', padding: 2, cursor: busy ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', flexShrink: 0, lineHeight: 0 } as const;

  const renderPlayer = (p: MatchPlayerData, idx: number) => {
    const c = colorForSeed(p.userId);
    const isFriend = !!friendIds?.has(p.userId);
    const canRep = !!onReplace && (canReplace ? canReplace(p) : !p.isOrganizer);
    const canRem = !!onRemove && (canRemove ? canRemove(p) : !p.isOrganizer);
    const avatar = <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl ?? null} size={av} color={c} />;
    return (
      <span key={p.userId}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%',
          background: `${c}22`, border: `1px solid ${c}`,
          borderRadius: 999, padding: '4px 8px 4px 4px',
          fontFamily: th.fontUI, fontSize: fs, fontWeight: 600, color: th.text,
        }}
      >
        {isFriend ? (
          <span title="Vous suivez ce joueur" style={{ display: 'inline-flex', borderRadius: '50%', padding: 1.5, background: th.accent, flexShrink: 0 }}>{avatar}</span>
        ) : avatar}
        {/* Nom tronqué (ellipsis) → jamais de débordement horizontal en colonne étroite (mobile). */}
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.firstName} {p.lastName}</span>
        <LevelChip level={p.level} size="xs" />
        {showGD && (
          <span title={idx === 0 ? 'Côté gauche' : 'Côté droit'} aria-label={idx === 0 ? 'Côté gauche' : 'Côté droit'}
            style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 800, lineHeight: 1, padding: '2px 5px', borderRadius: 5, background: `${SIDE_COLOR[p.team]}22`, color: SIDE_COLOR[p.team], letterSpacing: 0.3 }}>{idx === 0 ? 'G' : 'D'}</span>
        )}
        {p.isOrganizer && (
          <span style={{ fontSize: 10, fontWeight: 700, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.3, flexShrink: 0 }}>orga</span>
        )}
        {canMove && (
          <button type="button" disabled={busy} aria-label="Passer dans l'autre équipe" title="Passer dans l'autre équipe" style={iconBtn} onClick={() => onMove(p)}>
            <span style={{ display: 'inline-flex', transform: p.team === 2 ? 'scaleX(-1)' : undefined }}><Icon name="arrowR" size={15} color={th.textMute} /></span>
          </button>
        )}
        {canRep && (
          <button type="button" disabled={busy} aria-label={`Remplacer ${p.firstName} ${p.lastName}`} title="Remplacer ce joueur" style={iconBtn} onClick={() => onReplace!(p)}>
            <Icon name="search" size={14} color={th.textMute} />
          </button>
        )}
        {canRem && (
          <button type="button" disabled={busy} aria-label={`Retirer ${p.firstName} ${p.lastName}`} title="Retirer ce joueur" style={iconBtn} onClick={() => onRemove!(p)}>
            <Icon name="x" size={15} color={th.textMute} />
          </button>
        )}
      </span>
    );
  };

  const renderFree = (side: 1 | 2, key: string) => {
    // Ajout permis : bouton « + » qui ajoute à CETTE équipe. Sinon place libre en pointillés.
    if (editable && onAddToTeam) {
      return <AddPlayerPill key={key} size={size} disabled={busy} ariaLabel={`Ajouter un joueur à l'équipe ${side}`} onClick={() => onAddToTeam(side)} />;
    }
    return (
      <span key={key}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '4px 12px 4px 4px', border: `1.5px dashed ${th.lineStrong}`, fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>
        <span aria-hidden="true" style={{ width: av, height: av, borderRadius: '50%', flexShrink: 0, border: `1.5px dashed ${th.lineStrong}` }} />
        Place libre
      </span>
    );
  };

  const column = (side: 1 | 2) => {
    const list = sideOf(side);
    const freeCount = Math.max(0, half - list.length);
    // alignItems:flex-start → les pastilles épousent leur contenu au lieu de s'étirer sur toute la colonne
    return (
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: SIDE_COLOR[side], flexShrink: 0 }} />
          <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 11.5, letterSpacing: 0.3, textTransform: 'uppercase', color: th.textMute }}>Équipe {side}</span>
        </div>
        {list.map((p, i) => renderPlayer(p, i))}
        {Array.from({ length: freeCount }).map((_, i) => renderFree(side, `free-${side}-${i}`))}
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
