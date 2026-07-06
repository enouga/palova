'use client';
import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, AuthResponse, Sport } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { setSession } from '@/lib/session';
import { useClub } from '@/lib/ClubProvider';
import { safeNext } from '@/lib/postAuth';
import { AuthShell } from '@/components/auth/AuthShell';
import { Btn, Field, SelectField } from '@/components/ui/atoms';
import { VerifyCodeForm } from '@/components/VerifyCodeForm';

export default function RegisterPage() {
  const router = useRouter();
  const { th } = useTheme();
  const { slug } = useClub();
  const nextPath = () => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('next') || undefined : undefined);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [error, setError]         = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const [step, setStep]           = useState<'form' | 'verify'>('form');
  const [pending, setPending]     = useState<{ email: string; devCode?: string } | null>(null);
  const [sports, setSports]       = useState<Sport[]>([]);
  const [preferredSportId, setPreferredSportId] = useState('');

  useEffect(() => {
    api.getSports().then(setSports).catch(() => {});
  }, []);

  // Compte activé après validation du code → ouvre la session et redirige.
  const finish = async (auth: AuthResponse) => {
    setSession(auth.token, null);
    if (slug) await api.joinClub(slug, auth.token).catch(() => {}); // adhésion auto au club du host
    router.push(slug ? (safeNext(nextPath()) || '/') : '/clubs');
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Mot de passe : 8 caractères minimum.'); return; }
    setLoading(true);
    try {
      const r = await api.register({ email, password, firstName, lastName, ...(preferredSportId ? { preferredSportId } : {}) });
      setPending({ email: r.email, devCode: r.devCode });
      setStep('verify');
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg.includes('déjà utilisé') ? 'Cet email a déjà un compte. Connectez-vous.' : msg);
    } finally {
      setLoading(false);
    }
  }

  const onVerify = step === 'verify' && pending;

  return (
    <AuthShell
      title={onVerify ? undefined : 'Créez votre compte joueur.'}
      subtitle={onVerify ? undefined : 'Un seul compte pour réserver dans tous les clubs de la plateforme.'}
    >
      {onVerify ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <VerifyCodeForm email={pending.email} devCode={pending.devCode} onVerified={finish} />
          <button type="button" onClick={() => { setStep('form'); setError(null); }}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, padding: '2px 0' }}>
            Modifier l&apos;adresse e-mail
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.onAccent, background: th.accent, padding: '11px 14px', borderRadius: 12, fontWeight: 600 }}>{error}</div>
          )}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}><Field label="Prénom" value={firstName} onChange={setFirstName} required autoComplete="given-name" /></div>
            <div style={{ flex: 1 }}><Field label="Nom" value={lastName} onChange={setLastName} required autoComplete="family-name" /></div>
          </div>
          <Field label="Adresse e-mail" icon="mail" type="email" value={email} onChange={setEmail} required autoComplete="email" />
          <Field label="Mot de passe (8+ caractères)" icon="lock" type="password" value={password} onChange={setPassword} required autoComplete="new-password" />
          {sports.length > 0 && (
            <SelectField label="Sport préféré (facultatif)" value={preferredSportId} onChange={setPreferredSportId}>
              <option value="">— Aucun —</option>
              {sports.map((s) => <option key={s.id} value={s.id}>{s.icon ? `${s.icon} ` : ''}{s.name}</option>)}
            </SelectField>
          )}
          <div style={{ height: 4 }} />
          <Btn type="submit" full icon="arrowR" disabled={loading}>{loading ? 'Envoi du code…' : 'Créer mon compte'}</Btn>
          <button type="button" onClick={() => router.push('/login')}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 14, color: th.textMute, padding: '6px 0' }}>
            Déjà un compte ? <span style={{ color: th.text, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 3 }}>Se connecter</span>
          </button>
        </form>
      )}
    </AuthShell>
  );
}
