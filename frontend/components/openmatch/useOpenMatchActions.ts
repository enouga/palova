'use client';
import { useState } from 'react';
import { api, ClubDetail, OpenMatch } from '@/lib/api';
import { MatchPlayerData } from '@/components/match/MatchTeams';
import type { PlayerPillData } from '@/components/player/PlayerPills';
import { inRange } from '@/lib/levelMatch';
import { teamSlotMaps } from '@/lib/matchSlots';

// Libellés d'erreur partagés (liste + page détail).
export const JOIN_ERRORS: Record<string, string> = {
  MATCH_FULL:            'Cette partie est complète.',
  MATCH_IN_PAST:         'Cette partie a déjà eu lieu.',
  MATCH_NOT_JOINABLE:    "Cette partie n'est plus ouverte.",
  ALREADY_JOINED:        'Vous participez déjà à cette partie.',
  ORGANIZER_CANNOT_LEAVE: "Vous organisez cette partie : annulez la réservation pour la retirer.",
  MEMBERSHIP_REQUIRED:   'Réservé aux membres du club.',
  MEMBERSHIP_BLOCKED:    'Votre accès au club est bloqué.',
  NOT_ORGANIZER:          "Seul l'organisateur peut retirer un joueur.",
  CANNOT_REMOVE_ORGANIZER: "L'organisateur ne peut pas être retiré.",
  PARTICIPANT_NOT_FOUND:  "Ce joueur n'est plus dans la partie.",
  ALREADY_PARTICIPANT:   'Vous participez déjà à cette partie.',
  CHAT_FORBIDDEN:        'Réservé aux inscrits et aux intéressés.',
  NOT_ALLOWED:           'Action non autorisée.',
  RESERVATION_NOT_FOUND: "Cette partie n'existe plus.",
  TEAM_SLOT_TAKEN:       'Cette place est déjà prise.',
};

// Logique d'actions d'une partie ouverte (rejoindre/quitter/équipes/chat/intérêt/résultat)
// + cibles de modales. `reload` recharge la source (liste complète OU partie unique).
export function useOpenMatchActions({ club, token, myLevel, reload }: {
  club: ClubDetail; token: string | null; myLevel: number | null; reload: () => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [addingId, setAddingId] = useState<string | null>(null);
  const [recordingFor, setRecordingFor] = useState<OpenMatch | null>(null);
  const [joinWarning, setJoinWarning] = useState<OpenMatch | null>(null);
  const [chatting, setChatting] = useState<OpenMatch | null>(null);
  const [authPrompt, setAuthPrompt] = useState<OpenMatch | null>(null);

  const act = async (m: OpenMatch, fn: () => Promise<unknown>) => {
    if (!token) return;
    setBusyId(m.id); setError('');
    try { await fn(); await reload(); }
    catch (e) { setError(JOIN_ERRORS[(e as Error).message] ?? (e as Error).message); }
    finally { setBusyId(null); }
  };

  const addPlayerToTeam = (m: OpenMatch, memberId: string, team?: 1 | 2, slot?: number) => {
    setAddingId(null);
    act(m, async () => {
      await api.addOpenMatchPlayer(club.slug, m.id, memberId, token!);
      if (team) {
        const { teams, slots } = teamSlotMaps(m.players, m.maxPlayers, { userId: memberId, team, slot });
        await api.setOpenMatchTeams(club.slug, m.id, teams, token!, slots);
      }
    });
  };

  const replacePlayer = (m: OpenMatch, oldPlayer: MatchPlayerData, memberId: string) => {
    setAddingId(null);
    act(m, async () => {
      await api.removeOpenMatchPlayer(club.slug, m.id, oldPlayer.userId, token!);
      await api.addOpenMatchPlayer(club.slug, m.id, memberId, token!);
      const { teams, slots } = teamSlotMaps(
        m.players.filter((p) => p.userId !== oldPlayer.userId), m.maxPlayers,
        { userId: memberId, team: oldPlayer.team, slot: oldPlayer.slot ?? undefined },
      );
      await api.setOpenMatchTeams(club.slug, m.id, teams, token!, slots);
    });
  };

  const toggleInterest = (m: OpenMatch) =>
    act(m, () => (m.viewerIsInterested ? api.removeInterested(club.slug, m.id, token!) : api.setInterested(club.slug, m.id, token!)));

  const openChat = (m: OpenMatch) => {
    setChatting(m);
    if (token) api.markOpenMatchChatRead(club.slug, m.id, token)
      .then(() => { reload(); window.dispatchEvent(new Event('palova:openmatch-unread')); })
      .catch(() => {});
  };

  const join = (m: OpenMatch) => {
    if (!inRange(myLevel, m.targetLevelMin ?? null, m.targetLevelMax ?? null)) setJoinWarning(m);
    else act(m, () => api.joinOpenMatch(club.slug, m.id, token!));
  };
  const confirmJoin = (m: OpenMatch) => { setJoinWarning(null); act(m, () => api.joinOpenMatch(club.slug, m.id, token!)); };
  const leave = (m: OpenMatch) => act(m, () => api.leaveOpenMatch(club.slug, m.id, token!));
  const removePlayer = (m: OpenMatch, p: PlayerPillData) => act(m, () => api.removeOpenMatchPlayer(club.slug, m.id, p.userId, token!));
  const setTeams = (m: OpenMatch, teams: Record<string, 1 | 2>, slots?: Record<string, number>) =>
    act(m, () => api.setOpenMatchTeams(club.slug, m.id, teams, token!, slots));
  const onToggleAdd = (m: OpenMatch) => setAddingId((prev) => (prev === m.id ? null : m.id));
  const onCancelAdd = () => setAddingId(null);

  return {
    busyId, error, addingId, recordingFor, joinWarning, chatting, authPrompt,
    setError, setAddingId, setRecordingFor, setJoinWarning, setChatting, setAuthPrompt,
    join, confirmJoin, leave, removePlayer, setTeams, addPlayerToTeam, replacePlayer,
    toggleInterest, openChat, onToggleAdd, onCancelAdd,
  };
}

export type OpenMatchActions = ReturnType<typeof useOpenMatchActions>;
