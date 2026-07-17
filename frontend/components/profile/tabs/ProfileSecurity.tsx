'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { DeleteAccountSection } from '@/components/profile/DeleteAccountSection';
import { useProfileStyles } from '@/components/profile/shared';

const PASSWORD_ERR_FR: Record<string, string> = {
  INVALID_PASSWORD: 'Mot de passe actuel incorrect.',
  SAME_PASSWORD: 'Le nouveau mot de passe doit être différent de l’actuel.',
};

// Mot de passe et suppression sont des ACTIONS, pas des champs : elles gardent leur
// bouton et leur feedback propres, hors de la SaveBar (règle de la page).
export function ProfileSecurity({ token }: { token: string }) {
  const { th, card, cardTitle, label, input, primaryBtn } = useProfileStyles();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edit = (fn: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    fn(e.target.value); setSaved(false); setError(null);
  };

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

  return (
    <>
      <section style={card} aria-label="Mot de passe">
        <div style={cardTitle}>Mot de passe</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label}>Mot de passe actuel</span>
          <input type="password" value={currentPassword} autoComplete="current-password"
            onChange={edit(setCurrentPassword)} aria-label="Mot de passe actuel" style={input} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label}>Nouveau mot de passe</span>
          <input type="password" value={newPassword} autoComplete="new-password"
            onChange={edit(setNewPassword)} aria-label="Nouveau mot de passe" placeholder="8 caractères minimum" style={input} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label}>Confirmer le nouveau mot de passe</span>
          <input type="password" value={confirmPassword} autoComplete="new-password"
            onChange={edit(setConfirmPassword)} aria-label="Confirmer le nouveau mot de passe" style={input} />
        </div>
        {error && (
          <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.onAccent, background: th.accent, borderRadius: 11, padding: '9px 12px' }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={changePassword} disabled={saving} style={primaryBtn(saving)}>Modifier le mot de passe</button>
          {saved && <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute }}>Modifié ✓</span>}
        </div>
      </section>

      <section style={card} aria-label="Supprimer mon compte">
        <div style={cardTitle}>Supprimer mon compte</div>
        <DeleteAccountSection token={token} />
      </section>
    </>
  );
}
