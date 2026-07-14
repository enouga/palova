'use client';
import { useEffect, useState } from 'react';
import { api, MyReservation, TimeSlot } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { durationLabel } from '@/lib/duration';
import { Btn } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { ReservationPlayersInline } from '@/components/reservations/ReservationPlayersInline';
import { OpenMatchQuickSwitch } from '@/components/reservations/OpenMatchQuickSwitch';

/**
 * Écran de succès de la modale de réservation : la confirmation devient le moment
 * d'organisation de la partie — joueurs/équipes/partie ouverte via les briques
 * post-confirmation existantes (ReservationPlayersInline + OpenMatchQuickSwitch), sans timer.
 */
export function BookingSuccess({ reservationId, token, summary, slot, timezone, resourceName, duration, showPartners, onDone }: {
  reservationId: string;
  token: string;
  /** Résumé du paiement (« Payé avec votre carnet · … », « À régler au club »…). */
  summary: string;
  slot: TimeSlot;
  timezone?: string;
  resourceName?: string;
  duration: number;
  /** Terrain multi-joueurs sur un hôte club → bloc d'organisation. */
  showPartners: boolean;
  onDone: () => void;
}) {
  const { th } = useTheme();
  // Horloge posée au montage : l'écran n'existe que côté client, après confirmation.
  const [now] = useState(() => Date.now());
  const [resa, setResa] = useState<MyReservation | null>(null);
  const [failed, setFailed] = useState(false);

  // ReservationPlayersInline consomme un MyReservation complet : on le prend dans
  // « Mes réservations » (même source que le calendrier). Échec → lien de repli,
  // jamais d'écran d'erreur après une confirmation réussie.
  const reload = () => {
    api.getMyReservations(token)
      .then((rows) => {
        const r = rows.find((x) => x.id === reservationId) ?? null;
        if (r) { setResa(r); setFailed(false); } else setFailed(true);
      })
      .catch(() => setFailed(true));
  };
  useEffect(() => { if (showPartners) reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hour = (iso: string) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: timezone })
    .format(new Date(iso)).replace(':', 'h');
  const dateLabel = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone })
    .format(new Date(slot.startTime));

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(34,197,94,0.13)', color: '#15803d', borderRadius: 14, padding: '12px 14px' }}>
        <span style={{ width: 26, height: 26, flex: '0 0 auto', borderRadius: '50%', background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={15} color="#fff" stroke={2.6} />
        </span>
        <span style={{ fontFamily: th.fontUI, fontSize: 15.5, fontWeight: 700 }}>Réservation confirmée !</span>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontFamily: th.fontDisplay, fontSize: 16, fontWeight: 700, color: th.text, textTransform: 'capitalize', letterSpacing: -0.3 }}>{dateLabel}</div>
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 500, color: th.textMute }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <Icon name="clock" size={13} color={th.textFaint} />
            {hour(slot.startTime)} → {hour(slot.endTime)}
          </span>
          <span style={{ whiteSpace: 'nowrap' }}>· {durationLabel(duration)}</span>
          {resourceName ? <span style={{ whiteSpace: 'nowrap' }}>· {resourceName}</span> : null}
        </div>
        <div style={{ marginTop: 7, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: th.text }}>{summary}</div>
      </div>

      {showPartners && (
        <div style={{ marginTop: 18 }}>
          {!failed && resa && (
            <OpenMatchQuickSwitch reservation={resa} token={token} onChanged={reload} />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
            <Icon name="users" size={13} color={th.textMute} />
            <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: th.textMute }}>Organisez votre partie</span>
          </div>
          {failed ? (
            <a href="/me/reservations" style={{ fontFamily: th.fontUI, fontSize: 13, color: th.accent, fontWeight: 600 }}>Gérer ma réservation →</a>
          ) : resa ? (
            <ReservationPlayersInline reservation={resa} token={token} now={now} onChanged={reload} hideOpenMatchToggle />
          ) : (
            <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>Chargement…</div>
          )}
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <Btn full onClick={onDone}>Terminé</Btn>
      </div>
    </div>
  );
}
