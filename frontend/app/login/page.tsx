'use client';
import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { dangerBanner } from '@/lib/theme';
import { useClub } from '@/lib/ClubProvider';
import { finishAuth } from '@/lib/postAuth';
import { AuthShell } from '@/components/auth/AuthShell';
import { Btn, Field } from '@/components/ui/atoms';
import { VerifyCodeForm } from '@/components/VerifyCodeForm';

// Préremplissage du compte seedé en dev/test uniquement — jamais en production.
const DEV_PREFILL = process.env.NODE_ENV !== 'production';

export default function LoginPage() {
  const router = useRouter();
  const { th } = useTheme();
  const { slug } = useClub();
  const nextPath = () => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('next') || undefined : undefined);
  const [email, setEmail] = useState(DEV_PREFILL ? 'test@palova.fr' : '');
  const [password, setPassword] = useState(DEV_PREFILL ? 'password123' : '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verify, setVerify] = useState<{ email: string; devCode?: string } | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403 && data.error === 'EMAIL_NOT_VERIFIED') {
          // Compte non vérifié : (re)déclencher un code et basculer sur l'étape de validation.
          const r = await api.resendCode(data.email).catch(() => null);
          setVerify({ email: data.email, devCode: r?.devCode });
          return;
        }
        setError(data.error === 'RATE_LIMITED'
          ? 'Trop de tentatives. Patientez une minute avant de réessayer.'
          : (data.error || 'Erreur de connexion'));
        return;
      }
      await finishAuth(data, slug, router, nextPath());
    } catch {
      setError('Impossible de contacter le serveur');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title={verify ? undefined : 'Bon retour.'}
      subtitle={verify ? undefined : 'Connectez-vous pour réserver votre prochain créneau.'}
    >
      {verify ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <VerifyCodeForm email={verify.email} devCode={verify.devCode} onVerified={(a) => finishAuth(a, slug, router, nextPath())} />
          <button type="button" onClick={() => setVerify(null)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, padding: '2px 0' }}>
            Retour à la connexion
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div style={dangerBanner(th)}>{error}</div>
          )}
          <Field label="Adresse e-mail" icon="mail" type="email" value={email} onChange={setEmail} required autoComplete="email" />
          <Field label="Mot de passe" icon="lock" type="password" value={password} onChange={setPassword} required autoComplete="current-password" />
          <button type="button" onClick={() => router.push('/forgot-password')}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, color: th.textMute, padding: '2px 0', alignSelf: 'flex-end', textDecoration: 'underline', textUnderlineOffset: 3 }}>
            Mot de passe oublié ?
          </button>
          <div style={{ height: 4 }} />
          <Btn type="submit" full icon="arrowR" disabled={loading}>
            {loading ? 'Connexion…' : 'Se connecter'}
          </Btn>
          <button type="button" onClick={() => router.push('/register')}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 14, color: th.textMute, padding: '6px 0' }}>
            Pas encore de compte ? <span style={{ color: th.text, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 3 }}>Créer un compte</span>
          </button>
          <button type="button" onClick={() => router.push('/clubs/new')}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, color: th.textFaint, padding: '2px 0' }}>
            Vous gérez un club ? <span style={{ color: th.textMute, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 3 }}>Créez-le</span>
          </button>
        </form>
      )}
    </AuthShell>
  );
}
