'use client';
import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, AuthResponse, Sport } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { setSession } from '@/lib/session';
import { clubUrl } from '@/lib/clubUrl';
import { AuthShell } from '@/components/auth/AuthShell';
import { Btn, Field, SelectField } from '@/components/ui/atoms';
import { VerifyCodeForm } from '@/components/VerifyCodeForm';

export default function NewClubPage() {
  const router = useRouter();
  const { th } = useTheme();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [clubName, setClubName]   = useState('');
  const [city, setCity]           = useState('');
  const [sports, setSports]       = useState<Sport[]>([]);
  const [sportId, setSportId]     = useState('');
  const [error, setError]         = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const [step, setStep]           = useState<'form' | 'verify'>('form');
  const [pending, setPending]     = useState<{ email: string; devCode?: string } | null>(null);

  useEffect(() => {
    api.getSports().then((s) => { setSports(s); if (s[0]) setSportId(s[0].id); }).catch(() => setSports([]));
  }, []);

  // Après validation du code : le compte gérant est actif → on crée son club et on bascule sur l'admin.
  const finishClub = async (auth: AuthResponse) => {
    try {
      const club = await api.createClub({ name: clubName, city: city || undefined }, auth.token);
      if (sportId) {
        try { await api.adminAddSport(club.id, sportId, auth.token); } catch { /* sport activable plus tard */ }
      }
      setSession(auth.token, club.id);
      window.location.assign(clubUrl(club.slug, '/admin/onboarding'));
    } catch (err) {
      const msg = (err as Error).message;
      throw new Error(
        msg === 'SLUG_TAKEN' ? 'Un club porte déjà ce nom. Essayez une variante.'
        : msg === 'VALIDATION_ERROR' ? 'Champs du club invalides.'
        : msg,
      );
    }
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Mot de passe : 8 caractères minimum.'); return; }
    setLoading(true);
    try {
      const r = await api.register({ email, password, firstName, lastName });
      setPending({ email: r.email, devCode: r.devCode });
      setStep('verify');
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg.includes('déjà utilisé') ? 'Cet email a déjà un compte. Connectez-vous, puis créez votre club.' : msg);
    } finally {
      setLoading(false);
    }
  }

  const onVerify = step === 'verify' && pending;
  const sectionLabel = { fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' as const, color: th.textFaint };

  return (
    <AuthShell
      audience="club"
      title={onVerify ? undefined : "Créez l'espace de votre club."}
      subtitle={onVerify ? undefined : 'Quelques infos et votre club est en ligne. Vous gérez ensuite tout vous-même : sports, terrains, tarifs, réservations.'}
    >
      {onVerify ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <VerifyCodeForm email={pending.email} devCode={pending.devCode} onVerified={finishClub} />
          <button type="button" onClick={() => { setStep('form'); setError(null); }}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, padding: '2px 0' }}>
            Modifier les informations
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.onAccent, background: th.accent, padding: '11px 14px', borderRadius: 12, fontWeight: 600 }}>{error}</div>
          )}

          <div style={{ ...sectionLabel, marginTop: 4 }}>Gérant</div>
          <div style={{ display: 'flex', gap: 12 }}>
            {/* minWidth 0 : sans lui, min-width:auto clampe chaque colonne à la largeur
                intrinsèque de l'input (size=20) → débordement horizontal en mobile. */}
            <div style={{ flex: 1, minWidth: 0 }}><Field label="Prénom" value={firstName} onChange={setFirstName} required autoComplete="given-name" /></div>
            <div style={{ flex: 1, minWidth: 0 }}><Field label="Nom" value={lastName} onChange={setLastName} required autoComplete="family-name" /></div>
          </div>
          <Field label="Adresse e-mail" icon="mail" type="email" value={email} onChange={setEmail} required autoComplete="email" />
          <Field label="Mot de passe (8+ caractères)" icon="lock" type="password" value={password} onChange={setPassword} required autoComplete="new-password" />

          <p style={{ margin: 0, fontFamily: th.fontUI, fontSize: 12.5, lineHeight: 1.55, color: th.textMute }}>
            Ce compte sera le <strong style={{ color: th.text, fontWeight: 700 }}>compte gérant (administrateur)</strong> de
            votre club : lui seul gère l’abonnement Palova et pilote la configuration. Vous pourrez ensuite
            nommer des admins et du staff depuis la page Membres — le staff gère le quotidien sans voir ces informations.
          </p>

          <div style={{ ...sectionLabel, marginTop: 8 }}>Club</div>
          <Field label="Nom du club" icon="pin" value={clubName} onChange={setClubName} required />
          <Field label="Ville" value={city} onChange={setCity} />
          <SelectField label="Sport principal" value={sportId} onChange={setSportId}>
            {sports.map((s) => <option key={s.id} value={s.id}>{s.icon ? `${s.icon} ` : ''}{s.name}</option>)}
          </SelectField>

          <div style={{ height: 4 }} />
          <Btn type="submit" full icon="arrowR" disabled={loading}>
            {loading ? 'Envoi du code…' : 'Créer mon club'}
          </Btn>
          <button type="button" onClick={() => router.push('/login')}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 14, color: th.textMute, padding: '6px 0' }}>
            Vous avez déjà un compte ? <span style={{ color: th.text, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 3 }}>Se connecter</span>
          </button>
        </form>
      )}
    </AuthShell>
  );
}
