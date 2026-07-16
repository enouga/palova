'use client';
import { useState, useEffect, useCallback, useRef, CSSProperties } from 'react';
import { api, ClubPresentation, ClubPhoto, assetUrl } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ClubHouseSectionsCard } from '@/components/admin/ClubHouseSectionsCard';
import { AMENITIES } from '@/lib/clubShowcase';
import { isClubAdmin, useAdminRole } from '@/lib/adminRole';

const MAX_PHOTOS = 12;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Page « Page club » : présentation longue + infos pratiques + galerie photos (max 12),
// affichées sur le Club-house public (teaser) et la page /club.
export default function AdminClubPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;
  const admin = isClubAdmin(useAdminRole());
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pres, setPres] = useState<ClubPresentation | null>(null);
  const [form, setForm] = useState({ presentationText: '', openingHoursText: '', contactPhone: '', contactEmail: '', foundedYear: '', amenities: [] as string[] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ClubPhoto | null>(null);

  const labelStyle: CSSProperties = { fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 6 };
  const inputStyle: CSSProperties = { height: 46, padding: '0 14px', borderRadius: 12, background: th.bg, color: th.text, border: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 15 };
  const card: CSSProperties = { background: th.surface, borderRadius: 18, padding: 18, boxShadow: `inset 0 0 0 1px ${th.line}`, marginBottom: 16 };

  const applyPres = (p: ClubPresentation) => {
    setPres(p);
    setForm({
      presentationText: p.presentationText ?? '',
      openingHoursText: p.openingHoursText ?? '',
      contactPhone: p.contactPhone ?? '',
      contactEmail: p.contactEmail ?? '',
      foundedYear: p.foundedYear != null ? String(p.foundedYear) : '',
      amenities: p.amenities ?? [],
    });
  };

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try { setError(null); applyPres(await api.adminGetPresentation(clubId, token)); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, clubId]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  const save = async () => {
    if (!token || !clubId) return;
    setSaving(true);
    try {
      setError(null);
      setSaved(false);
      applyPres(await api.adminUpdatePresentation(clubId, {
        presentationText: form.presentationText || null,
        openingHoursText: form.openingHoursText || null,
        contactPhone: form.contactPhone || null,
        contactEmail: form.contactEmail || null,
        foundedYear: form.foundedYear ? Number(form.foundedYear) : null,
        amenities: form.amenities,
      }, token));
      setSaved(true);
    } catch (e) { setError((e as Error).message === 'VALIDATION_ERROR' ? 'Année de création invalide' : (e as Error).message); }
    finally { setSaving(false); }
  };

  const toggleAmenity = (key: string) => {
    setSaved(false);
    setForm((f) => ({ ...f, amenities: f.amenities.includes(key) ? f.amenities.filter((k) => k !== key) : [...f.amenities, key] }));
  };

  const photos = pres?.photos ?? [];

  const addPhoto = async (file: File | undefined) => {
    if (!file || !token || !clubId) return;
    if (!PHOTO_TYPES.includes(file.type)) { setError('Format d’image non supporté (JPEG, PNG ou WebP)'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Image trop lourde (5 Mo max)'); return; }
    setUploading(true);
    try {
      setError(null);
      await api.adminAddClubPhoto(clubId, file, undefined, token);
      await load();
    } catch (e) {
      setError((e as Error).message === 'PHOTO_LIMIT_REACHED' ? 'Maximum 12 photos' : (e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const saveCaption = async (p: ClubPhoto, caption: string) => {
    if (!token || !clubId || (p.caption ?? '') === caption) return;
    try { setError(null); await api.adminUpdateClubPhoto(clubId, p.id, { caption: caption || null }, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  // Monte/descend une photo : échange les sortOrder des deux voisines (2 PATCH).
  const move = async (idx: number, dir: -1 | 1) => {
    if (!token || !clubId) return;
    const a = photos[idx], b = photos[idx + dir];
    if (!a || !b) return;
    try {
      setError(null);
      await api.adminUpdateClubPhoto(clubId, a.id, { sortOrder: b.sortOrder }, token);
      await api.adminUpdateClubPhoto(clubId, b.id, { sortOrder: a.sortOrder }, token);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const removePhoto = async (p: ClubPhoto) => {
    if (!token || !clubId) return;
    try { setError(null); await api.adminDeleteClubPhoto(clubId, p.id, token); setConfirmDelete(null); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  if (loading && !pres) {
    return <div style={{ fontFamily: th.fontUI, color: th.textFaint, padding: '32px 0' }}>Chargement…</div>;
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: '0 0 8px', color: th.text }}>Page club</h1>
      <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: '0 0 22px' }}>Présentez votre club aux visiteurs : texte, horaires, contact et galerie photos (Club-house et page « Le club »).</p>

      {error && <div style={{ marginBottom: 16, background: th.accent, color: th.onAccent, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

      <div style={card}>
        <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 20, margin: '0 0 14px', color: th.text }}>Présentation</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={labelStyle}>
            Présentation du club
            <textarea aria-label="Présentation du club" value={form.presentationText} onChange={(e) => { setSaved(false); setForm({ ...form, presentationText: e.target.value }); }}
              placeholder="Racontez votre club : histoire, équipements, ambiance…" rows={6}
              style={{ ...inputStyle, height: 'auto', padding: '12px 14px', resize: 'vertical', lineHeight: 1.5 }} />
          </label>
          <label style={labelStyle}>
            Horaires
            <input value={form.openingHoursText} onChange={(e) => { setSaved(false); setForm({ ...form, openingHoursText: e.target.value }); }} placeholder="Ex. Tous les jours 8h-22h" style={inputStyle} />
          </label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ ...labelStyle, flex: 1, minWidth: 220 }}>
              Téléphone
              <input value={form.contactPhone} onChange={(e) => { setSaved(false); setForm({ ...form, contactPhone: e.target.value }); }} placeholder="05 65 …" type="tel" style={inputStyle} />
            </label>
            <label style={{ ...labelStyle, flex: 1, minWidth: 220 }}>
              Email de contact
              <input value={form.contactEmail} onChange={(e) => { setSaved(false); setForm({ ...form, contactEmail: e.target.value }); }} placeholder="contact@club.fr" type="email" style={inputStyle} />
            </label>
          </div>
          <label style={{ ...labelStyle, maxWidth: 180 }}>
            Année de création
            <input value={form.foundedYear} onChange={(e) => { setSaved(false); setForm({ ...form, foundedYear: e.target.value.replace(/\D/g, '') }); }}
              placeholder="Ex. 2021" inputMode="numeric" aria-label="Année de création" style={inputStyle} />
          </label>
          <div style={labelStyle}>
            Sur place (équipements & services)
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
              {AMENITIES.map((a) => (
                <label key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 11, background: th.bg, border: `1px solid ${th.line}`, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text }}>
                  <input type="checkbox" checked={form.amenities.includes(a.key)} onChange={() => toggleAmenity(a.key)} aria-label={a.label} />
                  <Icon name={a.icon} size={15} color={th.accent} />
                  {a.label}
                </label>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <Btn onClick={save} icon="check" disabled={saving}>{saving ? '…' : 'Enregistrer'}</Btn>
            {saved && <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute }}>✓ Enregistré</span>}
          </div>
        </div>
      </div>

      <div style={card}>
        <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 20, margin: '0 0 4px', color: th.text }}>Galerie ({photos.length}/{MAX_PHOTOS})</h2>
        <p style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, margin: '0 0 14px' }}>Les 3 premières photos apparaissent sur le Club-house ; toutes sur la page « Le club ».</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          {photos.map((p, idx) => (
            <div key={p.id} style={{ background: th.bg, borderRadius: 12, overflow: 'hidden', border: `1px solid ${th.line}` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assetUrl(p.url) ?? ''} alt={p.caption ?? ''} style={{ width: '100%', height: 110, objectFit: 'cover', display: 'block' }} />
              <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input defaultValue={p.caption ?? ''} placeholder="Légende…" aria-label={`Légende de la photo ${idx + 1}`}
                  onBlur={(e) => saveCaption(p, e.target.value.trim())}
                  style={{ ...inputStyle, height: 34, fontSize: 13, padding: '0 10px' }} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => move(idx, -1)} disabled={idx === 0} aria-label="Monter" style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: idx === 0 ? 'default' : 'pointer', borderRadius: 8, padding: '4px 9px', fontFamily: th.fontUI, fontSize: 12.5, color: idx === 0 ? th.textFaint : th.text }}>↑</button>
                  <button onClick={() => move(idx, 1)} disabled={idx === photos.length - 1} aria-label="Descendre" style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: idx === photos.length - 1 ? 'default' : 'pointer', borderRadius: 8, padding: '4px 9px', fontFamily: th.fontUI, fontSize: 12.5, color: idx === photos.length - 1 ? th.textFaint : th.text }}>↓</button>
                  <button onClick={() => setConfirmDelete(p)} style={{ marginLeft: 'auto', border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 8, padding: '4px 9px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: '#ff7a4d' }}>Supprimer</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 14 }}>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Ajouter une photo"
            disabled={uploading || photos.length >= MAX_PHOTOS}
            onChange={(e) => addPhoto(e.target.files?.[0])}
            style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.text }} />
          {photos.length >= MAX_PHOTOS && <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 6 }}>Maximum {MAX_PHOTOS} photos — supprimez-en une pour en ajouter.</div>}
          {uploading && <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 6 }}>Envoi…</div>}
        </div>
      </div>

      {admin && token && clubId && <ClubHouseSectionsCard clubId={clubId} token={token} />}

      {confirmDelete && (
        <ConfirmDialog
          title="Supprimer la photo ?"
          message="La photo sera retirée de la galerie et son fichier supprimé."
          confirmLabel="Supprimer"
          cancelLabel="Retour"
          onConfirm={() => removePhoto(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
