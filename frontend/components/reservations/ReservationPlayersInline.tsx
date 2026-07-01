'use client';
import { useState } from 'react';
import { api, MyReservation } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { isPlayerChangeOpen } from '@/lib/reservations';
import { PartnerSearch } from '@/components/tournament/PartnerSearch';
import { PlayerPills } from '@/components/player/PlayerPills';
import { AddPlayerPill } from '@/components/player/AddPlayerPill';
import { MatchTeams } from '@/components/match/MatchTeams';

const ERR: Record<string, string> = {
  PLAYER_CHANGE_TOO_LATE: 'Trop tard pour modifier les joueurs.',
  RESERVATION_NOT_ACTIVE: "Cette réservation n'est pas modifiable.",
  TOO_MANY_PLAYERS: 'La partie est complète.',
  MEMBER_NOT_FOUND: "Ce joueur n'est pas membre du club.",
  PARTNER_DUPLICATE: 'Ce joueur est déjà dans la partie.',
  CANNOT_REMOVE_ORGANIZER: "L'organisateur ne peut pas être retiré.",
  PARTICIPANT_NOT_FOUND: 'Joueur introuvable.',
  UNAUTHORIZED: "Seul l'organisateur peut modifier cette réservation.",
};
const msg = (e: string) => ERR[e] ?? e;

// Édition inline des joueurs d'une réservation (chips + « Ajouter un joueur » + recherche),
// même expérience que Parties ouvertes. Remplace l'ancienne modale.
export function ReservationPlayersInline({ reservation, token, now, onChanged }: {
  reservation: MyReservation;
  token: string;
  now: number;
  onChanged: () => void;
}) {
  const { th } = useTheme();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const canEdit      = isPlayerChangeOpen(reservation, now);
  const participants = reservation.participants ?? [];
  const capacity     = reservation.capacity ?? 0;
  const spotsLeft    = Math.max(0, capacity - participants.length);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); onChanged(); }
    catch (e) { setError(msg((e as Error).message)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 9 }}>
      {error && (
        <div style={{ marginBottom: 8, background: th.accent, color: th.onAccent, borderRadius: 10, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>{error}</div>
      )}
      {reservation.resource.sport?.key === 'padel' ? (
        <MatchTeams
          players={participants.map((p) => ({
            userId: p.userId, firstName: p.firstName, lastName: p.lastName,
            avatarUrl: p.avatarUrl, isOrganizer: p.isOrganizer, participantId: p.id, level: p.level,
            team: (p.team ?? 1) as 1 | 2,
          }))}
          capacity={capacity}
          size="sm"
          busy={busy}
          editable={canEdit}
          onSetTeams={(teams) => run(() => api.setReservationTeams(reservation.id, teams, token))}
          onRemove={canEdit ? (p) => run(() => api.removeReservationPlayer(reservation.id, p.participantId!, token)) : undefined}
          canRemove={(p) => canEdit && !p.isOrganizer}
          addSlot={canEdit ? (
            <AddPlayerPill size="sm" disabled={busy}
              ariaLabel={`Ajouter un joueur à ${reservation.resource.name}`}
              onClick={() => setAdding((a) => !a)} />
          ) : undefined}
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
              onClick={() => setAdding((a) => !a)} />
          ) : undefined}
        />
      )}
      {canEdit && adding && (
        <div style={{ marginTop: 10 }}>
          <PartnerSearch
            slug={reservation.resource.club.slug} token={token} selected={null}
            excludeIds={participants.map((p) => p.userId)}
            onSelect={(m) => { setAdding(false); run(() => api.addReservationPlayer(reservation.id, m.id, token)); }}
            onClear={() => {}}
            disabled={busy}
          />
          <button type="button" onClick={() => setAdding(false)}
            style={{ marginTop: 8, border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13 }}>Annuler</button>
        </div>
      )}
    </div>
  );
}
