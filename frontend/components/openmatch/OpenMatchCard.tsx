'use client';
import { useState } from 'react';
import { OpenMatch } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Btn, Chip } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { AddPlayerSheet } from '@/components/match/AddPlayerSheet';
import type { PlayerPillData } from '@/components/player/PlayerPills';
import { MatchTeams, MatchPlayerData } from '@/components/match/MatchTeams';
import { rangeLabel } from '@/lib/levelMatch';
import { MatchShareButton } from '@/components/openmatch/MatchShareButton';

function formatWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz })
    .format(new Date(iso)).replace(':', 'h');
}

export interface OpenMatchCardProps {
  match: OpenMatch;
  timezone: string;
  slug: string;
  token: string;
  busy: boolean;
  addingOpen: boolean;
  onJoin: (m: OpenMatch) => void;
  onLeave: (m: OpenMatch) => void;
  onRemovePlayer: (m: OpenMatch, p: PlayerPillData) => void;
  onSetTeams: (m: OpenMatch, teams: Record<string, 1 | 2>, slots?: Record<string, number>) => void;
  onAddPlayer: (m: OpenMatch, memberId: string, team?: 1 | 2, slot?: number) => void;
  onReplacePlayer: (m: OpenMatch, oldPlayer: MatchPlayerData, memberId: string) => void;
  onToggleAdd: (m: OpenMatch) => void;
  onCancelAdd: () => void;
  onRecordResult: (m: OpenMatch) => void;
  canRecordResult: boolean;
  onToggleInterest: (m: OpenMatch) => void;
  onOpenChat: (m: OpenMatch) => void;
  showSport?: boolean; // club multi-sport → chip sport près du terrain
  /** Visiteur non connecté : « Rejoindre » invite à s'inscrire ; actions membres masquées. */
  isAnonymous?: boolean;
  onAuthPrompt: (m: OpenMatch) => void;
  /** Ids des joueurs suivis (amis) du viewer : anneau d'accent + ligne de preuve sociale. */
  friendIds?: Set<string>;
}

