'use client';
import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/useAuth';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { dangerBanner } from '@/lib/theme';
import { Field, Btn } from '@/components/ui/atoms';

export default function NewClubByPlatform() {
  const router = useRouter();
  const { th } = useTheme();
  const { token } = useAuth();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [sportKey, setSportKey] = useState('padel');
  const [siret, setSiret] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null); setLoading(true);
    try {
      await api.platformCreateClub({
        club: { name, city: city || undefined, sportKey, siret: siret.trim() || undefined },
        owner: { firstName, lastName, email, password },
      }, token);
      router.push('/superadmin/clubs');
    } catch (err) {
      const m = (err as Error).message;
      setError(m === 'EMAIL_TAKEN' ? 'Cet email gérant est déjà utilisé'
        : m === 'SLUG_TAKEN' ? 'Un club avec ce nom existe déjà'
        : m === 'VALIDATION_ERROR' ? 'Champs manquants ou mot de passe trop court (8 min)'
        : m === 'SIRET_INVALID' ? 'SIRET invalide (14 chiffres)'
        : 'Création impossible');
    } finally { setLoading(false); }
  }

  return (
    <div style={{ maxWidth: 520 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontSize: 28, fontWeight: 700, color: th.text, marginBottom: 20 }}>Créer un club</h1>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && <div style={dangerBanner(th)}>{error}</div>}
        <div style={{ fontSize: 12.5, color: th.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>Club</div>
        <Field label="Nom du club" value={name} onChange={setName} required />
        <Field label="Ville" value={city} onChange={setCity} />
        <Field label="SIRET (optionnel)" value={siret} onChange={setSiret} placeholder="14 chiffres" />
        <Field label="Sport principal (key)" value={sportKey} onChange={setSportKey} />
        <div style={{ fontSize: 12.5, color: th.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 8 }}>Gérant</div>
        <Field label="Prénom" value={firstName} onChange={setFirstName} required />
        <Field label="Nom" value={lastName} onChange={setLastName} required />
        <Field label="Email" type="email" value={email} onChange={setEmail} required autoComplete="off" />
        <Field label="Mot de passe (8 min)" type="password" value={password} onChange={setPassword} required autoComplete="new-password" />
        <Btn type="submit" full disabled={loading}>{loading ? 'Création…' : 'Créer le club'}</Btn>
      </form>
    </div>
  );
}
