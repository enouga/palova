'use client';
import { useEffect, useState } from 'react';
import { api, AuthResponse } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Field, Btn } from '@/components/ui/atoms';

const ERR_FR: Record<string, string> = {
  CODE_INVALID: 'Code incorrect.',
  CODE_EXPIRED: 'Code expiré — renvoyez-en un nouveau.',
  TOO_MANY_ATTEMPTS: "Trop d'essais. Renvoyez un code.",
  RESEND_COOLDOWN: 'Patientez un instant avant de renvoyer.',
  RATE_LIMITED: 'Trop de tentatives. Patientez une minute avant de réessayer.',
};
function frError(e: unknown): string {
  const m = (e as Error)?.message ?? '';
  return ERR_FR[m] || m || 'Une erreur est survenue.';
}

// Étape « saisie du code + nouveau mot de passe » de la réinitialisation.
// Appelle api.resetPassword puis onReset(auth) (auto-login). Calqué sur VerifyCodeForm.
export function ResetPasswordForm({ email, devCode, onReset }: {
  email: string;
  devCode?: string;
  onReset: (auth: AuthResponse) => void | Promise<void>;
}) {
  const { th } = useTheme();
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(60); // un code vient d'être envoyé
  const [hintCode, setHintCode] = useState<string | undefined>(devCode);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (code.length < 6) { setError('Entrez les 6 chiffres du code.'); return; }
    if (newPassword.length < 8) { setError('Le mot de passe doit faire au moins 8 caractères.'); return; }
    if (newPassword !== confirmPassword) { setError('Les mots de passe ne correspondent pas.'); return; }
    setBusy(true);
    try { await onReset(await api.resetPassword(email, code, newPassword)); }
    catch (err) { setError(frError(err)); }
    finally { setBusy(false); }
  };

  const resend = async () => {
    if (cooldown > 0) return;
    setError(null); setCode('');
    try { const r = await api.forgotPassword(email); setCooldown(60); if (r.devCode) setHintCode(r.devCode); }
    catch (err) { setError(frError(err)); }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 500, fontSize: 30, color: th.text, letterSpacing: -0.5 }}>Nouveau mot de passe.</div>
        <p style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.textMute, marginTop: 10, lineHeight: 1.5 }}>
          Un code à 6 chiffres a été envoyé à <strong style={{ color: th.text }}>{email}</strong>.
        </p>
      </div>

      {error && (
        <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.onAccent, background: th.accent, padding: '11px 14px', borderRadius: 12, fontWeight: 600 }}>{error}</div>
      )}
      {hintCode && (
        <div style={{ fontFamily: th.fontMono, fontSize: 13, color: th.textMute, background: th.surface2, borderRadius: 10, padding: '8px 12px' }}>(dev) code : {hintCode}</div>
      )}

      <Field label="Code de validation" icon="lock" value={code} onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} placeholder="123456" autoComplete="one-time-code" />
      <Field label="Nouveau mot de passe" icon="lock" type="password" value={newPassword} onChange={setNewPassword} placeholder="8 caractères minimum" autoComplete="new-password" />
      <Field label="Confirmer le nouveau mot de passe" icon="lock" type="password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
      <Btn type="submit" full icon="check" disabled={busy}>{busy ? 'Réinitialisation…' : 'Réinitialiser'}</Btn>

      <button type="button" onClick={resend} disabled={cooldown > 0}
        style={{ border: 'none', background: 'transparent', cursor: cooldown > 0 ? 'default' : 'pointer', fontFamily: th.fontUI, fontSize: 14, color: cooldown > 0 ? th.textFaint : th.textMute, padding: '6px 0' }}>
        {cooldown > 0 ? `Renvoyer le code (${cooldown}s)` : (<>Pas reçu ? <span style={{ color: th.text, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 3 }}>Renvoyer le code</span></>)}
      </button>
    </form>
  );
}
