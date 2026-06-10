'use client';
import { useState, useEffect } from 'react';
import { api, TimeSlot, Reservation } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { durationLabel } from '@/lib/duration';
import { Btn } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';

interface BookingModalProps {
  slot: TimeSlot;
  resourceId: string;
  pricePerHour: string;
  duration: number;
  token: string;
  timezone?: string;
  /** Mode déplacement : id de la résa à remplacer — un seul appel atomique, pas de hold. */
  moveReservationId?: string;
  onClose: () => void;
  onConfirmed: (reservation: Reservation) => void;
}

const HOLD_SECONDS = 600;

function formatHour(iso: string, tz = 'Europe/Paris'): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz })
    .format(new Date(iso)).replace(':', 'h');
}

function ProgressRing({ frac, size = 132 }: { frac: number; size?: number }) {
  const { th } = useTheme();
  const r = (size - 12) / 2;
  const C = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={th.surface2} strokeWidth="6" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={th.accent} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={C * (1 - frac)} style={{ transition: 'stroke-dashoffset 1s linear' }} />
    </svg>
  );
}

const MOVE_ERRORS: Record<string, string> = {
  SLOT_NOT_AVAILABLE:     "Ce créneau vient d'être pris. Choisissez-en un autre.",
  SLOT_ALREADY_HELD:      "Ce créneau vient d'être pris. Choisissez-en un autre.",
  RESERVATION_NOT_ACTIVE: 'Cette réservation ne peut plus être déplacée.',
  RESERVATION_IN_PAST:    'Cette réservation ne peut plus être déplacée.',
  OUT_OF_HOURS:           "Ce créneau est en dehors des horaires d'ouverture.",
};

