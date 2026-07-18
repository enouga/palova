'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { api, ClubAdminDetail, AdminClubSport, Sport } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { dangerBanner } from '@/lib/theme';
import { isClubAdmin, useAdminRole } from '@/lib/adminRole';
import { PillTabs } from '@/components/ui/atoms';
import {
  SETTINGS_TABS, SettingsTabKey, parseTab, buildUpdateBody, isDirty,
  SportsDraftItem, toSportsDraft, addSportDraft, toggleDurationDraft, sportsDirty, buildSportsBatchBody,
} from '@/lib/adminSettings';
import type { LogoWarning } from '@/lib/clubLogos';
import { SetClubField } from '@/components/admin/settings/shared';
import { SaveBar } from '@/components/ui/SaveBar';
import { SettingsIdentity } from '@/components/admin/settings/SettingsIdentity';
import { SettingsSports } from '@/components/admin/settings/SettingsSports';
import { SettingsBooking } from '@/components/admin/settings/SettingsBooking';
import { SettingsPricing } from '@/components/admin/settings/SettingsPricing';
import { SettingsCollect } from '@/components/admin/settings/SettingsCollect';
import { SettingsVisibility } from '@/components/admin/settings/SettingsVisibility';

const LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export default function AdminSettingsPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club: hostClub, refresh: refreshClub } = useClub();
  const clubId = hostClub?.id;
  const admin = isClubAdmin(useAdminRole());

  // Deux états : baseline serveur + brouillon édité. Le brouillon est dirty quand il diffère.
  const [server, setServer] = useState<ClubAdminDetail | null>(null);
  const [draft, setDraft] = useState<ClubAdminDetail | null>(null);
  // Sports (ClubSport) : même principe baseline/brouillon, modèle et endpoint distincts du Club.
  const [sportsServer, setSportsServer] = useState<AdminClubSport[] | null>(null);
  const [sportsDraft, setSportsDraft] = useState<SportsDraftItem[] | null>(null);
  const [sportsCatalog, setSportsCatalog] = useState<Sport[]>([]);
  const [saving, setSaving] = useState(false);
  // `error` = chargement/upload (bandeau haut) ; `saveError` = échec d'enregistrement (barre sticky).
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [uploading, setUploading] = useState<'icon' | 'wide' | 'wide-dark' | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [logoWarnings, setLogoWarnings] = useState<Partial<Record<'icon' | 'wide' | 'wide-dark', LogoWarning>>>({});
  const [tab, setTab] = useState<SettingsTabKey>('identite');

  const coverInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    try {
      setError(null);
      const [c, sports, catalog] = await Promise.all([
        api.adminGetClub(clubId, token),
        api.adminGetSports(clubId, token),
        api.getSports(),
      ]);
      setServer(c);
      setDraft(c);
      setSportsServer(sports);
      setSportsDraft(toSportsDraft(sports));
      setSportsCatalog(catalog);
    } catch (e) { setError((e as Error).message); }
  }, [token, clubId]);

  useEffect(() => { if (ready && token && clubId && admin) load(); }, [ready, token, clubId, admin, load]);

  // Onglet initial depuis l'URL (?tab=), puis reflété à chaque changement.
  useEffect(() => { setTab(parseTab(window.location.search)); }, []);
  const changeTab = (k: SettingsTabKey) => {
    setTab(k);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', k);
    window.history.replaceState(null, '', url.toString());
  };

  // Éditer efface un éventuel échec d'enregistrement et le flash de succès.
  const set: SetClubField = (k, v) => {
    setSaveError(null);
    setJustSaved(false);
    setDraft((c) => (c ? { ...c, [k]: v } : c));
  };

  const addSport = (sportId: string) => {
    setSaveError(null);
    setJustSaved(false);
    setSportsDraft((items) => (items ? addSportDraft(items, sportId) : items));
  };
  const toggleSportDuration = (sportId: string, min: number) => {
    setSaveError(null);
    setJustSaved(false);
    setSportsDraft((items) => {
      if (!items) return items;
      const sport = sportsCatalog.find((s) => s.id === sportId);
      return toggleDurationDraft(items, sportId, sport?.defaultDurationsMin ?? [], min);
    });
  };

  const dirty = !!server && !!draft && !!sportsServer && !!sportsDraft &&
    (isDirty(server, draft) || sportsDirty(sportsServer, sportsDraft));

  // Le flash « Enregistré ✓ » s'efface tout seul après 2,5 s.
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 2500);
    return () => clearTimeout(t);
  }, [justSaved]);

  // Garde beforeunload tant que le brouillon est dirty.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Upload logo/couverture : persiste côté serveur puis synchronise server ET draft
  // (déjà enregistré → ne rend jamais le brouillon dirty).
  const syncImage = (patch: Partial<ClubAdminDetail>) => {
    setServer((c) => (c ? { ...c, ...patch } : c));
    setDraft((c) => (c ? { ...c, ...patch } : c));
  };
  const pickLogo = async (variant: 'icon' | 'wide' | 'wide-dark', file: File) => {
    if (!token || !clubId) return;
    if (!LOGO_TYPES.includes(file.type)) { setError('Format d’image non supporté (JPEG, PNG ou WebP)'); return; }
    if (file.size > MAX_LOGO_BYTES) { setError('Image trop lourde (2 Mo max)'); return; }
    setError(null); setUploading(variant);
    try {
      const res = await api.uploadClubLogo(clubId, file, token, variant);
      const col = variant === 'icon' ? 'logoUrl' : variant === 'wide' ? 'logoWideUrl' : 'logoWideDarkUrl';
      syncImage({ [col]: (res as Record<string, unknown>)[col] } as Partial<ClubAdminDetail>);
      setLogoWarnings((w) => ({ ...w, [variant]: res.warnings?.[0] as LogoWarning | undefined }));
    } catch (e) { setError((e as Error).message); }
    finally { setUploading(null); }
  };
  const deleteLogo = async (variant: 'wide' | 'wide-dark') => {
    if (!token || !clubId) return;
    setUploading(variant);
    try {
      await api.deleteClubLogoVariant(clubId, variant, token);
      const col = variant === 'wide' ? 'logoWideUrl' : 'logoWideDarkUrl';
      syncImage({ [col]: null } as Partial<ClubAdminDetail>);
      setLogoWarnings((w) => ({ ...w, [variant]: undefined }));
    } catch (e) { setError((e as Error).message); }
    finally { setUploading(null); }
  };
  const pickCover = async (file: File | undefined) => {
    if (!file || !token || !clubId) return;
    if (!LOGO_TYPES.includes(file.type)) { setError('Format d’image non supporté (JPEG, PNG ou WebP)'); return; }
    if (file.size > MAX_LOGO_BYTES) { setError('Image trop lourde (2 Mo max)'); return; }
    setError(null); setCoverUploading(true);
    try { const res = await api.uploadClubCover(clubId, file, token); syncImage({ coverImageUrl: res.coverImageUrl }); }
    catch (e) { setError((e as Error).message); }
    finally { setCoverUploading(false); }
  };

  const save = async () => {
    if (!token || !clubId || !server || !draft || !sportsServer || !sportsDraft) return;
    setSaving(true);
    try {
      setSaveError(null);
      const clubIsDirty = isDirty(server, draft);
      const sportsIsDirty = sportsDirty(sportsServer, sportsDraft);
      const errors: string[] = [];
      const tasks: Promise<void>[] = [];

      if (clubIsDirty) {
        tasks.push(
          api.adminUpdateClub(clubId, buildUpdateBody(draft), token).then(() => {
            setServer(draft);   // le brouillon devient la nouvelle baseline
            refreshClub();       // rafraîchit le club partagé (réservation, tarifs…)
          }).catch((e) => { errors.push((e as Error).message); }),
        );
      }
      if (sportsIsDirty) {
        const items = buildSportsBatchBody(sportsServer, sportsDraft);
        tasks.push(
          api.adminApplySportsBatch(clubId, items, token).then((updated) => {
            // Ne JAMAIS écraser `sportsDraft` ici (contrairement au Club, `draft` n'est pas
            // reposé sur `updated`) : un ajout/toggle fait par l'utilisateur pendant que cette
            // requête était en vol serait sinon silencieusement perdu (remplacement intégral du
            // tableau). `updated` ne fait que rafraîchir la baseline pour les prochains diffs.
            setSportsServer(updated);
          }).catch((e) => { errors.push((e as Error).message); }),
        );
      }

      await Promise.all(tasks);
      // Chacun réussit/échoue indépendamment (Club vs ClubSport) : le flash de succès
      // n'apparaît que si tout ce qui a été tenté a réussi.
      if (errors.length > 0) setSaveError(errors.join(' · '));
      else setJustSaved(true);
    } finally { setSaving(false); }
  };

  const cancel = () => {
    setDraft(server);
    setSportsDraft(sportsServer ? toSportsDraft(sportsServer) : null);
    setSaveError(null);
    setJustSaved(false);
  };

  if (!admin) {
    return <div style={{ fontFamily: th.fontUI, color: th.textMute, padding: '32px 0' }}>Cette page est réservée aux administrateurs du club.</div>;
  }

  if (!draft || !sportsDraft) {
    // Pas encore de brouillon (Club ou Sports) : chargement en cours, ou échec (on montre l'erreur).
    return <div style={{ fontFamily: th.fontUI, color: error ? th.text : th.textFaint, padding: '32px 0' }}>{error ?? 'Chargement…'}</div>;
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: '0 0 20px', color: th.text }}>Réglages du club</h1>

      {error && (
        <div style={{ ...dangerBanner(th), marginBottom: 16 }}>{error}</div>
      )}

      <div className="sp-scroll-x" style={{ marginBottom: 20 }}>
        <PillTabs options={SETTINGS_TABS.map((t) => ({ value: t.key, label: t.label }))} value={tab} onChange={changeTab} />
      </div>

      {tab === 'identite' && (
        <SettingsIdentity club={draft} set={set}
          coverUploading={coverUploading} logoUploading={uploading} logoWarnings={logoWarnings}
          onPickLogo={pickLogo} onDeleteLogo={deleteLogo}
          coverInputRef={coverInputRef} pickCover={pickCover} />
      )}
      {tab === 'sports' && (
        <SettingsSports catalog={sportsCatalog} items={sportsDraft} onAdd={addSport} onToggleDuration={toggleSportDuration} />
      )}
      {tab === 'reservation' && <SettingsBooking club={draft} set={set} />}
      {tab === 'tarifs' && <SettingsPricing club={draft} set={set} />}
      {tab === 'caisse' && <SettingsCollect club={draft} set={set} />}
      {tab === 'visibilite' && <SettingsVisibility club={draft} set={set} />}

      <SaveBar dirty={dirty} saving={saving} error={saveError} saved={justSaved} onSave={save} onCancel={cancel} />
    </div>
  );
}
