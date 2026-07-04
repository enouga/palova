'use client';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, inkOn } from '@/lib/theme';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { UserLevel } from '@/lib/api';
import { LevelChip } from '@/components/player/LevelChip';
import { shortNamesById } from '@/lib/names';
import { PlayerActionSheet } from '@/components/match/PlayerActionSheet';

export interface MatchPlayerData {
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  isOrganizer?: boolean;
  participantId?: string;
  level?: UserLevel | null;
  team: 1 | 2;
  /** Place au sein de l'équipe (0=G, 1=D), persistée côté serveur — fait foi au rendu. */
  slot?: number | null;
}

// Couleurs d'équipe (Éq.1 bleu / Éq.2 corail) — partagées avec les feuilles d'ajout/actions.
export const SIDE_COLOR: Record<1 | 2, string> = { 1: ACCENTS.blue, 2: ACCENTS.coral };
export const SLOT_LABELS = ['G', 'D'] as const;
// Sous cette largeur (px) du composant, les noms passent en « Prénom N. » (spec noms abrégés).
export const NARROW_WIDTH = 380;

// Mini-terrain de padel vu de dessus (spec 2026-07-02) : deux moitiés teintées côte à côte,
// filet central pointillé + badge VS, chaque quadrant = une place précise (G = 1er, D = 2e).
// Emplacements FIXES par équipe, pilotés par la donnée : priorité au `slot` serveur
// (spec places G/D persistées), puis mémoire de session (intervalle optimiste entre une
// action et le reload, brouillons locaux), puis premier emplacement libre — retirer le
// joueur de gauche laisse un trou à gauche et le droit reste à droite, même après remontage.
// En `editable`, un tap sur un joueur ouvre une feuille d'actions (déplacer / remplacer /
// retirer) ; chaque place libre est un « + » d'ajout ciblé → `onAddToTeam(team, slot)`.
// Hors editable, si `onJoinFree` est fourni (viewer non-participant), chaque place libre
// est un bouton « Rejoindre » ciblé → `onJoinFree(team, slot)`.
export function MatchTeams({
  players, capacity, friendIds, size = 'md', busy = false,
  onRemove, canRemove, onReplace, canReplace, onAddToTeam, editable = false, onSetTeams,
  onJoinFree, activeTarget, onPlayerTap, viewerUserId,
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
  /** Tap sur une place libre : côté + emplacement visé (0=G, 1=D). */
  onAddToTeam?: (team: 1 | 2, slot?: number) => void;
  /** Tap sur une place libre pour SE rajouter (viewer non-participant) — indépendant d'`editable`. */
  onJoinFree?: (team: 1 | 2, slot: number) => void;
  editable?: boolean;
  /** Réorganisation : maps complètes équipe + place (0=G, 1=D) par userId. */
  onSetTeams?: (teamsByUserId: Record<string, 1 | 2>, slotsByUserId: Record<string, number>) => void;
  /** Place visée par la feuille d'ajout ouverte → reste en surbrillance. */
  activeTarget?: { team: 1 | 2; slot?: number } | null;
  /** Additif (messagerie) : hors `editable`, tap sur la cellule d'un AUTRE joueur → onPlayerTap(userId). */
  onPlayerTap?: (userId: string) => void;
  viewerUserId?: string;
}) {
  const { th } = useTheme();
  const av = size === 'sm' ? 34 : 38;
  const fs = size === 'sm' ? 12 : 12.5;
  // Hauteur mini identique pour TOUTES les cellules (joueur ou place libre) : avatar + nom +
  // rangée pastille niveau/orga tiennent dedans. Garantit deux colonnes de hauteur égale (donc
  // pas d'étirement asymétrique) → avatars et noms parfaitement alignés d'une équipe à l'autre,
  // qu'un joueur ait une pastille et l'autre non.
  const cellMinH = av + 68;
  const half = Math.max(1, Math.floor(capacity / 2));
  const showGD = half >= 2;               // repère Gauche/Droite seulement en double
  const canMove = editable && !!onSetTeams;

  // Étroit → noms « Prénom N. » (mesure du conteneur, pas du viewport ; 1er rendu = large,
  // hydration-safe, et le stub jsdom neutre laisse les tests en noms complets).
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width ?? 0;
      // setState seulement au franchissement du seuil (identité conservée sinon).
      setNarrow((prev) => { const next = w > 0 && w < NARROW_WIDTH; return next === prev ? prev : next; });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shortNames = narrow
    ? shortNamesById(players.map((p) => ({ id: p.userId, firstName: p.firstName, lastName: p.lastName })))
    : null;
  const fullName = (p: MatchPlayerData) => `${p.firstName} ${p.lastName}`;
  const displayName = (p: MatchPlayerData) => shortNames?.[p.userId] ?? fullName(p);

  // Position mémorisée par joueur (équipe + emplacement), stable sur la session.
  const posRef = useRef<Record<string, { team: 1 | 2; slot: number }>>({});

  // Layout : chaque équipe = `half` emplacements. Priorité au `slot` serveur (la donnée
  // fait foi au montage — durable après F5 et remontage), puis à la position mémorisée,
  // puis au 1er emplacement libre — d'où la stabilité au retrait.
  const layout: Record<1 | 2, (MatchPlayerData | null)[]> = {
    1: new Array<MatchPlayerData | null>(half).fill(null),
    2: new Array<MatchPlayerData | null>(half).fill(null),
  };
  for (const p of players) {
    const s = p.slot;
    if (typeof s === 'number' && Number.isInteger(s) && s >= 0 && s < half && layout[p.team][s] === null) {
      layout[p.team][s] = p;
      posRef.current[p.userId] = { team: p.team, slot: s };
    }
  }
  for (const p of players) {
    if (layout[1].includes(p) || layout[2].includes(p)) continue;
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
  // Places courantes de TOUS les joueurs, dérivées du layout rendu.
  const currentSlots = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const side of [1, 2] as const) {
      layout[side].forEach((pl, i) => { if (pl) out[pl.userId] = i; });
    }
    return out;
  };

  // Déplace le joueur dans l'autre équipe : place libre → déplacement (même emplacement si
  // libre) ; sinon échange avec le joueur du même emplacement en face. Émet les maps complètes
  // (équipes + places) pour persistance serveur.
  const onMove = (p: MatchPlayerData) => {
    if (busy) return;
    const target: 1 | 2 = p.team === 1 ? 2 : 1;
    const pSlot = layout[p.team].indexOf(p);
    const next = currentTeams();
    const nextSlots = currentSlots();
    const freeInTarget = layout[target].findIndex((s) => s === null);
    if (freeInTarget >= 0) {
      const dest = layout[target][pSlot] === null ? pSlot : freeInTarget;
      next[p.userId] = target;
      nextSlots[p.userId] = dest;
      posRef.current[p.userId] = { team: target, slot: dest };
    } else {
      const opp = layout[target][pSlot];
      next[p.userId] = target;
      nextSlots[p.userId] = pSlot;
      posRef.current[p.userId] = { team: target, slot: pSlot };
      if (opp) {
        next[opp.userId] = p.team;
        nextSlots[opp.userId] = pSlot;
        posRef.current[opp.userId] = { team: p.team, slot: pSlot };
      }
    }
    onSetTeams?.(next, nextSlots);
  };

  // Feuille d'actions : joueur sélectionné (re-résolu à chaque rendu — un joueur retiré
  // pendant que la feuille est ouverte la fait disparaître proprement).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? players.find((p) => p.userId === selectedId) ?? null : null;

  const repAllowed = (p: MatchPlayerData) => !!onReplace && (canReplace ? canReplace(p) : !p.isOrganizer);
  const remAllowed = (p: MatchPlayerData) => !!onRemove && (canRemove ? canRemove(p) : !p.isOrganizer);
  const hasActions = (p: MatchPlayerData) => canMove || repAllowed(p) || remAllowed(p);

  const renderPlayer = (p: MatchPlayerData, idx: number) => {
    const c = colorForSeed(p.userId);           // couleur individuelle → avatar
    const teamColor = SIDE_COLOR[p.team];       // couleur d'équipe → quadrant
    const isFriend = !!friendIds?.has(p.userId);
    const isSelected = selected?.userId === p.userId;
    const tappable = editable && hasActions(p);
    const avatar = <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl ?? null} size={av} color={c} />;
    const inner = (
      <>
        {showGD && (
          <span aria-label={idx === 0 ? 'Côté gauche' : 'Côté droit'}
            style={{ position: 'absolute', top: 6, [p.team === 1 ? 'left' : 'right']: 6, fontSize: 9, fontWeight: 800, lineHeight: 1, padding: '2px 5px', borderRadius: 5, background: teamColor, color: inkOn(teamColor), letterSpacing: 0.3 }}>
            {SLOT_LABELS[idx]}
          </span>
        )}
        {isFriend ? (
          <span title="Vous suivez ce joueur" style={{ display: 'inline-flex', borderRadius: '50%', padding: 1.5, background: th.accent }}>{avatar}</span>
        ) : avatar}
        <span title={fullName(p)} style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: th.fontUI, fontSize: fs, fontWeight: 700, color: th.text }}>
          {displayName(p)}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', justifyContent: 'center' }}>
          <LevelChip level={p.level} size="xs" />
          {p.isOrganizer && (
            <span style={{ fontSize: 9.5, fontWeight: 800, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.4, fontFamily: th.fontUI }}>orga</span>
          )}
        </span>
      </>
    );
    const cellStyle: React.CSSProperties = {
      position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      width: '100%', boxSizing: 'border-box', minWidth: 0, minHeight: cellMinH, padding: '12px 6px 10px',
      border: 'none', background: isSelected ? `${teamColor}1c` : 'transparent', borderRadius: 12,
      outline: isSelected ? `2.5px solid ${teamColor}` : 'none', outlineOffset: -2.5,
    };
    if (!tappable) {
      // Hors édition : la cellule d'un AUTRE joueur ouvre la messagerie (ne jamais interférer
      // avec le tap-pour-permuter du mode editable).
      if (!editable && onPlayerTap && p.userId !== viewerUserId) {
        return (
          <button type="button" data-player-slot={SLOT_LABELS[idx]} disabled={busy}
            aria-label={`Écrire à ${fullName(p)}`} title="Envoyer un message"
            onClick={() => onPlayerTap(p.userId)}
            style={{ ...cellStyle, cursor: busy ? 'default' : 'pointer', font: 'inherit' }}>
            {inner}
          </button>
        );
      }
      return <div data-player-slot={SLOT_LABELS[idx]} style={cellStyle}>{inner}</div>;
    }
    return (
      <button type="button" data-player-slot={SLOT_LABELS[idx]} disabled={busy}
        aria-label={`Modifier ${fullName(p)}`} onClick={() => setSelectedId(p.userId)}
        style={{ ...cellStyle, cursor: busy ? 'default' : 'pointer', font: 'inherit' }}>
        {inner}
      </button>
    );
  };

  const renderFree = (side: 1 | 2, slotIdx: number) => {
    const teamColor = SIDE_COLOR[side];
    const isTarget = !!activeTarget && activeTarget.team === side && (activeTarget.slot == null || activeTarget.slot === slotIdx);
    const base: React.CSSProperties = {
      position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      width: '100%', boxSizing: 'border-box', minHeight: cellMinH, padding: '12px 6px 10px', border: 'none', borderRadius: 12,
      background: isTarget ? `${teamColor}1c` : 'transparent',
      outline: isTarget ? `2px dashed ${teamColor}` : 'none', outlineOffset: -4,
      fontFamily: th.fontUI,
    };
    const badge = showGD ? (
      <span aria-hidden="true" style={{ position: 'absolute', top: 6, [side === 1 ? 'left' : 'right']: 6, fontSize: 9, fontWeight: 800, lineHeight: 1, padding: '2px 5px', borderRadius: 5, background: `${teamColor}55`, color: inkOn(teamColor), letterSpacing: 0.3 }}>
        {SLOT_LABELS[slotIdx]}
      </span>
    ) : null;
    if (editable && onAddToTeam) {
      return (
        <button type="button" disabled={busy} data-target={isTarget || undefined}
          aria-label={`Ajouter un joueur à l'équipe ${side}`}
          onClick={() => onAddToTeam(side, slotIdx)}
          style={{ ...base, cursor: busy ? 'default' : 'pointer' }}>
          {badge}
          <span aria-hidden="true" style={{ width: av, height: av, borderRadius: '50%', border: `1.5px dashed ${teamColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: teamColor, fontSize: 17, lineHeight: 1 }}>+</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: teamColor }}>Ajouter</span>
        </button>
      );
    }
    if (onJoinFree) {
      return (
        <button type="button" disabled={busy}
          aria-label={`Rejoindre l'équipe ${side}`}
          onClick={() => onJoinFree(side, slotIdx)}
          style={{ ...base, cursor: busy ? 'default' : 'pointer' }}>
          {badge}
          <span aria-hidden="true" style={{ width: av, height: av, borderRadius: '50%', border: `1.5px dashed ${teamColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: teamColor, fontSize: 17, lineHeight: 1 }}>+</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: teamColor }}>Rejoindre</span>
        </button>
      );
    }
    return (
      <div style={base}>
        {badge}
        <span aria-hidden="true" style={{ width: av, height: av, borderRadius: '50%', border: `1.5px dashed ${th.lineStrong}` }} />
        <span style={{ fontSize: 11.5, color: th.textFaint }}>Place libre</span>
      </div>
    );
  };

  const halfCol = (side: 1 | 2) => {
    const teamColor = SIDE_COLOR[side];
    // Dégradé léger orienté vers le filet (moitié 1 vers la droite, moitié 2 vers la gauche).
    const grad = side === 1
      ? `linear-gradient(160deg, ${teamColor}10, ${teamColor}26)`
      : `linear-gradient(200deg, ${teamColor}10, ${teamColor}26)`;
    return (
      <div style={{ flex: 1, minWidth: 0, background: grad, borderTop: `3px solid ${teamColor}`, display: 'flex', flexDirection: 'column' }}>
        {layout[side].map((p, i) => (
          // Contenu épinglé en haut du quadrant (flex-start) + `cellMinH` égal sur toutes les
          // cellules → colonnes de hauteur identique, avatars et noms alignés d'une équipe à
          // l'autre, qu'un joueur ait une pastille niveau/orga et l'autre non.
          <div key={p ? p.userId : `free-${side}-${i}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
            {i > 0 && <div aria-hidden="true" style={{ height: 1, background: th.line, margin: '0 8px' }} />}
            {p ? renderPlayer(p, i) : renderFree(side, i)}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div ref={rootRef}>
      {/* Libellés d'équipe au-dessus du terrain */}
      <div style={{ display: 'flex', marginBottom: 6 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: SIDE_COLOR[1], flexShrink: 0 }} />
          <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 11.5, letterSpacing: 0.3, textTransform: 'uppercase', color: th.textMute }}>Équipe 1</span>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
          <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 11.5, letterSpacing: 0.3, textTransform: 'uppercase', color: th.textMute }}>Équipe 2</span>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: SIDE_COLOR[2], flexShrink: 0 }} />
        </div>
      </div>
      {/* Terrain : moitiés teintées, filet pointillé, badge VS */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'stretch', borderRadius: 14, overflow: 'hidden', border: `1px solid ${th.lineStrong}` }}>
        {halfCol(1)}
        <div aria-hidden="true" style={{ width: 0, borderLeft: `2px dashed ${th.lineStrong}` }} />
        {halfCol(2)}
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 32, height: 32, borderRadius: '50%', background: th.surface, border: `1px solid ${th.lineStrong}`, boxShadow: th.shadowSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, fontSize: 10, fontWeight: 800, color: th.textMute, letterSpacing: 0.5, pointerEvents: 'none' }}>VS</div>
      </div>
      {selected && (
        <PlayerActionSheet
          player={selected}
          playerName={fullName(selected)}
          slotLabel={showGD ? SLOT_LABELS[Math.max(0, layout[selected.team].findIndex((x) => x?.userId === selected.userId))] : undefined}
          teamColor={SIDE_COLOR[selected.team]}
          team={selected.team}
          busy={busy}
          canMove={canMove}
          canReplace={repAllowed(selected)}
          canRemove={remAllowed(selected)}
          onMove={() => { setSelectedId(null); onMove(selected); }}
          onReplace={() => { setSelectedId(null); onReplace!(selected); }}
          onRemove={() => { setSelectedId(null); onRemove!(selected); }}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
