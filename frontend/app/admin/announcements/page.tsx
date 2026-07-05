'use client';
import { useState, useEffect, useCallback, useRef, CSSProperties } from 'react';
import { api, Announcement, AnnouncementBody, AnnouncementKind, assetUrl } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn, Chip } from '@/components/ui/atoms';

const EMPTY = { title: '', body: '', linkUrl: '', kind: 'INFO' as AnnouncementKind, validUntil: '', pinned: false, isPublished: true };

const KIND_LABEL: Record<AnnouncementKind, string> = { INFO: 'Info', OFFER: 'Offre', TOURNAMENT: 'Tournoi', EVENT: 'Event' };

export default function AdminAnnouncementsPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;
  const [items, setItems]     = useState<Announcement[]>([]);
  const [form, setForm]       = useState(EMPTY);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [editId, setEditId]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const cell: CSSProperties = { padding: '12px 16px', fontFamily: th.fontUI, fontSize: 14, color: th.text };
  const labelStyle: CSSProperties = { fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 6 };
  const inputStyle: CSSProperties = { height: 46, padding: '0 14px', borderRadius: 12, background: th.bg, color: th.text, border: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 15 };
  const checkboxLabel: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text, cursor: 'pointer' };
  const miniBtn: CSSProperties = { border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '7px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text };

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try { setError(null); setItems(await api.adminGetAnnouncements(clubId, token)); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, clubId]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  // Aperçu local du fichier choisi (jsdom/vieux navigateurs sans createObjectURL → repli nom de fichier).
  useEffect(() => {
    if (!imageFile || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(imageFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const resetForm = () => {
    setForm(EMPTY); setEditId(null); setImageFile(null); setRemoveImage(false); setFormError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Image affichée dans le formulaire : le fichier fraîchement choisi prime sur l'affiche existante.
  const currentImageUrl = editId ? (items.find((i) => i.id === editId)?.imageUrl ?? null) : null;
  const shownImage = previewUrl ?? (!removeImage && currentImageUrl ? assetUrl(currentImageUrl) : null);
  const hasImage = Boolean(imageFile || (!removeImage && currentImageUrl));

  const pickFile = () => fileInputRef.current?.click();

  const clearImage = () => {
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (imageFile) { setImageFile(null); return; }
    if (currentImageUrl) setRemoveImage(true);
  };

  const submit = async () => {
    if (!token || !clubId || saving) return;
    if (!form.title.trim() || !form.body.trim()) {
      setFormError('Le titre et le contenu sont obligatoires.');
      return;
    }
    setSaving(true);
    setFormError(null);
    const body: AnnouncementBody = {
      title: form.title.trim(),
      body: form.body.trim(),
      linkUrl: form.linkUrl.trim() || undefined,
      kind: form.kind,
      validUntil: form.validUntil || null,
      pinned: form.pinned,
      isPublished: form.isPublished,
      ...(editId && removeImage && !imageFile ? { imageUrl: null } : {}),
    };
    let saved: Announcement;
    try {
      saved = editId
        ? await api.adminUpdateAnnouncement(clubId, editId, body, token)
        : await api.adminCreateAnnouncement(clubId, body, token);
    } catch (e) {
      setFormError((e as Error).message);
      setSaving(false);
      return;
    }
    try {
      if (imageFile) await api.adminUploadAnnouncementImage(clubId, saved.id, imageFile, token);
      resetForm();
    } catch (e) {
      // L'annonce est déjà enregistrée : on bascule en mode édition pour qu'un
      // nouveau clic mette à jour au lieu de créer un doublon.
      setEditId(saved.id);
      setFormError(`L'annonce est enregistrée, mais l'envoi de l'image a échoué (${(e as Error).message}). Réessayez.`);
    } finally {
      setSaving(false);
      await load();
    }
  };

  const startEdit = (a: Announcement) => {
    setEditId(a.id);
    setImageFile(null);
    setRemoveImage(false);
    setFormError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setForm({
      title: a.title, body: a.body, linkUrl: a.linkUrl ?? '',
      kind: a.kind ?? 'INFO', validUntil: a.validUntil ? a.validUntil.slice(0, 10) : '',
      pinned: a.pinned, isPublished: a.isPublished,
    });
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const remove = async (a: Announcement) => {
    if (!token || !clubId) return;
    try { setError(null); await api.adminDeleteAnnouncement(clubId, a.id, token); if (editId === a.id) resetForm(); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: '0 0 8px', color: th.text }}>Annonces</h1>
      <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: '0 0 22px' }}>Publiez des actualités visibles par les joueurs sur la page du club.</p>

      {error && <div style={{ marginBottom: 16, background: th.accent, color: th.onAccent, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

      <div style={{ background: th.surface, borderRadius: 18, padding: 18, boxShadow: `inset 0 0 0 1px ${th.line}`, marginBottom: 16 }}>
        <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 20, margin: '0 0 14px', color: th.text }}>{editId ? "Modifier l'annonce" : 'Nouvelle annonce'}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={labelStyle}>
            Titre *
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Titre de l'annonce" style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Contenu *
            <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Détail de l'annonce…" rows={4}
              style={{ ...inputStyle, height: 'auto', padding: '12px 14px', resize: 'vertical', lineHeight: 1.5 }} />
          </label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ ...labelStyle, flex: 1, minWidth: 160 }}>
              Type
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as AnnouncementKind })} style={{ ...inputStyle, cursor: 'pointer' }}>
                {(Object.keys(KIND_LABEL) as AnnouncementKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </label>
            <label style={{ ...labelStyle, flex: 1, minWidth: 160 }}>
              Afficher jusqu'au
              <input value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} type="date" style={inputStyle} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ ...labelStyle, flex: 1, minWidth: 220 }}>
              Lien (optionnel)
              <input value={form.linkUrl} onChange={(e) => setForm({ ...form, linkUrl: e.target.value })} placeholder="https://…" type="url" style={inputStyle} />
            </label>
            <div style={{ ...labelStyle, flex: 1, minWidth: 220 }}>
              Affiche (image)
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Affiche (image)"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0] ?? null; if (f) { setImageFile(f); setRemoveImage(false); } }} />
              {shownImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shownImage} alt="Aperçu de l'affiche" style={{ width: 120, height: 68, objectFit: 'cover', borderRadius: 8 }} />
              )}
              {!shownImage && imageFile && (
                <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.text, fontWeight: 600 }}>{imageFile.name}</span>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={pickFile} style={miniBtn}>{hasImage ? "Changer l'image" : 'Ajouter une image'}</button>
                {hasImage && <button type="button" onClick={clearImage} style={{ ...miniBtn, color: '#ff7a4d' }}>Retirer l'image</button>}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 2 }}>
            <label style={checkboxLabel}>
              <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} style={{ width: 18, height: 18, accentColor: th.accent }} />
              Épinglée
            </label>
            <label style={checkboxLabel}>
              <input type="checkbox" checked={form.isPublished} onChange={(e) => setForm({ ...form, isPublished: e.target.checked })} style={{ width: 18, height: 18, accentColor: th.accent }} />
              Publiée
            </label>
          </div>
          {formError && (
            <div role="alert" style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: '#ff7a4d' }}>{formError}</div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <Btn onClick={submit} icon={editId ? 'check' : 'plus'} disabled={saving}>{saving ? '…' : editId ? 'Enregistrer' : 'Publier'}</Btn>
            {editId && <Btn variant="ghost" onClick={resetForm} disabled={saving}>Annuler</Btn>}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '32px 0', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
      ) : (
        // Liste (pas une table) : les actions restent toujours visibles quelle que soit la
        // largeur — l'ancienne table débordait du conteneur 720px et cachait Modifier/Supprimer
        // derrière un scroll horizontal.
        <div style={{ borderRadius: 18, background: th.surface, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
          {items.length === 0 && (
            <div style={{ ...cell, textAlign: 'center', color: th.textFaint, padding: '28px 16px' }}>Aucune annonce pour l'instant.</div>
          )}
          {items.map((a, i) => (
            <div key={a.id} style={{
              display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px',
              padding: '13px 16px', borderTop: i > 0 ? `1px solid ${th.line}` : 'none',
            }}>
              {a.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={assetUrl(a.imageUrl) ?? ''} alt="" aria-label="Affiche" title="Affiche"
                  style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 10, flexShrink: 0 }} />
              )}
              <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                <div style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</div>
                {a.body && <div style={{ fontFamily: th.fontUI, color: th.textMute, fontSize: 13, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.body}</div>}
                <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span>{KIND_LABEL[a.kind ?? 'INFO']}</span>
                  <span>· créée le {new Date(a.createdAt).toLocaleDateString('fr-FR')}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {a.pinned && <Chip tone="accent" icon="pin">Épinglée</Chip>}
                {!a.isPublished && <Chip tone="line">Brouillon</Chip>}
                {a.isPublished && !a.pinned && <Chip tone="mute">Publiée</Chip>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 'auto' }}>
                <button onClick={() => startEdit(a)} style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '6px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text }}>Modifier</button>
                <button onClick={() => remove(a)} style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '6px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: '#ff7a4d' }}>Supprimer</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
