'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { api, ClubAdminDetail, Sport } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { isClubAdmin, useAdminRole } from '@/lib/adminRole';
import { PillTabs } from '@/components/ui/atoms';
import {
  SETTINGS_TABS, SettingsTabKey, parseTab, buildUpdateBody, isDirty,
} from '@/lib/adminSettings';
import {
  SportDraftRow, sportsDraftFrom, addSportToDraft, toggleDurationInDraft, sportsDiff, sportsDirty,
  sameDurations,
} from '@/lib/adminSports';
import { effectiveDurations } from '@/lib/duration';
import type { LogoWarning } from '@/lib/clubLogos';
import { SetClubField } from '@/components/admin/settings/shared';
import { SaveBar } from '@/components/admin/settings/SaveBar';
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
  // Même modèle pour l'onglet Sports, sur son propre modèle (ClubSport) : baseline + brouillon.
  const [sportsServer, setSportsServer] = useState<SportDraftRow[]>([]);
  const [sportsDraft, setSportsDraft] = useState<SportDraftRow[]>([]);
  const [catalog, setCatalog] = useState<Sport[]>([]);
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
      const [c, enabled, cat] = await Promise.all([
        api.adminGetClub(clubId, token),
        api.adminGetSports(clubId, token),
        api.getSports(),
      ]);
      setServer(c);
      setDraft(c);
      const rows = sportsDraftFrom(enabled);
      setSportsServer(rows);
      setSportsDraft(rows);
      setCatalog(cat);
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
  const touch = () => { setSaveError(null); setJustSaved(false); };
  const set: SetClubField = (k, v) => {
    touch();
    setDraft((c) => (c ? { ...c, [k]: v } : c));
  };
  const addSport = (s: Sport) => { touch(); setSportsDraft((d) => addSportToDraft(d, s)); };
  const toggleSportDuration = (sportId: string, min: number) => {
    touch();
    setSportsDraft((d) => toggleDurationInDraft(d, sportId, min));
  };

  const clubDirty = !!server && !!draft && isDirty(server, draft);
  const dirty = clubDirty || sportsDirty(sportsServer, sportsDraft);

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

  // Recharge la baseline Sports depuis le serveur (les créations rendent leur id).
  const reloadSports = useCallback(async () => {
    if (!token || !clubId) return;
    const rows = sportsDraftFrom(await api.adminGetSports(clubId, token));
    setSportsServer(rows);
    setSportsDraft(rows);
  }, [token, clubId]);

  // Sports = entités distinctes : on rejoue le diff en requêtes. Un sport ajouté naît
  // avec les durées par défaut de son sport → on ne le PATCH que si le club a choisi autre chose.
  const flushSports = async () => {
    if (!token || !clubId) return;
    const { toAdd, toUpdate } = sportsDiff(sportsServer, sportsDraft);
    for (const a of toAdd) {
      const created = await api.adminAddSport(clubId, a.sportId, token);
      const born = effectiveDurations(created.durationsMin, created.sport.defaultDurationsMin);
      if (!sameDurations(born, a.durationsMin)) {
        await api.adminUpdateClubSport(clubId, created.id, a.durationsMin, token);
      }
    }
    for (const u of toUpdate) {
      await api.adminUpdateClubSport(clubId, u.clubSportId, u.durationsMin, token);
    }
  };

  const save = async () => {
    if (!token || !clubId || !draft || !server) return;
    setSaving(true);
    try {
      setSaveError(null);
      if (clubDirty) {
        await api.adminUpdateClub(clubId, buildUpdateBody(draft), token);
        setServer(draft);         // le brouillon devient la nouvelle baseline → barre passe en « Enregistré ✓ »
      }
      if (sportsDirty(sportsServer, sportsDraft)) {
        await flushSports();
        await reloadSports();     // baseline Sports = ce que le serveur a vraiment retenu
      }
      setJustSaved(true);
      refreshClub();              // rafraîchit le club partagé (réservation, tarifs…)
    } catch (e) {
      setSaveError((e as Error).message);
      // Un flush partiel a pu créer des sports : on resynchronise pour ne pas les recréer au réessai.
      await reloadSports().catch(() => {});
    }
    finally { setSaving(false); }
  };

  const cancel = () => { setDraft(server); setSportsDraft(sportsServer); setSaveError(null); setJustSaved(false); };

  if (!admin) {
    return <div style={{ fontFamily: th.fontUI, color: th.textMute, padding: '32px 0' }}>Cette page est réservée aux administrateurs du club.</div>;
  }

  if (!draft) {
    // Pas encore de brouillon : chargement en cours, ou échec de chargement (on montre l'erreur).
    return <div style={{ fontFamily: th.fontUI, color: error ? th.text : th.textFaint, padding: '32px 0' }}>{error ?? 'Chargement…'}</div>;
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: '0 0 20px', color: th.text }}>Réglages du club</h1>

      {error && (
        <div style={{ marginBottom: 16, background: th.accent, color: th.onAccent, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>
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
        <SettingsSports rows={sportsDraft} catalog={catalog} onAdd={addSport} onToggleDuration={toggleSportDuration} />
      )}
      {tab === 'reservation' && <SettingsBooking club={draft} set={set} />}
      {tab === 'tarifs' && <SettingsPricing club={draft} set={set} />}
      {tab === 'caisse' && <SettingsCollect club={draft} set={set} />}
      {tab === 'visibilite' && <SettingsVisibility club={draft} set={set} />}

      <SaveBar dirty={dirty} saving={saving} error={saveError} saved={justSaved} onSave={save} onCancel={cancel} />
    </div>
  );
}
