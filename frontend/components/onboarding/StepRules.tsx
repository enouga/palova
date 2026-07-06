'use client';
import { useState } from 'react';
import { api, ClubAdminDetail } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { inkOn } from '@/lib/theme';
import { BOOKING_PRESETS, CANCEL_PRESETS } from '@/lib/onboarding';
import { WIZ, WizHeader, WizLabel, WizError, WizActions } from './wizardUi';

export function StepRules({ club, clubId, token, onPatched, advance }: {
  club: ClubAdminDetail;
  clubId: string;
  token: string;
  onPatched: (club: ClubAdminDetail) => void;
  advance: () => void;
}) {
  const { th } = useTheme();
  const accent = club.accentColor;
  // null = les valeurs du club ne correspondent à aucun preset (ex. réouverture après réglage custom) :
  // rien n'est pré-marqué et Continuer n'envoie pas ce groupe — valider sans rien toucher = no-op sans danger.
  const [bookingIdx, setBookingIdx] = useState<number | null>(() => {
    const i = BOOKING_PRESETS.findIndex((p) => p.publicDays === club.publicBookingDays && p.memberDays === club.memberBookingDays);
    return i >= 0 ? i : null;
  });
  const [cancelIdx, setCancelIdx] = useState<number | null>(() => {
    const i = CANCEL_PRESETS.findIndex((p) => p.hours === club.cancellationCutoffHours);
    return i >= 0 ? i : null;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const body: { publicBookingDays?: number; memberBookingDays?: number; cancellationCutoffHours?: number } = {};
    if (bookingIdx !== null) {
      const b = BOOKING_PRESETS[bookingIdx];
      body.publicBookingDays = b.publicDays;
      body.memberBookingDays = b.memberDays;
    }
    if (cancelIdx !== null) body.cancellationCutoffHours = CANCEL_PRESETS[cancelIdx].hours;
    if (Object.keys(body).length === 0) { advance(); return; } // rien de sélectionné → rien à écrire
    setBusy(true);
    setError(null);
    try {
      const updated = await api.adminUpdateClub(clubId, body, token);
      onPatched(updated);
      advance();
    } catch { setError('Impossible d’enregistrer. Réessayez.'); }
    finally { setBusy(false); }
  };

  const presetBtn = (active: boolean) => ({
    borderRadius: 12, padding: '10px 16px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700,
    cursor: 'pointer', textAlign: 'left' as const,
    background: active ? accent : WIZ.card,
    color: active ? inkOn(accent) : WIZ.mute,
    border: `1px solid ${active ? accent : WIZ.line}`,
  });

  return (
    <div>
      <WizHeader accent={accent} surtitle={`Règles clés · ${club.name}`}
        title={<>Deux règles,<br />et c’est réglé.</>}
        sub="Le reste (heures creuses, quotas, ouverture des créneaux) vous attend dans Réglages, avec des défauts raisonnables." />

      {error && <WizError>{error}</WizError>}

      <WizLabel>Réserver à l’avance (fenêtre publique)</WizLabel>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {BOOKING_PRESETS.map((p, i) => (
          <button key={p.label} type="button" onClick={() => setBookingIdx(i)} aria-pressed={i === bookingIdx} style={presetBtn(i === bookingIdx)}>
            {p.label}
            <span style={{ display: 'block', fontSize: 11, fontWeight: 600, opacity: 0.75 }}>abonnés : {p.memberDays} j</span>
          </button>
        ))}
      </div>

      <WizLabel>Annulation possible jusqu’à</WizLabel>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {CANCEL_PRESETS.map((p, i) => (
          <button key={p.label} type="button" onClick={() => setCancelIdx(i)} aria-pressed={i === cancelIdx} style={presetBtn(i === cancelIdx)}>
            {p.label}
          </button>
        ))}
      </div>

      <WizActions accent={accent} busy={busy} onNext={save} onSkip={advance} />
    </div>
  );
}
