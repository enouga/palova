'use client';

import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Btn, Chip } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { MyReservation } from '@/lib/api';
import { isCancellationOpen } from '@/lib/reservations';
import { rangeLabel } from '@/lib/levelMatch';
import { MatchShareButton } from '@/components/openmatch/MatchShareButton';
import { ReservationPlayersInline } from '@/components/reservations/ReservationPlayersInline';
import { MatchTeams } from '@/components/match/MatchTeams';

const MATCH_STATUS_LABEL: Record<string, string> = { PENDING: 'À confirmer', CONFIRMED: 'Résultat enregistré', DISPUTED: 'En litige' };

function fmtHour(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}
function fmtDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
}

export interface ReservationAgendaCardProps {
  reservation: MyReservation;
  past: boolean;
  /** Vue cross-club couvrant plusieurs sports → chip sport en plus du nom du club. */
  showSport?: boolean;
  /** Vue liste (pas de titre de jour au-dessus) → la date rejoint l'heure sur la ligne meta. */
  showDate?: boolean;
  token: string | null;
  now: number;
  onCancel: (r: MyReservation) => void;
  onPlayersChanged: () => void;
  /** Ouvre la feuille de chat de cette réservation — montée une seule fois au niveau de la page. */
  onOpenChat: (r: MyReservation) => void;
  onRecordResult?: (r: MyReservation) => void;
  canRecord?: (r: MyReservation) => boolean;
  existingMatchStatus?: 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'CANCELLED';
}

// Carte d'une réservation padel dans « Mes réservations » (Calendrier + À venir/Passées),
// alignée sur la présentation d'OpenMatchCard (chip places, chips sport/niveau, barre
// Discuter+Partager+Annuler) — extrait de DayPanel/MyAgendaListItem qui dupliquaient ce
// rendu. Le viewer est TOUJOURS l'organisateur ici (listUserReservations filtre son propre
// userId) : jamais de chip « Vous organisez »/« Quitter », Annuler est l'action utile.
export function ReservationAgendaCard({
  reservation: r, past, showSport, showDate = false, token, now,
  onCancel, onPlayersChanged, onOpenChat, onRecordResult, canRecord, existingMatchStatus,
}: ReservationAgendaCardProps) {
  const { th } = useTheme();

  const capacity = r.capacity ?? 0;
  const participants = r.participants ?? [];
  const spotsLeft = Math.max(0, capacity - participants.length);
  const full = spotsLeft <= 0;
  const isPublic = r.visibility === 'PUBLIC';
  const canCancel = !past && isCancellationOpen(r, now);
  const hasLevel = isPublic && (r.targetLevelMin != null || r.targetLevelMax != null);
  const showRecordBtn = past && !!canRecord?.(r) && !existingMatchStatus && !!onRecordResult;
  const matchStatusLabel = past && !!existingMatchStatus ? MATCH_STATUS_LABEL[existingMatchStatus] : null;
  const showChatShare = !past && isPublic && !!token;
  const hasFooter = !past || showRecordBtn || !!matchStatusLabel;

  const tint = (hex: string) => ({
    background: th.mode === 'floodlit' ? `${hex}1f` : `${hex}55`,
    color: th.mode === 'floodlit' ? hex : th.ink,
  });
  const chatTint = tint(ACCENTS.emerald);
  const actionBtn = { height: 38, fontSize: 13.5, padding: '0 14px' } as const;

  const tz = r.resource.club.timezone;
  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/parties/${r.id}` : `/parties/${r.id}`;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 16, color: th.text }}>{r.resource.name}</span>
        {!past && <Chip tone={full ? 'mute' : 'accent'}>{full ? 'Complet' : `${spotsLeft} place${spotsLeft > 1 ? 's' : ''}`}</Chip>}
      </div>
      <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 2 }}>{r.resource.club.name}</div>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 8, fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Icon name="clock" size={14} color={th.textMute} />
          {showDate ? `${fmtDate(r.startTime, tz)} · ` : ''}{fmtHour(r.startTime, tz)}–{fmtHour(r.endTime, tz)}
        </span>
        <span style={{ fontFamily: th.fontMono }}>{Number(r.totalPrice)}€</span>
        {showSport && r.resource.sport && <Chip tone="line">{r.resource.sport.name}</Chip>}
        {hasLevel && <Chip tone="line">{rangeLabel(r.targetLevelMin ?? null, r.targetLevelMax ?? null)}</Chip>}
      </div>

      {!past && token ? (
        <ReservationPlayersInline reservation={r} token={token} now={now} onChanged={onPlayersChanged} />
      ) : participants.length > 0 ? (
        <div style={{ marginTop: 10 }}>
          <MatchTeams
            players={participants.map((p) => ({
              userId: p.userId, firstName: p.firstName, lastName: p.lastName,
              avatarUrl: p.avatarUrl, isOrganizer: p.isOrganizer, level: p.level,
              team: (p.team ?? 1) as 1 | 2, slot: p.slot,
            }))}
            capacity={capacity}
            size="sm"
          />
        </div>
      ) : null}

      {hasFooter && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: `1px solid ${th.line}` }}>
          {showChatShare && (
            <>
              <Btn variant="surface" style={{ ...actionBtn, ...chatTint }} onClick={() => onOpenChat(r)}>Discuter</Btn>
              <MatchShareButton compact style={actionBtn} title={r.resource.name} url={shareUrl} />
            </>
          )}
          {showRecordBtn && (
            <Btn variant="surface" style={actionBtn} onClick={() => onRecordResult!(r)}>Saisir le résultat</Btn>
          )}
          {matchStatusLabel && !showRecordBtn && (
            <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>{matchStatusLabel}</span>
          )}
          {!past && (
            <span style={{ marginLeft: 'auto' }}>
              <button onClick={() => onCancel(r)} disabled={!canCancel}
                style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: canCancel ? 'pointer' : 'not-allowed', borderRadius: 9, padding: '5px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: canCancel ? '#ff7a4d' : th.textFaint }}>
                Annuler
              </button>
            </span>
          )}
        </div>
      )}
    </>
  );
}