export default function BookingModal({
  slot, resourceId, pricePerHour, duration, token, timezone, moveReservationId, onClose, onConfirmed,
}: BookingModalProps) {
  const { th } = useTheme();
  const [phase, setPhase]             = useState<'confirm' | 'pending' | 'error'>('confirm');
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(HOLD_SECONDS);
  const [errorMsg, setErrorMsg]       = useState('');

  const totalPrice = (Number(pricePerHour) * (duration / 60)).toFixed(0);
  const durLabel = durationLabel(duration);

  useEffect(() => {
    if (phase !== 'pending') return;
    if (secondsLeft <= 0) {
      setPhase('error');
      setErrorMsg('La pré-réservation a expiré. Veuillez recommencer.');
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, secondsLeft]);

  const handleHold = async () => {
    try {
      const res = await api.holdSlot({ resourceId, startTime: slot.startTime, endTime: slot.endTime }, token);
      setReservation(res);
      setSecondsLeft(HOLD_SECONDS);
      setPhase('pending');
    } catch (err) {
      setPhase('error');
      setErrorMsg(
        (err as Error).message === 'SLOT_ALREADY_HELD'
          ? "Ce créneau vient d'être pris. Choisissez-en un autre."
          : (err as Error).message,
      );
    }
  };

  const handleConfirm = async () => {
    if (!reservation) return;
    try {
      const confirmed = await api.confirmReservation(reservation.id, token);
      onConfirmed(confirmed);
    } catch (err) {
      setPhase('error');
      setErrorMsg(
        (err as Error).message === 'SLOT_NO_LONGER_AVAILABLE'
          ? 'Ce créneau a été pris entre-temps. Veuillez recommencer.'
          : (err as Error).message,
      );
    }
  };

  // Mode déplacement : un seul appel atomique côté backend (l'ancienne résa
  // n'est annulée que si le nouveau créneau est obtenu) — pas de hold de 10 min.
  const handleMove = async () => {
    if (!moveReservationId) return;
    try {
      const moved = await api.rescheduleReservation(
        moveReservationId,
        { resourceId, startTime: slot.startTime, duration },
        token,
      );
      onConfirmed(moved);
    } catch (err) {
      setPhase('error');
      setErrorMsg(MOVE_ERRORS[(err as Error).message] ?? (err as Error).message);
    }
  };

  const handleClose = async () => {
    if (phase === 'pending' && reservation) {
      try { await api.cancelReservation(reservation.id, token); } catch { /* cleanup job récupèrera */ }
    }
    onClose();
  };

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
      <div onClick={handleClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', animation: 'sp-fade .25s ease' }} />
      <div style={{ position: 'relative', width: '100%', maxWidth: 480, margin: '0 auto', background: th.bgElev, borderRadius: '0 0 28px 28px', padding: '12px 20px 36px', boxShadow: '0 10px 40px rgba(0,0,0,0.3)', animation: 'sp-sheet-in-top .34s cubic-bezier(.2,.8,.2,1)' }}>
        {phase === 'confirm' && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 52, lineHeight: 1, color: th.text, letterSpacing: -1 }}>{totalPrice}€</span>
              <span style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>{durLabel} · {Number(pricePerHour)}€/h</span>
            </div>
            <div style={{ background: th.surface2, borderRadius: 16, padding: '4px 16px', marginTop: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '13px 0' }}>
                <span style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>Horaire</span>
                <span style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 600, color: th.text }}>{formatHour(slot.startTime, timezone)} → {formatHour(slot.endTime, timezone)}</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 2px', color: th.textMute }}>
              <Icon name="clock" size={15} color={th.textMute} />
              <span style={{ fontFamily: th.fontUI, fontSize: 12.5, lineHeight: 1.4 }}>
                {moveReservationId
                  ? <>Votre réservation actuelle sera <b style={{ color: th.text }}>annulée et remplacée</b> par ce créneau.</>
                  : <>Le créneau sera bloqué <b style={{ color: th.text }}>10 minutes</b> le temps de confirmer.</>}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 11 }}>
              <Btn variant="surface" onClick={handleClose} style={{ flex: '0 0 38%' }}>Annuler</Btn>
              {moveReservationId
                ? <Btn icon="arrowR" onClick={handleMove} style={{ flex: 1 }}>Déplacer ici</Btn>
                : <Btn icon="lock" onClick={handleHold} style={{ flex: 1 }}>Pré-réserver</Btn>}
            </div>
          </>
        )}

        {phase === 'pending' && (
          <>
            <div style={{ position: 'relative', width: 132, height: 132, margin: '6px auto 4px' }}>
              <ProgressRing frac={secondsLeft / HOLD_SECONDS} />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontFamily: th.fontMono, fontWeight: 700, fontSize: 30, color: th.text, letterSpacing: -1 }}>{mm}:{ss}</span>
                <span style={{ fontFamily: th.fontUI, fontSize: 10.5, letterSpacing: 0.5, textTransform: 'uppercase', color: th.textMute, marginTop: 2 }}>Confirmez dans</span>
              </div>
            </div>
            <div style={{ textAlign: 'center', fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, color: th.text, letterSpacing: -0.3 }}>Créneau bloqué pour vous</div>
            <div style={{ textAlign: 'center', fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 6 }}>{formatHour(slot.startTime, timezone)} → {formatHour(slot.endTime, timezone)} · {totalPrice}€</div>
            <div style={{ display: 'flex', gap: 11, marginTop: 22 }}>
              <Btn variant="surface" onClick={handleClose} style={{ flex: '0 0 38%' }}>Abandonner</Btn>
              <Btn icon="arrowR" onClick={handleConfirm} style={{ flex: 1 }}>Confirmer et payer</Btn>
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.onAccent, background: th.accent, padding: '12px 14px', borderRadius: 12, fontWeight: 600 }}>{errorMsg}</div>
            <div style={{ marginTop: 14 }}>
              <Btn full variant="surface" onClick={onClose}>Fermer</Btn>
            </div>
          </>
        )}

        <div style={{ width: 38, height: 5, borderRadius: 3, background: th.lineStrong, margin: '18px auto 0' }} />
      </div>
    </div>
  );
}
