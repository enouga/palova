'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, assetUrl, MyClubMembership, MyProfile, MyRating, RatingPoint, Sex, Sport } from '@/lib/api';
import { LevelBadge } from '@/components/player/LevelBadge';
import { LevelCalibration } from '@/components/player/LevelCalibration';
import { LevelSourceNote } from '@/components/player/LevelSourceNote';
import { LevelHistoryChart } from '@/components/player/LevelHistoryChart';
import { useTheme } from '@/lib/ThemeProvider';
import { ThemeMode } from '@/lib/theme';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { Screen } from '@/components/ui/Screen';
import { BackButton, PillTabs, Segmented, ThemeToggle } from '@/components/ui/atoms';
import { DateField } from '@/components/ui/DateField';
import { ProfileMenu } from '@/components/ProfileMenu';
import { ClubNav } from '@/components/ClubNav';
import { ProfileSectionNav, ProfileNavItem } from '@/components/profile/ProfileSectionNav';

const LOCALE_OPTIONS = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
];

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Page profil dédiée : identité + avatar, infos modifiables (tél/naissance/sexe),
// préférences (langue stockée en base, thème local à l'appareil), licence du club courant.
export default function MyProfilePage() {
  const router = useRouter();
  const { th, mode, setMode } = useTheme();
  const { token, ready } = useAuth();
  const { slug, club } = useClub();

  // Hauteur du ClubNav collant : sert d'offset au menu de navigation (0 sur l'hôte plateforme).
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(0);

  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [membership, setMembership] = useState<MyClubMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Formulaire « Informations »
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [sex, setSex] = useState<Sex | null>(null);
  const [savingInfo, setSavingInfo] = useState(false);
  const [savedInfo, setSavedInfo] = useState(false);

  // Avatar
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Niveau padel
  const [rating, setRating] = useState<MyRating | null>(null);
  const [history, setHistory] = useState<RatingPoint[]>([]);
  const [calibrating, setCalibrating] = useState(false);
  const [ratingBusy, setRatingBusy] = useState(false);
  // Sport sélectionné pour la section niveau (distinct du sport préféré identité)
  const [ratingSport, setRatingSport] = useState<string>('padel');

  // Sports disponibles (pour le sélecteur de sport préféré)
  const [sports, setSports] = useState<Sport[]>([]);

  // Préférences & licence
  const [savingLocale, setSavingLocale] = useState(false);
  const [license, setLicense] = useState('');
  const [savingLicense, setSavingLicense] = useState(false);
  const [savedLicense, setSavedLicense] = useState(false);

  // Mot de passe
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [savedPassword, setSavedPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => { if (ready && !token) router.replace('/login'); }, [ready, token, router]);

  useEffect(() => { api.getSports().then(setSports).catch(() => {}); }, []);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) { setHeaderH(0); return; }
    const update = () => setHeaderH(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [slug, club]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        setError(null);
        const p = await api.getMyProfile(token);
        setProfile(p);
        setPhone(p.phone ?? '');
        setBirthDate(p.birthDate ? p.birthDate.slice(0, 10) : '');
        setSex(p.sex);
        if (slug) {
          const m = await api.getMyClubMembership(slug, token).catch(() => null);
          setMembership(m);
          setLicense(m?.membershipNo ?? '');
        }
      } catch (e) { setError((e as Error).message); }
      finally { setLoading(false); }
    })();
  }, [token, slug]);

  // Charger rating + historique quand le token ou le sport du niveau change
  useEffect(() => {
    if (!token) return;
    api.getMyRating(token, ratingSport).then(setRating).catch(() => {});
    api.getRatingHistory(token, ratingSport).then(setHistory).catch(() => {});
    setCalibrating(false);
  }, [token, ratingSport]);

  const saveInfo = async () => {
    if (!token) return;
    setSavingInfo(true); setSavedInfo(false); setError(null);
    try {
      const p = await api.updateMyProfile({ phone: phone.trim() || null, sex, birthDate: birthDate || null }, token);
      setProfile(p);
      setSavedInfo(true);
    } catch (e) { setError((e as Error).message); }
    finally { setSavingInfo(false); }
  };

  const changeLocale = async (locale: string) => {
    if (!token || !profile) return;
    setSavingLocale(true); setError(null);
    setProfile({ ...profile, locale }); // optimiste : le select reflète le choix immédiatement
    try { setProfile(await api.updateMyProfile({ locale }, token)); }
    catch (e) { setError((e as Error).message); }
    finally { setSavingLocale(false); }
  };

  const changeLeaderboard = async (next: boolean) => {
    if (!token || !profile) return;
    setError(null);
    setProfile({ ...profile, showInLeaderboard: next }); // optimiste
    try { setProfile(await api.updateMyProfile({ showInLeaderboard: next }, token)); }
    catch (e) { setError((e as Error).message); }
  };

  const handlePreferredSport = async (id: string) => {
    if (!token) return;
    setError(null);
    try { setProfile(await api.updateMyProfile({ preferredSportId: id || null }, token)); }
    catch (e) { setError((e as Error).message); }
  };

  const saveLicense = async () => {
    if (!token || !slug) return;
    setSavingLicense(true); setSavedLicense(false); setError(null);
    try {
      setMembership(await api.updateMyClubMembership(slug, license.trim(), token));
      setSavedLicense(true);
    } catch (e) { setError((e as Error).message); }
    finally { setSavingLicense(false); }
  };

  const PASSWORD_ERR_FR: Record<string, string> = {
    INVALID_PASSWORD: 'Mot de passe actuel incorrect.',
    SAME_PASSWORD: 'Le nouveau mot de passe doit être différent de l’actuel.',
  };

  const changePassword = async () => {
    if (!token) return;
    setSavedPassword(false); setPasswordError(null);
    if (newPassword.length < 8) { setPasswordError('Le mot de passe doit faire au moins 8 caractères.'); return; }
    if (newPassword !== confirmPassword) { setPasswordError('Les mots de passe ne correspondent pas.'); return; }
    setSavingPassword(true);
    try {
      await api.changePassword(currentPassword, newPassword, token);
      setSavedPassword(true);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (e) {
      const msg = (e as Error).message;
      setPasswordError(PASSWORD_ERR_FR[msg] || msg || 'Une erreur est survenue.');
    }
    finally { setSavingPassword(false); }
  };

  const handleCalibrate = async (selfLevel: number | null) => {
    if (!token) return;
    setRatingBusy(true);
    try {
      const r = await api.calibrateRating(selfLevel, token, ratingSport);
      setRating(r);
      setCalibrating(false);
    } finally {
      setRatingBusy(false);
    }
  };

  const pickAvatar = async (file: File | undefined) => {
    if (!file || !token) return;
    if (!AVATAR_TYPES.includes(file.type)) { setError('Format d’image non supporté (JPEG, PNG ou WebP)'); return; }
    if (file.size > MAX_AVATAR_BYTES) { setError('Image trop lourde (2 Mo max)'); return; }
    setError(null);
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try { setProfile(await api.uploadMyAvatar(file, token)); }
    catch (e) { setError((e as Error).message); setPreview(null); }
    finally { setUploading(false); }
  };

  if (!ready || !token) return null;

  const card: React.CSSProperties = {
    background: th.surface, borderRadius: 20, boxShadow: `inset 0 0 0 1px ${th.line}`,
    padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12,
  };
  const cardTitle: React.CSSProperties = {
    fontFamily: th.fontUI, fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
    textTransform: 'uppercase', color: th.textFaint,
  };
  const label: React.CSSProperties = { fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute };
  const input: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', background: th.surface2, border: `1px solid ${th.line}`,
    borderRadius: 11, padding: '10px 12px', fontFamily: th.fontUI, fontSize: 14, color: th.text,
  };
  const primaryBtn = (busy: boolean): React.CSSProperties => ({
    cursor: 'pointer', border: 'none', background: th.accent, color: th.onAccent, borderRadius: 11,
    padding: '10px 18px', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5, opacity: busy ? 0.6 : 1, alignSelf: 'flex-start',
  });
  const readonlyRow = (l: string, v: string) => (
    <div style={{ display: 'flex', gap: 12, fontFamily: th.fontUI, fontSize: 14 }}>
      <span style={{ color: th.textMute, width: 92, flexShrink: 0 }}>{l}</span>
      <span style={{ color: th.text, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</span>
    </div>
  );

  // Niveau : on ne gère que le padel aujourd'hui. Le sélecteur de sport réapparaîtra
  // quand l'utilisateur aura un niveau sur 2+ sports (à brancher sur un futur signal
  // multi-sport ; tant qu'il n'existe pas, le drapeau reste false).
  const showLevelSportPicker = false;
  const levelSportName = sports.find((s) => s.key === ratingSport)?.name ?? 'Padel'; // repli : le padel est toujours disponible

  // Items du menu = sections réellement rendues (pas d'ancre morte).
  const navItems: ProfileNavItem[] = [
    { id: 'identite', icon: 'user', label: 'Identité' },
    ...(sports.length > 0 ? [{ id: 'sport', icon: 'ball', label: 'Sport' } as ProfileNavItem] : []),
    ...(club?.levelSystemEnabled !== false ? [{ id: 'niveau', icon: 'chart', label: 'Niveau' } as ProfileNavItem] : []),
    { id: 'infos', icon: 'info', label: 'Infos' },
    { id: 'preferences', icon: 'settings', label: 'Préf.' },
    { id: 'securite', icon: 'lock', label: 'Sécu.' },
    ...(slug && club && membership ? [{ id: 'licence', icon: 'ticket', label: 'Licence' } as ProfileNavItem] : []),
  ];

  const avatarSrc = preview ?? assetUrl(profile?.avatarUrl ?? null);
  const initials = profile ? `${profile.firstName[0] ?? ''}${profile.lastName[0] ?? ''}`.toUpperCase() : '…';

  return (
    <Screen>
      <div style={{ paddingBottom: 48 }}>
        {slug && club ? (
          <div ref={headerRef}><ClubNav club={club} /></div>
        ) : (
          <div style={{ padding: '28px 20px 6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <BackButton href="/clubs" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ThemeToggle />
                <ProfileMenu />
              </div>
            </div>
          </div>
        )}

        <div style={{ padding: '18px 20px 0', fontFamily: th.fontDisplay, fontWeight: 500, fontSize: 38, lineHeight: 1.05, color: th.text, letterSpacing: -0.5 }}>
          Mon profil
        </div>

        {error && (
          <div style={{ margin: '14px 20px 0', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.onAccent, background: th.accent, borderRadius: 12, padding: '10px 14px' }}>
            {error}
          </div>
        )}

        {loading || !profile ? (
          <div style={{ padding: '24px 20px', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
        ) : (
          <>
            <ProfileSectionNav items={navItems} topOffset={headerH} />
            <div style={{ padding: '18px 20px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Identité + avatar */}
            <section id="identite" style={{ ...card, scrollMarginTop: 'var(--profile-anchor, 72px)' }} aria-label="Identité">
              <div style={cardTitle}>Identité</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {avatarSrc ? (
                  <img src={avatarSrc} alt="Photo de profil" style={{ width: 84, height: 84, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, opacity: uploading ? 0.5 : 1 }} />
                ) : (
                  <span aria-hidden="true" style={{
                    width: 84, height: 84, borderRadius: '50%', flexShrink: 0, background: th.accent, color: th.onAccent,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, fontWeight: 700, fontSize: 28,
                  }}>{initials}</span>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                    aria-label="Choisir une photo de profil"
                    onChange={(e) => { pickAvatar(e.target.files?.[0]); e.target.value = ''; }} />
                  <button onClick={() => fileRef.current?.click()} disabled={uploading} style={primaryBtn(uploading)}>
                    {uploading ? 'Envoi…' : 'Changer la photo'}
                  </button>
                  <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>JPEG, PNG ou WebP · 2 Mo max</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
                {readonlyRow('Prénom', profile.firstName)}
                {readonlyRow('Nom', profile.lastName)}
                {readonlyRow('Email', profile.email)}
                <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>L’email ne peut pas être modifié.</span>
              </div>
            </section>

            {/* Sport préféré — région dédiée, distincte du niveau par sport */}
            {sports.length > 0 && (
              <section id="sport" style={{ ...card, scrollMarginTop: 'var(--profile-anchor, 72px)' }} aria-label="Sport préféré">
                <div style={cardTitle}>Sport préféré</div>
                <div role="group" aria-label="Sport préféré">
                  <PillTabs
                    options={[{ value: '', label: 'Aucun' }, ...sports.map((s) => ({ value: s.id, label: s.name }))]}
                    value={profile.preferredSport?.id ?? ''}
                    onChange={handlePreferredSport}
                    size="sm"
                  />
                </div>
                <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>Met en avant ce sport dans l'app.</span>
              </section>
            )}

            {/* Niveau — masqué si le club a désactivé le système de niveau */}
            {club?.levelSystemEnabled !== false && (
              <section id="niveau" style={{ ...card, scrollMarginTop: 'var(--profile-anchor, 72px)' }} aria-label="Mon niveau">
                <div style={cardTitle}>Mon niveau · {levelSportName}</div>
                {showLevelSportPicker && sports.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={label}>Sport du niveau</span>
                    <div role="group" aria-label="Sport du niveau">
                      <PillTabs
                        options={sports.map((s) => ({ value: s.key, label: s.name }))}
                        value={ratingSport}
                        onChange={setRatingSport}
                        size="sm"
                      />
                    </div>
                  </div>
                )}
                {rating && !calibrating ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <LevelBadge rating={rating} />
                      <button type="button" onClick={() => setCalibrating(true)}
                        style={{ fontFamily: th.fontUI, fontSize: 13, textDecoration: 'underline', opacity: 0.7, background: 'none', border: 'none', cursor: 'pointer', color: th.text }}>
                        Réévaluer
                      </button>
                    </div>
                    {rating.calibrated && <div style={{ marginTop: 10 }}><LevelHistoryChart points={history} /></div>}
                    <LevelSourceNote style={{ marginTop: 10 }} />
                  </>
                ) : (
                  <LevelCalibration onSelect={(l) => handleCalibrate(l)} onSkip={() => handleCalibrate(null)} busy={ratingBusy} />
                )}
              </section>
            )}

            {/* Informations modifiables */}
            <section id="infos" style={{ ...card, scrollMarginTop: 'var(--profile-anchor, 72px)' }} aria-label="Informations">
              <div style={cardTitle}>Informations</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={label}>Téléphone</span>
                <input value={phone} onChange={(e) => { setPhone(e.target.value); setSavedInfo(false); }} placeholder="06 09 03 26 35" aria-label="Téléphone" style={input} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={label}>Date de naissance</span>
                <DateField value={birthDate} onChange={(d) => { setBirthDate(d); setSavedInfo(false); }} width="100%" ariaLabel="Date de naissance" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={label}>Sexe</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['MALE', 'FEMALE'] as const).map((s) => (
                    <button key={s} onClick={() => { setSex(s); setSavedInfo(false); }}
                      style={{ flex: 1, cursor: 'pointer', borderRadius: 11, padding: '10px', fontFamily: th.fontUI, fontSize: 13.5, border: `1px solid ${sex === s ? th.accent : th.line}`, background: sex === s ? th.surface2 : 'transparent', color: th.text }}>
                      {s === 'MALE' ? 'Homme' : 'Femme'}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button onClick={saveInfo} disabled={savingInfo} style={primaryBtn(savingInfo)}>Enregistrer</button>
                {savedInfo && <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute }}>Enregistré ✓</span>}
              </div>
            </section>

            {/* Préférences */}
            <section id="preferences" style={{ ...card, scrollMarginTop: 'var(--profile-anchor, 72px)' }} aria-label="Préférences">
              <div style={cardTitle}>Préférences</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={label}>Langue</span>
                <select value={profile.locale ?? 'fr'} onChange={(e) => changeLocale(e.target.value)} disabled={savingLocale} aria-label="Langue" style={{ ...input, cursor: 'pointer' }}>
                  {LOCALE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>L’interface reste en français pour l’instant.</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={label}>Thème</span>
                <Segmented<ThemeMode> value={mode} onChange={setMode}
                  options={[{ value: 'daylight', label: 'Clair' }, { value: 'floodlit', label: 'Sombre' }]} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={label}>Apparaître dans les classements</span>
                <Segmented<'oui' | 'non'>
                  value={profile.showInLeaderboard ? 'oui' : 'non'}
                  onChange={(v) => changeLeaderboard(v === 'oui')}
                  options={[{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Non' }]}
                />
              </div>
            </section>

            {/* Mot de passe */}
            <section id="securite" style={{ ...card, scrollMarginTop: 'var(--profile-anchor, 72px)' }} aria-label="Mot de passe">
              <div style={cardTitle}>Mot de passe</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={label}>Mot de passe actuel</span>
                <input type="password" value={currentPassword} autoComplete="current-password"
                  onChange={(e) => { setCurrentPassword(e.target.value); setSavedPassword(false); setPasswordError(null); }}
                  aria-label="Mot de passe actuel" style={input} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={label}>Nouveau mot de passe</span>
                <input type="password" value={newPassword} autoComplete="new-password"
                  onChange={(e) => { setNewPassword(e.target.value); setSavedPassword(false); setPasswordError(null); }}
                  aria-label="Nouveau mot de passe" placeholder="8 caractères minimum" style={input} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={label}>Confirmer le nouveau mot de passe</span>
                <input type="password" value={confirmPassword} autoComplete="new-password"
                  onChange={(e) => { setConfirmPassword(e.target.value); setSavedPassword(false); setPasswordError(null); }}
                  aria-label="Confirmer le nouveau mot de passe" style={input} />
              </div>
              {passwordError && (
                <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.onAccent, background: th.accent, borderRadius: 11, padding: '9px 12px' }}>
                  {passwordError}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button onClick={changePassword} disabled={savingPassword} style={primaryBtn(savingPassword)}>Modifier le mot de passe</button>
                {savedPassword && <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute }}>Modifié ✓</span>}
              </div>
            </section>

            {/* Licence du club courant (uniquement membre, sur un sous-domaine club) */}
            {slug && club && membership && (
              <section id="licence" style={{ ...card, scrollMarginTop: 'var(--profile-anchor, 72px)' }} aria-label="Licence">
                <div style={cardTitle}>Licence · {club.name}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={label}>N° de licence / adhérent</span>
                  <input value={license} onChange={(e) => { setLicense(e.target.value); setSavedLicense(false); }} placeholder="N° de licence / adhérent" aria-label="N° de licence / adhérent" style={input} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button onClick={saveLicense} disabled={savingLicense} style={primaryBtn(savingLicense)}>Enregistrer</button>
                  {savedLicense && <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute }}>Enregistré ✓</span>}
                </div>
              </section>
            )}
            </div>
          </>
        )}
      </div>
    </Screen>
  );
}
