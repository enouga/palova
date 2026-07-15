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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState<SettingsTabKey>('identite');

  const logoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try {
      setError(null);
      const c = await api.adminGetClub(clubId, token);
      setServer(c);
      setDraft(c);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
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

  const set: SetClubField = (k, v) => setDraft((c) => (c ? { ...c, [k]: v } : c));

  const dirty = !!server && !!draft && isDirty(server, draft);

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
      setError(null);
      await api.adminUpdateClub(clubId, buildUpdateBody(draft), token);
      setServer(draft);           // le brouillon devient la nouvelle baseline → barre disparaît
      refreshClub();              // rafraîchit le club partagé (réservation, tarifs…)
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  const cancel = () => { setDraft(server); setError(null); };

  if (loading || !draft) {
    return <div style={{ fontFamily: th.fontUI, color: th.textFaint, padding: '32px 0' }}>Chargement…</div>;
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: '0 0 20px', color: th.text }}>Réglages du club</h1>

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

      <SaveBar dirty={dirty} saving={saving} error={error} onSave={save} onCancel={cancel} />
    </div>
  );
}
