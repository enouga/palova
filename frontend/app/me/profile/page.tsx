'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api, assetUrl, ClubMatchStats, MyProfile, MyRating, RatingPoint, MemberPackage, Subscription, MyPayment, MyClubMembership, Sport } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { dangerBanner } from '@/lib/theme';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { Screen } from '@/components/ui/Screen';
import { BackButton, ThemeToggle } from '@/components/ui/atoms';
import { SaveBar } from '@/components/ui/SaveBar';
import { ProfileMenu } from '@/components/ProfileMenu';
import { ClubNav } from '@/components/ClubNav';
import { PROFILE_TABS, ProfileTabKey, parseProfileTab, buildProfileBody, isDirty, licenceDirty } from '@/lib/meProfile';
import { SetProfileField } from '@/components/profile/shared';
import { ProfileHero } from '@/components/profile/ProfileHero';
import { ProfileIdentity } from '@/components/profile/tabs/ProfileIdentity';
import { ProfileLevel } from '@/components/profile/tabs/ProfileLevel';
import { ProfilePreferences } from '@/components/profile/tabs/ProfilePreferences';
import { ProfileWallet } from '@/components/profile/tabs/ProfileWallet';
import { ProfileSecurity } from '@/components/profile/tabs/ProfileSecurity';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Page profil en 5 onglets, calquée sur /admin/settings : baseline serveur + brouillon,
// une seule SaveBar sticky couvrant DEUX ressources (profil et licence).
// Règle : tout ce qui est un champ passe par la barre ; ce qui n'est pas un champ
// (photo, mot de passe, suppression, thème) garde son propre chemin.
export default function MyProfilePage() {
  const router = useRouter();
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { slug, club } = useClub();

  // Ressource 1 : le profil.
  const [server, setServer] = useState<MyProfile | null>(null);
  const [draft, setDraft] = useState<MyProfile | null>(null);
  // Ressource 2 : la licence du club courant (endpoint distinct). null = non membre.
  const [licenceServer, setLicenceServer] = useState<string | null>(null);
  const [licenceDraft, setLicenceDraft] = useState<string>('');
  // Adhésion complète (chips du hero) — la licence en est extraite comme 2ᵉ ressource.
  const [membership, setMembership] = useState<MyClubMembership | null>(null);

  const [saving, setSaving] = useState(false);
  // `error` = chargement/upload (bandeau haut) ; `saveError` = échec d'enregistrement (barre).
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ProfileTabKey>('identite');

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const [sports, setSports] = useState<Sport[]>([]);

  // Niveau (lecture + action de calibrage, hors brouillon).
  const [rating, setRating] = useState<MyRating | null>(null);
  const [history, setHistory] = useState<RatingPoint[]>([]);
  const [matchStats, setMatchStats] = useState<ClubMatchStats | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [ratingSport, setRatingSport] = useState('padel');

  // Portefeuille (lecture, hors brouillon).
  const [walletPackages, setWalletPackages] = useState<MemberPackage[]>([]);
  const [walletSubs, setWalletSubs] = useState<Subscription[]>([]);
  const [payments, setPayments] = useState<MyPayment[]>([]);

  useEffect(() => { if (ready && !token) router.replace('/login'); }, [ready, token, router]);
  useEffect(() => { api.getSports().then(setSports).catch(() => {}); }, []);
  useEffect(() => { setTab(parseProfileTab(window.location.search)); }, []);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setError(null);
      const p = await api.getMyProfile(token);
      setServer(p);
      setDraft(p);
      if (slug) {
        const m = await api.getMyClubMembership(slug, token).catch(() => null);
        setMembership(m);
        const lic = m ? (m.membershipNo ?? '') : null;
        setLicenceServer(lic);
        setLicenceDraft(lic ?? '');
        if (m) {
          // Best-effort : ne bloquent jamais le profil.
          api.getMyClubPackages(slug, token).then(setWalletPackages).catch(() => {});
          api.getMyClubSubscriptions(slug, token).then(setWalletSubs).catch(() => {});
          api.getMyPayments(slug, token).then(setPayments).catch(() => {});
        }
      } else {
        setMembership(null);
        setLicenceServer(null);
      }
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, slug]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!token) return;
    api.getMyRating(token, ratingSport).then(setRating).catch(() => {});
    api.getRatingHistory(token, ratingSport).then(setHistory).catch(() => {});
    setCalibrating(false);
  }, [token, ratingSport]);

  useEffect(() => {
    if (!token || !slug) { setMatchStats(null); return; }
    api.getMyClubMatchStats(slug, token, ratingSport).then(setMatchStats).catch(() => setMatchStats(null));
  }, [token, slug, ratingSport]);

  // Éditer efface un échec d'enregistrement et le flash de succès.
  const set: SetProfileField = (k, v) => {
    setSaveError(null); setJustSaved(false);
    setDraft((p) => (p ? { ...p, [k]: v } : p));
  };
  const setLicence = (v: string) => {
    setSaveError(null); setJustSaved(false);
    setLicenceDraft(v);
  };

  const isMember = licenceServer !== null;
  const profileDirty = !!server && !!draft && isDirty(server, draft);
  const licDirty = isMember && licenceDirty(licenceServer, licenceDraft);
  const dirty = profileDirty || licDirty;

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 2500);
    return () => clearTimeout(t);
  }, [justSaved]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const save = async () => {
    if (!token || !server || !draft) return;
    setSaving(true);
    try {
      setSaveError(null);
      const errors: string[] = [];
      const tasks: Promise<void>[] = [];

      if (profileDirty) {
        // ⚠️ Ne repose QUE la baseline : reposer `draft` écraserait une édition
        // faite pendant que la requête était en vol.
        tasks.push(api.updateMyProfile(buildProfileBody(draft), token)
          .then(() => { setServer(draft); })
          .catch((e) => { errors.push((e as Error).message); }));
      }
      if (licDirty && slug) {
        const value = licenceDraft.trim();
        tasks.push(api.updateMyClubMembership(slug, value, token)
          .then(() => { setLicenceServer(value); })
          .catch((e) => { errors.push((e as Error).message); }));
      }

      await Promise.all(tasks);
      // Deux ressources indépendantes : chacune réussit/échoue seule. Le flash de
      // succès n'apparaît que si tout ce qui a été tenté a réussi.
      if (errors.length > 0) setSaveError(errors.join(' · '));
      else setJustSaved(true);
    } finally { setSaving(false); }
  };

  const cancel = () => {
    setDraft(server);
    setLicenceDraft(licenceServer ?? '');
    setSaveError(null);
    setJustSaved(false);
  };

  // Avatar : déjà persisté à l'upload → on patche UNIQUEMENT avatarUrl dans la baseline
  // ET le brouillon. Reposer l'objet entier renvoyé par l'API détruirait le brouillon.
  const pickAvatar = async (file: File | undefined) => {
    if (!file || !token) return;
    if (!AVATAR_TYPES.includes(file.type)) { setError('Format d’image non supporté (JPEG, PNG ou WebP)'); return; }
    if (file.size > MAX_AVATAR_BYTES) { setError('Image trop lourde (2 Mo max)'); return; }
    setError(null);
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const p = await api.uploadMyAvatar(file, token);
      setServer((c) => (c ? { ...c, avatarUrl: p.avatarUrl } : c));
      setDraft((c) => (c ? { ...c, avatarUrl: p.avatarUrl } : c));
    } catch (e) { setError((e as Error).message); setPreview(null); }
    finally { setUploading(false); }
  };

  const handleCalibrate = async (selfLevel: number | null) => {
    if (!token) return;
    setRatingBusy(true);
    try {
      setRating(await api.calibrateRating(selfLevel, token, ratingSport));
      setCalibrating(false);
    } finally { setRatingBusy(false); }
  };

  if (!ready || !token) return null;

  // Onglets réellement rendus — pas d'onglet mort.
  const tabs = PROFILE_TABS.filter((t) => {
    if (t.key === 'niveau') return club?.levelSystemEnabled !== false;
    if (t.key === 'portefeuille') return !!(slug && isMember);
    return true;
  });
  // Un ?tab= visant un onglet absent sur cet hôte retombe sur Identité.
  const activeTab: ProfileTabKey = tabs.some((t) => t.key === tab) ? tab : 'identite';

  const changeTab = (k: ProfileTabKey) => {
    setTab(k);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', k);
    window.history.replaceState(null, '', url.toString());
  };

  const avatarSrc = preview ?? assetUrl(draft?.avatarUrl ?? null);
  const initials = draft ? `${draft.firstName[0] ?? ''}${draft.lastName[0] ?? ''}`.toUpperCase() : '…';

  return (
    <Screen>
      <div style={{ paddingBottom: 48 }}>
        {slug && club ? (
          <ClubNav club={club} />
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

        {error && (
          <div style={{ ...dangerBanner(th), margin: '14px 20px 0' }}>
            {error}
          </div>
        )}

        {loading || !draft ? (
          <div style={{ padding: '24px 20px', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
        ) : (
          <>
            <ProfileHero
              profile={draft}
              avatarSrc={avatarSrc} initials={initials} uploading={uploading}
              fileRef={fileRef} onPickAvatar={pickAvatar}
              kicker={club?.name ?? 'Palova'}
              level={club?.levelSystemEnabled !== false ? (rating?.level ?? null) : null}
              isSubscriber={!!membership?.isSubscriber}
              memberSince={membership?.since ?? null}
              tabs={tabs} activeTab={activeTab} onTab={changeTab}
              compact={activeTab !== 'identite'}
            />
            <div style={{ padding: '16px 20px 0' }}>
              {activeTab === 'identite' && (
                <ProfileIdentity
                  profile={draft} set={set} sports={sports}
                  licence={isMember ? licenceDraft : null} clubName={club?.name ?? null} onLicence={setLicence}
                />
              )}
              {activeTab === 'niveau' && (
                <ProfileLevel
                  sports={sports} ratingSport={ratingSport} onRatingSport={setRatingSport}
                  rating={rating} history={history} matchStats={matchStats} clubName={club?.name ?? null}
                  calibrating={calibrating} ratingBusy={ratingBusy}
                  onStartCalibrate={() => setCalibrating(true)} onCalibrate={handleCalibrate}
                />
              )}
              {activeTab === 'preferences' && <ProfilePreferences profile={draft} set={set} />}
              {activeTab === 'portefeuille' && slug && (
                <ProfileWallet slug={slug} token={token} packages={walletPackages} subscriptions={walletSubs} payments={payments} />
              )}
              {activeTab === 'securite' && <ProfileSecurity token={token} />}

              <SaveBar dirty={dirty} saving={saving} error={saveError} saved={justSaved} onSave={save} onCancel={cancel} />
            </div>
          </>
        )}
      </div>
    </Screen>
  );
}
