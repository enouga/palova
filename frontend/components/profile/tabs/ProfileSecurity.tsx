'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { ACCENTS, inkOn } from '@/lib/theme';
import { CardKicker } from '@/components/profile/CardKicker';
import { ProfileInput } from '@/components/profile/ProfileFields';
import { DeleteAccountSection } from '@/components/profile/DeleteAccountSection';
import { useProfileStyles } from '@/components/profile/shared';

const PASSWORD_ERR_FR: Record<string, string> = {
  INVALID_PASSWORD: 'Mot de passe actuel incorrect.',
  SAME_PASSWORD: 'Le nouveau mot de passe doit être différent de l’actuel.',
};

// Mot de passe et suppression sont des ACTIONS, pas des champs : elles gardent leur
// bouton et leur feedback propres, hors de la SaveBar (règle de la page).
export function ProfileSecurity({ token }: { token: string }) {
  const { th, card, primaryBtn } = useProfileStyles();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // ProfileInput livre la valeur, pas l'évènement.
  const edit = (fn: (v: string) => void) => (v: string) => { fn(v); setSaved(false); setError(null); };

  const changePassword = async () => {
    setSaved(false); setError(null);
    if (newPassword.length < 8) { setError('Le mot de passe doit faire au moins 8 caractères.'); return; }
    if (newPassword !== confirmPassword) { setError('Les mots de passe ne correspondent pas.'); return; }
    setSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword, token);
      setSaved(true);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (e) {
      const msg = (e as Error).message;
      setError(PASSWORD_ERR_FR[msg] || msg || 'Une erreur est survenue.');
    } finally { setSaving(false); }
  };

  const downloadExport = async () => {
    setExporting(true); setExportError(null);
    try {
      const data = await api.exportMyData(token);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'palova-mes-donnees.json'; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError((e as Error).message === 'RATE_LIMITED'
        ? 'Un export a déjà été généré il y a moins d\'une heure. Réessayez plus tard.'
        : 'L\'export a échoué. Réessayez.');
    } finally { setExporting(false); }
  };

  return (
    <>
      <section style={card} aria-label="Mot de passe">
        <CardKicker>Mot de passe</CardKicker>
        <ProfileInput label="Mot de passe actuel" type="password" autoComplete="current-password"
          value={currentPassword} onChange={edit(setCurrentPassword)} />
        <ProfileInput label="Nouveau mot de passe" type="password" autoComplete="new-password"
          value={newPassword} onChange={edit(setNewPassword)} placeholder="8 caractères minimum" />
        <ProfileInput label="Confirmer le nouveau mot de passe" type="password" autoComplete="new-password"
          value={confirmPassword} onChange={edit(setConfirmPassword)} />
        {error && (
          <div style={{
            fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: inkOn(ACCENTS.coral),
            background: ACCENTS.coral, borderRadius: 11, padding: '9px 12px',
          }}>{error}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={changePassword} disabled={saving} style={primaryBtn(saving)}>Modifier le mot de passe</button>
          {saved && <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute }}>Modifié ✓</span>}
        </div>
      </section>

      <section style={card} aria-label="Mes données">
        <CardKicker>Mes données</CardKicker>
        <p style={{ margin: 0, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, lineHeight: 1.55 }}>
          Téléchargez une copie de vos données personnelles (profil, réservations, inscriptions,
          paiements, messages envoyés) au format JSON — droit à la portabilité (RGPD).
        </p>
        {exportError && (
          <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: inkOn(ACCENTS.coral), background: ACCENTS.coral, borderRadius: 11, padding: '9px 12px' }}>{exportError}</div>
        )}
        <button onClick={downloadExport} disabled={exporting} style={primaryBtn(exporting)}>
          {exporting ? 'Préparation…' : 'Télécharger mes données'}
        </button>
      </section>

      <section style={card} aria-label="Supprimer mon compte">
        <CardKicker tone="coral">Zone sensible</CardKicker>
        <DeleteAccountSection token={token} />
      </section>
    </>
  );
}
