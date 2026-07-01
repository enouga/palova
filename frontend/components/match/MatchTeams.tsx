'use client';
import { Fragment, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Avatar } from '@/components/ui/Avatar';
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
// Prop `editable` :
//  - taper une pastille la sélectionne → barre d'actions (Remplacer / Retirer) + déplacement
//    en tapant un autre joueur (échange) ou une place libre (déplacement) ;
//  - chaque emplacement libre montre un « + » (ajout ciblé sur cette équipe) via `onAddToTeam`,
//    et devient une cible « Placer ici » quand un joueur est sélectionné.
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
  const [picked, setPicked] = useState<string | null>(null);
  const av = size === 'sm' ? 20 : 22;
  const fs = size === 'sm' ? 12.5 : 13;
  const half = Math.max(1, Math.floor(capacity / 2));
  const showGD = half >= 2; // repère Gauche/Droite seulement en double (2 joueurs/équipe)

  const sideOf = (t: 1 | 2) => players.filter((p) => p.team === t);
  const currentTeams = (): Record<string, 1 | 2> =>
    Object.fromEntries(players.map((p) => [p.userId, p.team]));

  const commit = (next: Record<string, 1 | 2>) => { setPicked(null); onSetTeams?.(next); };

  const onPick = (p: MatchPlayerData) => {
    if (!editable || busy) return;
    if (picked === null) { setPicked(p.userId); return; }
    if (picked === p.userId) { setPicked(null); return; }
    // échange des deux joueurs (leurs équipes)
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

  const renderPlayer = (p: MatchPlayerData, idx: number) => {
    const c = colorForSeed(p.userId);
    const isFriend = !!friendIds?.has(p.userId);
    const isPicked = picked === p.userId;
    const avatar = <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl ?? null} size={av} color={c} />;
    return (
      <span
        key={p.userId}
        onClick={editable ? () => onPick(p) : undefined}
        role={editable ? 'button' : undefined}
        tabIndex={editable ? 0 : undefined}
        title={editable ? 'Toucher pour sélectionner / déplacer' : undefined}
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
        {showGD && (
          <span title={idx === 0 ? 'Côté gauche' : 'Côté droit'} aria-label={idx === 0 ? 'Côté gauche' : 'Côté droit'}
            style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 800, lineHeight: 1, padding: '2px 5px', borderRadius: 5, background: `${SIDE_COLOR[p.team]}22`, color: SIDE_COLOR[p.team], letterSpacing: 0.3 }}>{idx === 0 ? 'G' : 'D'}</span>
        )}
        {p.isOrganizer && (
          <span style={{ fontSize: 10, fontWeight: 700, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.3, flexShrink: 0 }}>orga</span>
        )}
      </span>
    );
  };

  // Barre d'actions affichée sous la pastille sélectionnée (organisateur exclu de remplacer/retirer).
  const renderActions = (p: MatchPlayerData) => {
    const canRep = !!onReplace && (canReplace ? canReplace(p) : !p.isOrganizer);
    const canRem = !!onRemove && (canRemove ? canRemove(p) : !p.isOrganizer);
    const actBtn = { border: `1px solid ${th.lineStrong}`, background: th.surface, borderRadius: 8, padding: '3px 10px', fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer' } as const;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingLeft: 4 }}>
        {canRep && (
          <button type="button" disabled={busy} aria-label={`Remplacer ${p.firstName} ${p.lastName}`} style={{ ...actBtn, color: th.text }}
            onClick={(e) => { e.stopPropagation(); setPicked(null); onReplace!(p); }}>Remplacer</button>
        )}
        {canRem && (
          <button type="button" disabled={busy} aria-label={`Retirer ${p.firstName} ${p.lastName}`} style={{ ...actBtn, color: ACCENTS.coral, borderColor: ACCENTS.coral }}
            onClick={(e) => { e.stopPropagation(); setPicked(null); onRemove!(p); }}>Retirer</button>
        )}
        <span style={{ fontFamily: th.fontUI, fontSize: 11, color: th.textFaint }}>ou touche un joueur / une place pour déplacer</span>
      </span>
    );
  };

  const renderFree = (side: 1 | 2, key: string) => {
    // Joueur sélectionné → la place libre devient une cible de déplacement « Placer ici ».
    if (editable && picked) {
      return (
        <span key={key} role="button" aria-label={`Déplacer vers l'équipe ${side}`} onClick={() => onPickFree(side)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '4px 12px 4px 4px', border: `1.5px dashed ${th.accent}`, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.accent, cursor: 'pointer' }}>
          <span aria-hidden="true" style={{ width: av, height: av, borderRadius: '50%', flexShrink: 0, border: `1.5px dashed ${th.accent}` }} />
          Placer ici
        </span>
      );
    }
    // Sinon, si l'ajout est permis : bouton « + » qui ajoute à CETTE équipe.
    if (editable && onAddToTeam) {
      return <AddPlayerPill key={key} size={size} disabled={busy} ariaLabel={`Ajouter un joueur à l'équipe ${side}`} onClick={() => onAddToTeam(side)} />;
    }
    // Sinon (lecture seule) : place libre en pointillés.
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
        {list.map((p, i) => (
          <Fragment key={p.userId}>
            {renderPlayer(p, i)}
            {editable && picked === p.userId && renderActions(p)}
          </Fragment>
        ))}
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