// Carte d'une partie ouverte (terrain, créneau, fourchette, joueurs, actions).
// Extraite d'OpenMatches pour être réutilisée dans la section « Pour toi ».
export function OpenMatchCard({
  match: m, timezone, slug, token, busy, addingOpen,
  onJoin, onLeave, onRemovePlayer, onSetTeams, onAddPlayer, onReplacePlayer, onToggleAdd, onCancelAdd, onRecordResult, canRecordResult,
  onToggleInterest, onOpenChat, showSport, isAnonymous = false, onAuthPrompt, friendIds,
}: OpenMatchCardProps) {
  const { th } = useTheme();
  // Cible de la recherche de joueur : ajouter à une équipe précise, ou remplacer un joueur.
  const [addMode, setAddMode] = useState<{ kind: 'add'; team: 1 | 2; slot?: number } | { kind: 'replace'; player: MatchPlayerData } | null>(null);
  const friendCount = m.players.filter((p) => friendIds?.has(p.userId)).length;
  // Taille unique pour tous les boutons d'action → bord net, pas de largeurs en escalier.
  const actionBtn = { height: 46, fontSize: 15, padding: '0 18px' } as const;
  // Teinte douce dérivée d'une couleur (miroir du ton « accent » des Chip).
  const tint = (hex: string) => ({
    background: th.mode === 'floodlit' ? `${hex}1f` : `${hex}55`,
    color: th.mode === 'floodlit' ? hex : th.ink,
  });
  // Deux couleurs distinctes pour les actions secondaires, séparées entre elles
  // et de l'accent plein du bouton principal « Rejoindre » : émeraude = Discuter,
  // apricot = intérêt.
  const chatTint = tint(ACCENTS.emerald);
  const interestTint = tint(ACCENTS.apricot);
  const canChat = m.viewerIsParticipant || m.viewerIsInterested;
  return (
    <div style={{ background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Icon name="users" size={18} color={th.accent} />
        <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>{m.resourceName}</span>
        {showSport && m.sport && <Chip tone="line">{m.sport.name}</Chip>}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {(m.targetLevelMin != null || m.targetLevelMax != null) && (
            <Chip tone="line">{rangeLabel(m.targetLevelMin ?? null, m.targetLevelMax ?? null)}</Chip>
          )}
          {m.interestedCount > 0 && (
            <Chip tone="line" icon="users">{m.interestedCount} intéressé{m.interestedCount > 1 ? 's' : ''}</Chip>
          )}
          <Chip tone={m.full ? 'mute' : 'accent'}>{m.full ? 'Complet' : `${m.spotsLeft} place${m.spotsLeft > 1 ? 's' : ''}`}</Chip>
        </span>
      </div>
      <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginBottom: 12 }}>
        {formatWhen(m.startTime, timezone)} → {formatWhen(m.endTime, timezone)}
      </div>
      {friendCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: th.fontUI, fontSize: 12.5, color: th.accent, fontWeight: 600, marginBottom: 8 }}>
          <Icon name="users" size={14} color={th.accent} />
          {friendCount === 1 ? '1 de vos amis joue ici' : `${friendCount} de vos amis jouent ici`}
        </div>
      )}
      <MatchTeams
        players={m.players.map((p) => ({
          userId: p.userId, firstName: p.firstName, lastName: p.lastName,
          avatarUrl: p.avatarUrl, isOrganizer: p.isOrganizer, level: p.level,
          team: (p.team ?? 1) as 1 | 2,
          slot: p.slot,
        }))}
        capacity={m.maxPlayers}
        friendIds={friendIds}
        busy={busy}
        editable={m.viewerIsOrganizer}
        onSetTeams={(teams, slots) => onSetTeams(m, teams, slots)}
        onRemove={(p) => onRemovePlayer(m, { userId: p.userId, firstName: p.firstName, lastName: p.lastName, isOrganizer: p.isOrganizer })}
        canRemove={(p) => m.viewerIsOrganizer && !p.isOrganizer}
        onReplace={m.viewerIsOrganizer ? ((p) => { setAddMode({ kind: 'replace', player: p }); if (!addingOpen) onToggleAdd(m); }) : undefined}
        canReplace={(p) => m.viewerIsOrganizer && !p.isOrganizer}
        onAddToTeam={m.viewerIsOrganizer ? ((team, slot) => { setAddMode({ kind: 'add', team, slot }); if (!addingOpen) onToggleAdd(m); }) : undefined}
        activeTarget={addingOpen && addMode?.kind === 'add' ? { team: addMode.team, slot: addMode.slot } : null}
      />

      {/* Barre d'actions : secondaires (Discuter / intérêt / résultat) à gauche, action principale à droite.
          Visiteur anonyme : actions membres masquées, seul « Rejoindre » (→ invite à s'inscrire) reste. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 14, paddingTop: 14, borderTop: `1px solid ${th.line}` }}>
        {!isAnonymous && (
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <Btn variant="surface" style={{ ...actionBtn, ...(canChat ? chatTint : {}) }} disabled={!canChat} onClick={() => onOpenChat(m)}>
              Discuter
            </Btn>
            {m.unreadCount > 0 && (
              <span aria-label={`${m.unreadCount} non lus`} style={{ position: 'absolute', top: -6, right: -6, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: '#e5484d', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI }}>
                {m.unreadCount > 99 ? '99+' : m.unreadCount}
              </span>
            )}
          </span>
        )}
        {!isAnonymous && !m.viewerIsParticipant && (
          m.viewerIsInterested ? (
            <Btn variant="surface" style={{ ...actionBtn, ...interestTint }} disabled={busy} onClick={() => onToggleInterest(m)}>
              <Icon name="check" size={18} color={interestTint.color} />Intéressé
            </Btn>
          ) : (
            <Btn variant="surface" style={actionBtn} disabled={busy} onClick={() => onToggleInterest(m)}>
              {"Ça m'intéresse"}
            </Btn>
          )
        )}
        {canRecordResult && new Date(m.endTime).getTime() <= Date.now() && m.players.length === 4 && (
          <Btn variant="surface" style={actionBtn} disabled={busy} onClick={() => onRecordResult(m)}>Saisir le résultat</Btn>
        )}
        <MatchShareButton
          style={actionBtn}
          title={`Partie ouverte · ${m.resourceName}`}
          url={typeof window !== 'undefined' ? `${window.location.origin}/parties/${m.id}` : `/parties/${m.id}`}
        />
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center' }}>
          {m.viewerIsOrganizer ? (
            <Chip tone="line" icon="check">Vous organisez</Chip>
          ) : m.viewerIsParticipant ? (
            <Btn variant="surface" style={actionBtn} disabled={busy} onClick={() => onLeave(m)}>Quitter</Btn>
          ) : (
            <Btn icon="plus" style={actionBtn} disabled={busy || m.full} onClick={() => (isAnonymous ? onAuthPrompt(m) : onJoin(m))}>Rejoindre</Btn>
          )}
        </span>
      </div>
      {m.viewerIsOrganizer && addingOpen && addMode && (
        <AddPlayerSheet
          slug={slug} token={token}
          team={addMode.kind === 'add' ? addMode.team : addMode.player.team}
          slot={addMode.kind === 'add' ? addMode.slot : undefined}
          replaceName={addMode.kind === 'replace' ? `${addMode.player.firstName} ${addMode.player.lastName}` : undefined}
          excludeIds={m.players.map((p) => p.userId)}
          busy={busy}
          onPick={(member) => {
            if (addMode.kind === 'replace') onReplacePlayer(m, addMode.player, member.id);
            else onAddPlayer(m, member.id, addMode.team, addMode.slot);
            setAddMode(null); onCancelAdd();
          }}
          onClose={() => { setAddMode(null); onCancelAdd(); }}
        />
      )}
    </div>
  );
}
