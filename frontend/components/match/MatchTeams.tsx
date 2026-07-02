'use client';
import { useRef } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, inkOn } from '@/lib/theme';
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
// Emplacements FIXES par équipe (G = 1er, D = 2e) : chaque joueur garde sa place — retirer le
// joueur de gauche laisse un trou à gauche et le droit reste à droite. Les positions sont
// mémorisées pendant la session (ref, aucun backend). Côte à côte même sur mobile.
// En `editable`, chaque joueur porte des boutons explicites (un tap = une action) :
//   → (passe dans l'autre équipe ; si pleine, échange avec le joueur d'en face),
//   loupe (remplacer), × (retirer). Chaque emplacement libre montre un « + » (ajout ciblé).
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

  // Position mémorisée par joueur (équipe + emplacement), stable sur la session.
  const posRef = useRef<Record<string, { team: 1 | 2; slot: number }>>({});

  // Layout : chaque équipe = `half` emplacements. On honore d'abord la position mémorisée,
  // puis on place les nouveaux au 1er emplacement libre — d'où la stabilité au retrait.
  const layout: Record<1 | 2, (MatchPlayerData | null)[]> = {
    1: new Array<MatchPlayerData | null>(half).fill(null),
    2: new Array<MatchPlayerData | null>(half).fill(null),
  };
  for (const p of players) {
    const rem = posRef.current[p.userId];
    if (rem && rem.team === p.team && rem.slot < half && layout[p.team][rem.slot] === null) {
      layout[p.team][rem.slot] = p;
    }
  }
  for (const p of players) {
    if (layout[1].includes(p) || layout[2].includes(p)) continue;
    const arr = layout[p.team];
    let slot = arr.findIndex((s) => s === null);
    if (slot < 0) slot = 0;
    arr[slot] = p;
    posRef.current[p.userId] = { team: p.team, slot };
  }

  const currentTeams = (): Record<string, 1 | 2> =>
    Object.fromEntries(players.map((p) => [p.userId, p.team]));

  // Déplace le joueur dans l'autre équipe : place libre → déplacement (même emplacement si libre) ;
  // sinon échange avec le joueur du même emplacement en face. Émet la map complète + mémorise les positions.
  const onMove = (p: MatchPlayerData) => {
    if (busy) return;
    const target: 1 | 2 = p.team === 1 ? 2 : 1;
    const pSlot = layout[p.team].indexOf(p);
    const next = currentTeams();
    const freeInTarget = layout[target].findIndex((s) => s === null);
    if (freeInTarget >= 0) {
      const dest = layout[target][pSlot] === null ? pSlot : freeInTarget;
      next[p.userId] = target;
      posRef.current[p.userId] = { team: target, slot: dest };
    } else {
      const opp = layout[target][pSlot];
      next[p.userId] = target;
      posRef.current[p.userId] = { team: target, slot: pSlot };
      if (opp) { next[opp.userId] = p.team; posRef.current[opp.userId] = { team: p.team, slot: pSlot }; }
    }
    onSetTeams?.(next);
  };

  const iconBtn = { border: 'none', background: 'transparent', padding: 2, cursor: busy ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', flexShrink: 0, lineHeight: 0 } as const;

  const renderPlayer = (p: MatchPlayerData, idx: number) => {
    const c = colorForSeed(p.userId);          // couleur individuelle → avatar (distingue les joueurs)
    const teamColor = SIDE_COLOR[p.team];       // couleur d'équipe → carte (Éq.1 bleu / Éq.2 corail)
    const isFriend = !!friendIds?.has(p.userId);
    const canRep = !!onReplace && (canReplace ? canReplace(p) : !p.isOrganizer);
    const canRem = !!onRemove && (canRemove ? canRemove(p) : !p.isOrganizer);
    const avatar = <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl ?? null} size={av} color={c} />;
    // Y a-t-il une 2e ligne à afficher ? (niveau, repère G/D, orga, boutons)
    const hasMeta = !!p.level || showGD || p.isOrganizer || canMove || canRep || canRem;
    return (
      // Mini-carte en 2 lignes (au lieu d'une pastille sur 1 ligne) : en colonne étroite (mobile,
      // 2 équipes côte à côte) le nom occupe toute la largeur en ligne 1 et n'est jamais rogné à zéro
      // par les puces/boutons — ceux-ci s'enroulent sous le nom en ligne 2.
      <div key={p.userId}
        style={{
          display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, maxWidth: '100%',
          background: `${teamColor}22`, border: `1px solid ${teamColor}`,
          borderRadius: 12, padding: '5px 8px',
          fontFamily: th.fontUI, fontSize: fs, fontWeight: 600, color: th.text,
        }}
      >
        {/* Ligne 1 : avatar + nom (largeur restante ; ellipsis en tout dernier recours). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {isFriend ? (
            <span title="Vous suivez ce joueur" style={{ display: 'inline-flex', borderRadius: '50%', padding: 1.5, background: th.accent, flexShrink: 0 }}>{avatar}</span>
          ) : avatar}
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.firstName} {p.lastName}</span>
        </div>
        {/* Ligne 2 : niveau, repère G/D, orga, boutons — s'enroulent au lieu de rogner le nom. */}
        {hasMeta && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <LevelChip level={p.level} size="xs" />
            {showGD && (
              <span title={idx === 0 ? 'Côté gauche' : 'Côté droit'} aria-label={idx === 0 ? 'Côté gauche' : 'Côté droit'}
                style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 800, lineHeight: 1, padding: '2px 5px', borderRadius: 5, background: teamColor, color: inkOn(teamColor), letterSpacing: 0.3 }}>{idx === 0 ? 'G' : 'D'}</span>
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
          </div>
        )}
      </div>
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

  const column = (side: 1 | 2) => (
    // alignItems:stretch → chaque mini-carte remplit la largeur de sa colonne (les 2 équipes se
    // répartissent toute la largeur, sans grand vide à droite en desktop ; nom au maximum d'espace).
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: SIDE_COLOR[side], flexShrink: 0 }} />
        <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 11.5, letterSpacing: 0.3, textTransform: 'uppercase', color: th.textMute }}>Équipe {side}</span>
      </div>
      {layout[side].map((p, i) => (p ? renderPlayer(p, i) : renderFree(side, `free-${side}-${i}`)))}
    </div>
  );

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
