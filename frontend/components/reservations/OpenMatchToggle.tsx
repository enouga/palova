'use client';
import { useState } from 'react';
import { api, MyReservation } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Chip } from '@/components/ui/atoms';
import { LevelRangeSlider } from '@/components/player/LevelRangeSlider';
import { MatchShareButton } from '@/components/openmatch/MatchShareButton';
import { sportHasLevels } from '@/lib/level';

const ERR: Record<string, string> = {
  UNAUTHORIZED: "Seul l'organisateur peut ouvrir cette partie.",
  RESERVATION_NOT_ACTIVE: "Cette réservation n'est pas ouvrable.",
  RESERVATION_IN_PAST: 'Trop tard pour ouvrir cette partie.',
  OPEN_MATCH_PADEL_ONLY: 'Seules les parties de padel peuvent être ouvertes.',
};
const msg = (e: string) => ERR[e] ?? e;

// Bascule « partie ouverte » d'une réservation confirmée : ouvrir (avec fourchette de
// niveau optionnelle, padel) → visible/rejoignable sur /parties ; refermer sans toucher
// aux joueurs déjà inscrits. Ne s'affiche que si l'action a un sens (voir `canOpen`).
export function OpenMatchToggle({ reservation, token, now, onChanged }: {
  reservation: MyReservation;
  token: string;
  now: number;
  onChanged: () => void;
}) {
  const { th } = useTheme();
  const [sheet, setSheet] = useState(false); // feuille d'ouverture dépliée ?
  const [limit, setLimit] = useState(false); // « Limiter le niveau » activé ?
  const [lmin, setLmin] = useState(3);
  const [lmax, setLmax] = useState(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPadel = sportHasLevels(reservation.resource.sport?.key);
  const isPublic = reservation.visibility === 'PUBLIC';
  const future = new Date(reservation.startTime).getTime() > now;
  const spotsLeft = Math.max(0, (reservation.capacity ?? 0) - (reservation.participants?.length ?? 0));
  const canOpen = isPadel && reservation.status === 'CONFIRMED' && future && spotsLeft > 0;

  // Rien à proposer sur une partie déjà commencée (ouvrir n'a plus de sens, et fermer est
  // sans effet — elle est déjà hors de /parties qui filtre startTime > now), ni si ce n'est
  // ni ouvert (→ « Fermer ») ni ouvrable (→ « Ouvrir »).
  if (!future || (!isPublic && !canOpen)) return null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); setSheet(false); onChanged(); }
    catch (e) { setError(msg((e as Error).message)); }
    finally { setBusy(false); }
  };

  const publish = () => run(() => api.setReservationVisibility(
    reservation.id, 'PUBLIC', token,
    limit ? { targetLevelMin: lmin, targetLevelMax: lmax } : { targetLevelMin: null, targetLevelMax: null },
  ));
  const close = () => run(() => api.setReservationVisibility(reservation.id, 'PRIVATE', token));

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/parties/${reservation.id}` : `/parties/${reservation.id}`;

  const switchBtn = (
    <button type="button" role="switch" aria-checked={limit} aria-label="Limiter le niveau"
      onClick={() => setLimit((v) => !v)}
      style={{ width: 40, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', background: limit ? th.accent : th.surface2, position: 'relative', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 3, left: limit ? 19 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
    </button>
  );

  return (
    <div style={{ marginTop: 10 }}>
      {error && (
        <div style={{ marginBottom: 8, background: th.accent, color: th.onAccent, borderRadius: 10, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>{error}</div>
      )}

      {isPublic ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Chip tone="accent">Ouverte</Chip>
          <MatchShareButton url={shareUrl} title={reservation.resource.name} style={{ height: 34 }} />
          <button type="button" onClick={close} disabled={busy}
            style={{ marginLeft: 'auto', border: `1px solid ${th.line}`, background: 'transparent', cursor: busy ? 'not-allowed' : 'pointer', borderRadius: 9, padding: '6px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text }}>
            Fermer
          </button>
        </div>
      ) : !sheet ? (
        <button type="button" onClick={() => setSheet(true)} disabled={busy}
          style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 10, padding: '8px 14px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.text }}>
          Ouvrir aux joueurs du club
        </button>
      ) : (
        <div style={{ border: `1px solid ${th.line}`, borderRadius: 14, padding: 14, background: th.surface }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            {switchBtn}
            <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.text, fontWeight: 600 }}>Limiter le niveau des joueurs</span>
          </label>
          {limit && (
            <div style={{ marginTop: 12 }}>
              <LevelRangeSlider min={lmin} max={lmax} onChange={(a, b) => { setLmin(a); setLmax(b); }} disabled={busy} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
            <button type="button" onClick={publish} disabled={busy}
              style={{ border: 'none', cursor: busy ? 'not-allowed' : 'pointer', borderRadius: 10, padding: '9px 16px', background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700 }}>
              Publier
            </button>
            <button type="button" onClick={() => setSheet(false)} disabled={busy}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontFamily: th.fontUI, fontSize: 13 }}>
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
