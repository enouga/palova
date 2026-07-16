'use client';
import { useState, useEffect, useRef, CSSProperties } from 'react';
import { api, Announcement, AnnouncementBody, AnnouncementKind, assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { Btn } from '@/components/ui/atoms';

const KIND_LABEL: Record<AnnouncementKind, string> = { INFO: 'Info', OFFER: 'Offre', TOURNAMENT: 'Tournoi', EVENT: 'Event' };
const EMPTY = { title: '', body: '', linkUrl: '', kind: 'INFO' as AnnouncementKind, validUntil: '', pinned: false, isPublished: true };

// Fenêtre de création/édition d'une annonce, avec aperçu en direct (langage du kiosque
// « À la une »). Extrait du formulaire inline de /admin/announcements : même logique
// d'enregistrement (l'image s'envoie APRÈS obtention de l'id, échec non bloquant).
export function AnnouncementStudio({ clubId, token, editing, onClose, onSaved }: {
  clubId: string; token: string; editing: Announcement | null; onClose: () => void; onSaved: () => void;
}) {
  const { th } = useTheme();
  const editId = editing?.id ?? null;
  const [form, setForm] = useState(() => editing
    ? {
      title: editing.title, body: editing.body, linkUrl: editing.linkUrl ?? '',
      kind: editing.kind ?? 'INFO', validUntil: editing.validUntil ? editing.validUntil.slice(0, 10) : '',
      pinned: editing.pinned, isPublished: editing.isPublished,
    }
    : EMPTY);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Aperçu local du fichier choisi (jsdom/vieux navigateurs sans createObjectURL → repli).
  useEffect(() => {
    if (!imageFile || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(imageFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const labelStyle: CSSProperties = { fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 6 };
  const inputStyle: CSSProperties = { height: 46, padding: '0 14px', borderRadius: 12, background: th.bg, color: th.text, border: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 15 };
  const miniBtn: CSSProperties = { border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '7px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text };
  const checkboxLabel: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text, cursor: 'pointer' };

  const currentImageUrl = editing?.imageUrl ?? null;
  const shownImage = previewUrl ?? (!removeImage && currentImageUrl ? assetUrl(currentImageUrl) : null);
  const hasImage = Boolean(imageFile || (!removeImage && currentImageUrl));

  const clearImage = () => {
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (imageFile) { setImageFile(null); return; }
    if (currentImageUrl) setRemoveImage(true);
  };

  const submit = async () => {
    if (saving) return;
    if (!form.title.trim() || !form.body.trim()) { setFormError('Le titre et le contenu sont obligatoires.'); return; }
    setSaving(true);
    setFormError(null);
    const body: AnnouncementBody = {
      title: form.title.trim(),
      body: form.body.trim(),
      linkUrl: form.linkUrl.trim() || null,
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
      onSaved();
      onClose();
    } catch (e) {
      // L'annonce est enregistrée : on rafraîchit la liste et on garde la fenêtre ouverte.
      setFormError(`L'annonce est enregistrée, mais l'envoi de l'image a échoué (${(e as Error).message}). Réessayez.`);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: th.surface, borderRadius: 18, boxShadow: th.shadow, width: '100%', maxWidth: 860, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 20, margin: 0, color: th.text }}>{editId ? "Modifier l'annonce" : 'Nouvelle annonce'}</h2>
          <button onClick={onClose} aria-label="Fermer" style={{ ...miniBtn, borderRadius: 999 }}>✕</button>
        </div>

        <style>{`.st-grid{display:grid;grid-template-columns:1fr;gap:16px}@media(min-width:700px){.st-grid{grid-template-columns:1fr 300px}}`}</style>
        <div className="st-grid">
          {/* colonne formulaire */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={labelStyle}>
              Titre *
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Titre de l'annonce" style={inputStyle} />
            </label>
            <label style={labelStyle}>
              Contenu *
              <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Détail de l’annonce…" rows={4}
                style={{ ...inputStyle, height: 'auto', padding: '12px 14px', resize: 'vertical', lineHeight: 1.5 }} />
            </label>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label style={{ ...labelStyle, flex: 1, minWidth: 150 }}>
                Type
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as AnnouncementKind })} style={{ ...inputStyle, cursor: 'pointer' }}>
                  {(Object.keys(KIND_LABEL) as AnnouncementKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
              </label>
              <label style={{ ...labelStyle, flex: 1, minWidth: 150 }}>
                Afficher jusqu&apos;au
                <input value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} type="date" style={inputStyle} />
              </label>
            </div>
            <label style={labelStyle}>
              Lien (optionnel)
              <input value={form.linkUrl} onChange={(e) => setForm({ ...form, linkUrl: e.target.value })} placeholder="https://…" type="url" style={inputStyle} />
            </label>
            <div style={labelStyle}>
              Affiche (image)
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Affiche (image)" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0] ?? null; if (f) { setImageFile(f); setRemoveImage(false); } }} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => fileInputRef.current?.click()} style={miniBtn}>{hasImage ? "Changer l'image" : 'Ajouter une image'}</button>
                {hasImage && <button type="button" onClick={clearImage} style={{ ...miniBtn, color: '#ff7a4d' }}>Retirer l&apos;image</button>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 2 }}>
              <label style={checkboxLabel}>
                <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} style={{ width: 18, height: 18, accentColor: th.accent }} />
                À la une ★
              </label>
              <label style={checkboxLabel}>
                <input type="checkbox" checked={form.isPublished} onChange={(e) => setForm({ ...form, isPublished: e.target.checked })} style={{ width: 18, height: 18, accentColor: th.accent }} />
                Publiée
              </label>
            </div>
            {formError && <div role="alert" style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: '#ff7a4d' }}>{formError}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <Btn onClick={submit} icon={editId ? 'check' : 'plus'} disabled={saving}>{saving ? '…' : editId ? 'Enregistrer' : 'Publier'}</Btn>
              <Btn variant="ghost" onClick={onClose} disabled={saving}>Annuler</Btn>
            </div>
          </div>

          {/* colonne aperçu en direct */}
          <div>
            <div style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, color: th.textMute, marginBottom: 8 }}>Aperçu</div>
            <div data-testid="studio-preview" style={{ background: HERO_GRADIENT, color: HERO_INK, borderRadius: 14, overflow: 'hidden' }}>
              {shownImage
                ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={shownImage} alt="" style={{ width: '100%', maxHeight: 150, objectFit: 'cover', display: 'block' }} />
                )
                : <div style={{ height: 84 }} />}
              <div style={{ padding: 12 }}>
                <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, background: 'rgba(24,21,14,0.12)', padding: '2px 8px', borderRadius: 20 }}>
                  {KIND_LABEL[form.kind]}{form.pinned ? ' · ★' : ''}
                </span>
                <div style={{ fontFamily: th.fontDisplay, fontSize: 17, fontWeight: 600, marginTop: 8 }}>{form.title || 'Titre de l’annonce'}</div>
                <div style={{ fontFamily: th.fontUI, fontSize: 13, color: HERO_INK_MUTED, marginTop: 4, lineHeight: 1.4 }}>{form.body || 'Le contenu s’affiche ici…'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
