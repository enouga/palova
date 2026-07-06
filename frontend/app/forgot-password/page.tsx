'use client';
import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useClub } from '@/lib/ClubProvider';
import { finishAuth } from '@/lib/postAuth';
import { AuthShell } from '@/components/auth/AuthShell';
import { Btn, Field } from '@/components/ui/atoms';
import { ResetPasswordForm } from '@/components/ResetPasswordForm';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { th } = useTheme();
  const { slug } = useClub();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Une fois le code demandé, on passe à l'étape de saisie (réponse neutre : on ne révèle rien).
  const [sent, setSent] = useState<{ email: string; devCode?: string } | null>(null);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await api.forgotPassword(email.trim());
      setSent({ email: email.trim(), devCode: r.devCode });
    } catch {
      setError('Impossible de contacter le serveur');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title={sent ? undefined : 'Mot de passe oublié ?'}
      subtitle={sent ? undefined : 'Indiquez votre adresse e-mail : nous vous enverrons un code pour choisir un nouveau mot de passe.'}
    >
      {sent ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, background: th.surface2, borderRadius: 12, padding: '11px 14px', lineHeight: 1.5 }}>
            Si un compte existe avec cet email, un code de réinitialisation vient d’être envoyé.
          </div>
          <ResetPasswordForm email={sent.email} devCode={sent.devCode} onReset={(a) => finishAuth(a, slug, router)} />
          <button type="button" onClick={() => router.push('/login')}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, padding: '2px 0' }}>
            Retour à la connexion
          </button>
        </div>
      ) : (
        <form onSubmit={handleSend} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.onAccent, background: th.accent, padding: '11px 14px', borderRadius: 12, fontWeight: 600 }}>{error}</div>
          )}
          <Field label="Adresse e-mail" icon="mail" type="email" value={email} onChange={setEmail} required autoComplete="email" />
          <div style={{ height: 4 }} />
          <Btn type="submit" full icon="arrowR" disabled={loading}>
            {loading ? 'Envoi…' : 'Envoyer le code'}
          </Btn>
          <button type="button" onClick={() => router.push('/login')}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 14, color: th.textMute, padding: '6px 0' }}>
            Retour à la <span style={{ color: th.text, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 3 }}>connexion</span>
          </button>
        </form>
      )}
    </AuthShell>
  );
}
