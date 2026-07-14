'use client';
import { useEffect, useState } from 'react';
import { api, MyReservation } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { sportHasLevels } from '@/lib/level';
import { loadLevelPref } from '@/lib/levelPrefs';
import { useLevelSystemEnabled } from '@/lib/useLevelSystem';
import { Icon } from '@/components/ui/Icon';

const ERR: Record<string, string> = {
  UNAUTHORIZED: "Seul l'organisateur peut ouvrir cette partie.",
  RESERVATION_NOT_ACTIVE: "Cette réservation n'est pas ouvrable.",
  OPEN_MATCH_PADEL_ONLY: 'Seules les parties de padel peuvent être ouvertes.',
};
const msg = (e: string) => ERR[e] ?? e;

/**
 * Bascule rapide « Partie ouverte aux membres » sur l'écran de succès de réservation :
 * reprend l'UI de l'ancien interrupteur pré-confirmation de BookingModal, mais appelle
 * l'API post-confirmation (setReservationVisibility) puisque la résa est déjà CONFIRMED.
 * Ne mémorise jamais la fourchette de niveau — seul OpenMatchToggle (avec son slider) le fait.
 */
export function OpenMatchQuickSwitch({ reservation, token, onChanged }: {
  reservation: MyReservation;
  token: string;
  onChanged: () => void;
}) {
  const { th } = useTheme();
  const levelEnabled = useLevelSystemEnabled();
  const sportKey = reservation.resource.sport?.key;
  const isPadel = sportKey === 'padel';
  const levelForSport = levelEnabled && sportHasLevels(sportKey);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [levelLimited, setLevelLimited] = useState(true);
  const [levelMin, setLevelMin] = useState(3);
  const [levelMax, setLevelMax] = useState(5);

  const openMatch = reservation.visibility === 'PUBLIC';

  // Préremplissage de la fourchette de niveau : dernier choix mémorisé, sinon défaut centré
  // sur le niveau du joueur ±1 (borné 1–8). Miroir de l'ancien effet de BookingModal.
  useEffect(() => {
    if (!isPadel || !levelForSport) return;
    const clamp = (v: number) => Math.max(1, Math.min(8, Math.round(v * 10) / 10));
    const pref = loadLevelPref();
    if (pref) { setLevelLimited(pref.enabled); setLevelMin(pref.min); setLevelMax(pref.max); return; }
    api.getMyRating(token, sportKey).then((r) => {
      const lvl = r?.level ?? null;
      if (lvl != null) { setLevelMin(clamp(lvl - 1)); setLevelMax(clamp(lvl + 1)); }
    }).catch(() => {});
  }, [isPadel, levelForSport, token, sportKey]);

  if (!isPadel) return null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (openMatch) {
        await api.setReservationVisibility(reservation.id, 'PRIVATE', token);
      } else {
        const limiting = levelForSport && levelLimited;
        await api.setReservationVisibility(reservation.id, 'PUBLIC', token, {
          targetLevelMin: limiting ? levelMin : null,
          targetLevelMax: limiting ? levelMax : null,
        });
      }
      onChanged();
    } catch (e) {
      setError(msg((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <Icon name="users" size={13} color={th.textMute} />
        <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: th.textMute }}>Votre partie</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: th.text }}>Partie ouverte aux membres</span>
        <button type="button" role="switch" aria-checked={openMatch} aria-label="Partie ouverte aux membres"
          disabled={busy} onClick={toggle}
          style={{ width: 42, height: 24, borderRadius: 999, border: 'none', cursor: busy ? 'not-allowed' : 'pointer', padding: 0, position: 'relative', background: openMatch ? th.accent : th.lineStrong, transition: 'background .15s', flex: '0 0 auto', opacity: busy ? 0.6 : 1 }}>
          <span style={{ position: 'absolute', top: 3, left: openMatch ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
        </button>
      </div>
      <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, marginTop: 6, lineHeight: 1.4 }}>
        {openMatch
          ? (levelForSport
              ? (levelLimited ? `Niveau ${levelMin}–${levelMax}.` : 'Ouverte à tous les niveaux.')
              : 'Visible et rejoignable par les membres du club.')
          : 'Réservation privée.'}
      </div>
      {error && (
        <div style={{ marginTop: 8, background: th.accent, color: th.onAccent, borderRadius: 10, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>{error}</div>
      )}
    </div>
  );
}
