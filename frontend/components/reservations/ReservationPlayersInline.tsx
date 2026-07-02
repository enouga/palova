'use client';
import { useState } from 'react';
import { api, MyReservation } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { isPlayerChangeOpen } from '@/lib/reservations';
import { PartnerSearch } from '@/components/tournament/PartnerSearch';
import { PlayerPills } from '@/components/player/PlayerPills';
import { AddPlayerPill } from '@/components/player/AddPlayerPill';
import { MatchTeams, MatchPlayerData } from '@/components/match/MatchTeams';
import { AddPlayerSheet } from '@/components/match/AddPlayerSheet';
import { teamSlotMaps } from '@/lib/matchSlots';

const ERR: Record<string, string> = {
  PLAYER_CHANGE_TOO_LATE: 'Trop tard pour modifier les joueurs.',
  RESERVATION_NOT_ACTIVE: "Cette réservation n'est pas modifiable.",
  TOO_MANY_PLAYERS: 'La partie est complète.',
  MEMBER_NOT_FOUND: "Ce joueur n'est pas membre du club.",
  PARTNER_DUPLICATE: 'Ce joueur est déjà dans la partie.',
  CANNOT_REMOVE_ORGANIZER: "L'organisateur ne peut pas être retiré.",
  PARTICIPANT_NOT_FOUND: 'Joueur introuvable.',
  TEAM_SIDE_FULL: 'Cette équipe est déjà complète.',
  TEAM_SLOT_TAKEN: 'Cette place est déjà prise.',
  UNAUTHORIZED: "Seul l'organisateur peut modifier cette réservation.",
};
const msg = (e: string) => ERR[e] ?? e;

// Édition inline des joueurs d'une réservation. Padel → MatchTeams (équipes G/D, ajout ciblé,
// remplacer / déplacer). Autres sports → liste plate PlayerPills.
export function ReservationPlayersInline({ reservation, token, now, onChanged }: {
  reservation: MyReservation;
  token: string;
  now: number;
  onChanged: () => void;
}) {
  const { th } = useTheme();
  // Cible de la recherche : ajouter à une équipe précise, ou remplacer un joueur.
  const [addMode, setAddMode] = useState<{ kind: 'add'; team: 1 | 2; slot?: number } | { kind: 'replace'; player: MatchPlayerData } | null>(null);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const canEdit      = isPlayerChangeOpen(reservation, now);
  const isPadel      = reservation.resource.sport?.key === 'padel';
  const participants = reservation.participants ?? [];
  const capacity     = reservation.capacity ?? 0;
  const spotsLeft    = Math.max(0, capacity - participants.length);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); onChanged(); }
    catch (e) { setError(msg((e as Error).message)); }
    finally { setBusy(false); }
  };

  // Ajout ciblé : ajoute le membre puis (padel) l'épingle sur l'équipe ET la place choisies.
  const addPlayer = (memberId: string, team?: 1 | 2, slot?: number) => {
    setAddMode(null);
    run(async () => {
      await api.addReservationPlayer(reservation.id, memberId, token);
      if (isPadel && team) {
        const { teams, slots } = teamSlotMaps(participants, capacity, { userId: memberId, team, slot });
        await api.setReservationTeams(reservation.id, teams, token, slots);
      }
    });
  };
  // Remplacement : retire l'ancien, ajoute le nouveau, (padel) sur la place de l'ancien.
  const replacePlayer = (oldPlayer: MatchPlayerData, memberId: string) => {
    setAddMode(null);
    run(async () => {
      if (oldPlayer.participantId) await api.removeReservationPlayer(reservation.id, oldPlayer.participantId, token);
      await api.addReservationPlayer(reservation.id, memberId, token);
      if (isPadel) {
        const { teams, slots } = teamSlotMaps(
          participants.filter((p) => p.userId !== oldPlayer.userId), capacity,
          { userId: memberId, team: oldPlayer.team, slot: oldPlayer.slot ?? undefined },
        );
        await api.setReservationTeams(reservation.id, teams, token, slots);
      }
    });
  };

  // Membre choisi dans la recherche → ajoute ou remplace selon la cible courante.
  const onPickMember = (memberId: string) => {
    if (!addMode) return;
    if (addMode.kind === 'replace') replacePlayer(addMode.player, memberId);
    else addPlayer(memberId, addMode.team, addMode.slot);
  };

  return (
    <div style={{ marginTop: 9 }}>
      {error && (
        <div style={{ marginBottom: 8, background: th.accent, color: th.onAccent, borderRadius: 10, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>{error}</div>
      )}
      {isPadel ? (
        <MatchTeams
          players={participants.map((p) => ({
            userId: p.userId, firstName: p.firstName, lastName: p.lastName,
            avatarUrl: p.avatarUrl, isOrganizer: p.isOrganizer, participantId: p.id, level: p.level,
            team: (p.team ?? 1) as 1 | 2,
            slot: p.slot,
          }))}
          capacity={capacity}
          size="sm"
          busy={busy}
          editable={canEdit}
          onSetTeams={(teams, slots) => run(() => api.setReservationTeams(reservation.id, teams, token, slots))}
          onRemove={canEdit ? (p) => run(() => api.removeReservationPlayer(reservation.id, p.participantId!, token)) : undefined}
          canRemove={(p) => canEdit && !p.isOrganizer}
          onReplace={canEdit ? ((p) => setAddMode({ kind: 'replace', player: p })) : undefined}
          canReplace={(p) => canEdit && !p.isOrganizer}
          onAddToTeam={canEdit ? ((team, slot) => setAddMode({ kind: 'add', team, slot })) : undefined}
          activeTarget={addMode?.kind === 'add' ? { team: addMode.team, slot: addMode.slot } : null}
        />
      ) : (
        <PlayerPills
          players={participants.map((p) => ({
            userId: p.userId, firstName: p.firstName, lastName: p.lastName,
            avatarUrl: p.avatarUrl, isOrganizer: p.isOrganizer, participantId: p.id,
            level: p.level,
          }))}
          spotsLeft={spotsLeft}
          size="sm"
          busy={busy}
          onRemove={canEdit ? (p) => run(() => api.removeReservationPlayer(reservation.id, p.participantId!, token)) : undefined}
          canRemove={(p) => canEdit && !p.isOrganizer}
          firstSpotSlot={canEdit ? (
            <AddPlayerPill size="sm" disabled={busy}
              ariaLabel={`Ajouter un joueur à ${reservation.resource.name}`}
              onClick={() => setAddMode({ kind: 'add', team: 1 })} />
          ) : undefined}
        />
      )}
      {canEdit && addMode && (isPadel ? (
        <AddPlayerSheet
          slug={reservation.resource.club.slug} token={token}
          team={addMode.kind === 'add' ? addMode.team : addMode.player.team}
          slot={addMode.kind === 'add' ? addMode.slot : undefined}
          replaceName={addMode.kind === 'replace' ? `${addMode.player.firstName} ${addMode.player.lastName}` : undefined}
          excludeIds={participants.map((p) => p.userId)}
          busy={busy}
          onPick={(m) => onPickMember(m.id)}
          onClose={() => setAddMode(null)}
        />
      ) : (
        <div style={{ marginTop: 10 }}>
          <PartnerSearch
            autoFocus
            slug={reservation.resource.club.slug} token={token} selected={null}
            excludeIds={participants.map((p) => p.userId)}
            onSelect={(m) => onPickMember(m.id)}
            onClear={() => {}}
            disabled={busy}
          />
          <button type="button" onClick={() => setAddMode(null)}
            style={{ marginTop: 8, border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13 }}>Annuler</button>
        </div>
      ))}
    </div>
  );
}
