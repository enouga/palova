'use client';
import { useEffect, useRef, useState } from 'react';
import { api, MyReservation } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { dangerBanner } from '@/lib/theme';
import { sportHasLevels } from '@/lib/level';
import { loadLevelPref, saveLevelPref } from '@/lib/levelPrefs';
import { useLevelSystemEnabled } from '@/lib/useLevelSystem';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { Icon } from '@/components/ui/Icon';
import { LevelRangeSlider } from '@/components/player/LevelRangeSlider';

const ERR: Record<string, string> = {
  UNAUTHORIZED: "Seul l'organisateur peut ouvrir cette partie.",
  RESERVATION_NOT_ACTIVE: "Cette réservation n'est pas ouvrable.",
  RESERVATION_IN_PAST: 'Trop tard pour ouvrir cette partie.',
  OPEN_MATCH_PADEL_ONLY: 'Seules les parties de padel peuvent être ouvertes.',
};
const msg = (e: string) => ERR[e] ?? e;

/**
 * Bascule rapide « Partie ouverte aux membres » sur l'écran de succès de réservation :
 * reprend l'UI de l'ancien interrupteur pré-confirmation de BookingModal, mais appelle
 * l'API post-confirmation (setReservationVisibility) puisque la résa est déjà CONFIRMED.
 * Une fois ouverte, la fourchette de niveau reste réglable ici (LevelRangeSlider) — chaque
 * ajustement republie en direct (débouncé) et mémorise la préférence, comme OpenMatchToggle.
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
  const [competitive, setCompetitive] = useState(reservation.competitive ?? true);
  // Passe à `true` seulement sur une interaction manuelle du switch « Limiter » / du curseur —
  // jamais depuis le préchargement — pour que l'effet de republication ci-dessous ne se
  // déclenche jamais tout seul (préférence rechargée, résa déjà publique au montage…).
  const touchedRef = useRef(false);

  const openMatch = reservation.visibility === 'PUBLIC';

  // Préremplissage de la fourchette de niveau : si la résa est déjà publique, on reprend son
  // état réel (source de vérité serveur) ; sinon dernier choix mémorisé, sinon défaut centré
  // sur le niveau du joueur ±1 (borné 1–8).
  useEffect(() => {
    if (!isPadel || !levelForSport) return;
    if (reservation.visibility === 'PUBLIC') {
      const hasRange = reservation.targetLevelMin != null && reservation.targetLevelMax != null;
      setLevelLimited(hasRange);
      if (hasRange) { setLevelMin(reservation.targetLevelMin as number); setLevelMax(reservation.targetLevelMax as number); }
      return;
    }
    const clamp = (v: number) => Math.max(1, Math.min(8, Math.round(v * 10) / 10));
    const pref = loadLevelPref();
    if (pref) { setLevelLimited(pref.enabled); setLevelMin(pref.min); setLevelMax(pref.max); return; }
    api.getMyRating(token, sportKey).then((r) => {
      const lvl = r?.level ?? null;
      if (lvl != null) { setLevelMin(clamp(lvl - 1)); setLevelMax(clamp(lvl + 1)); }
    }).catch(() => {});
  }, [isPadel, levelForSport, token, sportKey, reservation.visibility]); // eslint-disable-line react-hooks/exhaustive-deps

  // Republication en direct d'un ajustement manuel (partie déjà ouverte) : débouncée pour ne
  // pas spammer l'API pendant le glissement du curseur.
  const debLimited = useDebouncedValue(levelLimited, 400);
  const debMin = useDebouncedValue(levelMin, 400);
  const debMax = useDebouncedValue(levelMax, 400);
  useEffect(() => {
    if (!touchedRef.current || !openMatch || !levelForSport) return;
    saveLevelPref({ enabled: debLimited, min: debMin, max: debMax });
    setBusy(true);
    setError(null);
    api.setReservationVisibility(reservation.id, 'PUBLIC', token, {
      targetLevelMin: debLimited ? debMin : null,
      targetLevelMax: debLimited ? debMax : null,
    }).then(() => onChanged())
      .catch((e) => setError(msg((e as Error).message)))
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debLimited, debMin, debMax]);

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
        saveLevelPref({ enabled: limiting, min: levelMin, max: levelMax });
        await api.setReservationVisibility(reservation.id, 'PUBLIC', token, {
          targetLevelMin: limiting ? levelMin : null,
          targetLevelMax: limiting ? levelMax : null,
        });
      }
      onChanged();
      // Le compteur de parties ouvertes de ClubNav (onglet Parties) ne se rafraîchit que sur
      // notification SSE ou changement de route — une ouverture/fermeture par soi-même n'en
      // déclenche aucun, d'où ce signal local explicite.
      window.dispatchEvent(new Event('palova:openmatch-unread'));
    } catch (e) {
      setError(msg((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const toggleLimit = () => { touchedRef.current = true; setLevelLimited((v) => !v); };
  const onRangeChange = (a: number, b: number) => { touchedRef.current = true; setLevelMin(a); setLevelMax(b); };

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

      {!openMatch ? (
        <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, marginTop: 6, lineHeight: 1.4 }}>Réservation privée.</div>
      ) : !levelForSport ? (
        <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, marginTop: 6, lineHeight: 1.4 }}>Visible et rejoignable par les membres du club.</div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, fontWeight: 600 }}>Limiter le niveau des joueurs</span>
            <button type="button" role="switch" aria-checked={levelLimited} aria-label="Limiter le niveau"
              disabled={busy} onClick={toggleLimit}
              style={{ width: 40, height: 24, borderRadius: 999, border: 'none', cursor: busy ? 'not-allowed' : 'pointer', background: levelLimited ? th.accent : th.lineStrong, position: 'relative', flexShrink: 0, opacity: busy ? 0.6 : 1 }}>
              <span style={{ position: 'absolute', top: 3, left: levelLimited ? 19 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
            </button>
          </div>
          {levelLimited ? (
            <div style={{ marginTop: 12 }}>
              <LevelRangeSlider min={levelMin} max={levelMax} onChange={onRangeChange} disabled={busy} />
            </div>
          ) : (
            <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, marginTop: 6, lineHeight: 1.4 }}>Ouverte à tous les niveaux.</div>
          )}
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            {([['competitive', 'Pour de vrai', 'Le résultat compte pour le niveau'],
               ['friendly', 'Pour le fun', 'Le niveau ne bouge pas']] as const).map(([key, label, sub]) => {
              const active = (key === 'competitive') === competitive;
              return (
                <button key={key} type="button" disabled={busy}
                  onClick={() => {
                    const next = key === 'competitive';
                    setCompetitive(next);
                    setBusy(true); setError(null);
                    api.setReservationVisibility(reservation.id, 'PUBLIC', token, {
                      targetLevelMin: levelLimited ? levelMin : null,
                      targetLevelMax: levelLimited ? levelMax : null,
                      competitive: next,
                    }).then(() => onChanged()).catch((e) => setError(msg((e as Error).message))).finally(() => setBusy(false));
                  }}
                  style={{ flex: 1, textAlign: 'left', cursor: busy ? 'not-allowed' : 'pointer', borderRadius: 12,
                    padding: '9px 12px', border: `1.5px solid ${active ? th.accent : th.line}`,
                    background: active ? `${th.accent}14` : 'transparent', opacity: busy ? 0.6 : 1 }}>
                  <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: active ? th.accent : th.text }}>{label}</div>
                  <div style={{ fontFamily: th.fontUI, fontSize: 10.5, color: th.textFaint, marginTop: 2, lineHeight: 1.3 }}>{sub}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <div style={{ ...dangerBanner(th), marginTop: 8 }}>{error}</div>
      )}
    </div>
  );
}
