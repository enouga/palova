'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { api, ClubAdminDetail } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { PillTabs } from '@/components/ui/atoms';
import {
  SETTINGS_TABS, SettingsTabKey, parseTab, buildUpdateBody, isDirty,
} from '@/lib/adminSettings';
import { SetClubField } from '@/components/admin/settings/shared';
import { SaveBar } from '@/components/admin/settings/SaveBar';
import { SettingsIdentity } from '@/components/admin/settings/SettingsIdentity';
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

  // Deux états : baseline serveur + brouillon édité. Le brouillon est dirty quand il diffère.
  const [server, setServer] = useState<ClubAdminDetail | null>(null);
  const [draft, setDraft] = useState<ClubAdminDetail | null>(null);
  const [saving, setSaving] = useState(false);
  // `error` = chargement/upload (bandeau haut) ; `saveError` = échec d'enregistrement (barre sticky).
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState<SettingsTabKey>('identite');

  const logoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    try {
      setError(null);
      const c = await api.adminGetClub(clubId, token);
      setServer(c);
      setDraft(c);
    } catch (e) { setError((e as Error).message); }
  }, [token, clubId]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

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

  const dirty = !!server && !!draft && isDirty(server, draft);

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
  const pickLogo = async (file: File | undefined) => {
    if (!file || !token || !clubId) return;
    if (!LOGO_TYPES.includes(file.type)) { setError('Format d’image non supporté (JPEG, PNG ou WebP)'); return; }
    if (file.size > MAX_LOGO_BYTES) { setError('Image trop lourde (2 Mo max)'); return; }
    setError(null); setUploading(true);
    try { const res = await api.uploadClubLogo(clubId, file, token); syncImage({ logoUrl: res.logoUrl }); }
    catch (e) { setError((e as Error).message); }
    finally { setUploading(false); }
  };
  const pickCover = async (file: File | undefined) => {
    if (!file || !token || !clubId) return;
    if (!LOGO_TYPES.includes(file.type)) { setError('Format d’image non supporté (JPEG, PNG ou WebP)'); return; }
    if (file.size > MAX_LOGO_BYTES) { setError('Image trop lourde (2 Mo max)'); return; }
    setError(null); setUploading(true);
    try { const res = await api.uploadClubCover(clubId, file, token); syncImage({ coverImageUrl: res.coverImageUrl }); }
    catch (e) { setError((e as Error).message); }
    finally { setUploading(false); }
  };

  const save = async () => {
    if (!token || !clubId || !draft) return;
    setSaving(true);
    try {
      setSaveError(null);
      await api.adminUpdateClub(clubId, buildUpdateBody(draft), token);
      setServer(draft);           // le brouillon devient la nouvelle baseline → barre passe en « Enregistré ✓ »
      setJustSaved(true);
      refreshClub();              // rafraîchit le club partagé (réservation, tarifs…)
    } catch (e) { setSaveError((e as Error).message); }
    finally { setSaving(false); }
  };

  const cancel = () => { setDraft(server); setSaveError(null); setJustSaved(false); };

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
        <SettingsIdentity club={draft} set={set} uploading={uploading}
          logoInputRef={logoInputRef} coverInputRef={coverInputRef} pickLogo={pickLogo} pickCover={pickCover} />
      )}
      {tab === 'reservation' && <SettingsBooking club={draft} set={set} />}
      {tab === 'tarifs' && <SettingsPricing club={draft} set={set} />}
      {tab === 'caisse' && <SettingsCollect club={draft} set={set} />}
      {tab === 'visibilite' && <SettingsVisibility club={draft} set={set} />}

      <SaveBar dirty={dirty} saving={saving} error={saveError} saved={justSaved} onSave={save} onCancel={cancel} />
    </div>
  );
}
