'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { api, PackageTemplate, PackageKind, SubscriptionPlan, SubscriptionBenefit, assetUrl } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';

const euro = (s: string | number) => `${Number(s).toFixed(2).replace('.', ',')} €`;

/**
 * Description complète + affiche d'une offre : preview (texte + image, « Modifier » en
 * bas) → édition unique (texte + image) → UN SEUL « Enregistrer » qui valide les deux à
 * la fois (description et changement/retrait d'image).
 */
function OfferEditor({ description, imageUrl, busy, onSave }: {
  description: string | null;
  imageUrl: string | null;
  busy: boolean;
  onSave: (description: string, removeImage: boolean, newImageFile: File | null) => Promise<void>;
}) {
  const { th } = useTheme();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description ?? '');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => { setDraft(description ?? ''); }, [description]);

  useEffect(() => {
    if (!pendingFile || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(pendingFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  const linkBtn = { border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, color: th.accent } as const;
  const miniBtn = { border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 8, padding: '5px 10px', fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, color: th.text } as const;

  const startEdit = () => {
    setDraft(description ?? '');
    setPendingFile(null);
    setImageRemoved(false);
    if (fileRef.current) fileRef.current.value = '';
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setPendingFile(null);
    setImageRemoved(false);
    if (fileRef.current) fileRef.current.value = '';
  };
  const save = async () => {
    await onSave(draft, imageRemoved, pendingFile);
    setEditing(false);
    setPendingFile(null);
    setImageRemoved(false);
  };

  const editingImage = previewUrl ?? (!imageRemoved && imageUrl ? assetUrl(imageUrl) : null);
  const shownImage = editing ? editingImage : (imageUrl ? assetUrl(imageUrl) : null);

  if (!editing) {
    return (
      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: description ? th.textMute : th.textFaint, whiteSpace: 'pre-wrap' }}>
          {description || 'Aucune description complète — les joueurs ne verront que les caractéristiques ci-dessus.'}
        </div>
        {shownImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shownImage} alt="Affiche de l'offre" style={{ display: 'block', width: 'auto', height: 'auto', maxWidth: 300, maxHeight: 500, borderRadius: 8 }} />
        )}
        <button type="button" onClick={startEdit} style={linkBtn}>Modifier</button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4}
        placeholder="Description complète de l'offre, affichée aux joueurs dans la modale de souscription…"
        style={{ border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '8px 10px', fontFamily: th.fontUI, fontSize: 13.5, lineHeight: 1.5, resize: 'vertical' }} />

      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0] ?? null; setPendingFile(f); if (f) setImageRemoved(false); }} />
      {editingImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={editingImage} alt="Affiche de l'offre" style={{ display: 'block', width: 'auto', height: 'auto', maxWidth: 300, maxHeight: 500, borderRadius: 8 }} />
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} style={miniBtn}>
          {editingImage ? "Changer l'image" : 'Ajouter une image'}
        </button>
        {editingImage && (
          <button type="button" disabled={busy} onClick={() => { setPendingFile(null); setImageRemoved(true); if (fileRef.current) fileRef.current.value = ''; }} style={{ ...miniBtn, color: '#ff7a4d' }}>
            Retirer l'image
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={busy} onClick={save}
          style={{ border: 'none', background: th.accent, color: th.onAccent, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700 }}>
          Enregistrer
        </button>
        <button type="button" disabled={busy} onClick={cancel} style={miniBtn}>
          Annuler
        </button>
      </div>
    </div>
  );
}

/** Image en attente de création (aperçu local, rien n'est uploadé tant que l'offre n'existe pas). */
function PendingImagePicker({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
  const { th } = useTheme();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const miniBtn = { border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 8, padding: '5px 10px', fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, color: th.text } as const;

  useEffect(() => {
    if (!file || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt="Aperçu" style={{ display: 'block', width: 'auto', height: 'auto', maxWidth: 300, maxHeight: 500, borderRadius: 8 }} />
      ) : file ? (
        <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.text, fontWeight: 600 }}>{file.name}</span>
      ) : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => fileRef.current?.click()} style={miniBtn}>
          {file ? "Changer l'image" : 'Ajouter une image'}
        </button>
        {file && (
          <button type="button" onClick={() => { onChange(null); if (fileRef.current) fileRef.current.value = ''; }} style={{ ...miniBtn, color: '#ff7a4d' }}>
            Retirer
          </button>
        )}
      </div>
    </div>
  );
}

export default function AdminPackagesPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;

  const [templates, setTemplates] = useState<PackageTemplate[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [busy, setBusy]           = useState(false);

  const [kind, setKind]           = useState<PackageKind>('ENTRIES');
  const [name, setName]           = useState('');
  const [description, setDescription] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [price, setPrice]         = useState('');
  const [entries, setEntries]     = useState('10');
  const [walletAmount, setWallet] = useState('');
  const [validity, setValidity]   = useState('');
  const [tSportKeys, setTSportKeys] = useState<string[]>([]);

  // abonnements
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [pName, setPName] = useState('');
  const [pDescription, setPDescription] = useState('');
  const [pImageFile, setPImageFile] = useState<File | null>(null);
  const [pSports, setPSports] = useState<string[]>(['padel']);
  const [pPrice, setPPrice] = useState('');
  const [pMonths, setPMonths] = useState('12');
  const [pOffPeak, setPOffPeak] = useState(true);
  const [pBenefit, setPBenefit] = useState<SubscriptionBenefit>('INCLUDED');
  const [pDiscount, setPDiscount] = useState('50');
  const [pDailyCap, setPDailyCap] = useState('');
  const [pWeeklyCap, setPWeeklyCap] = useState('');

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try {
      setError(null);
      const [tpls, pls] = await Promise.all([
        api.adminGetPackageTemplates(clubId, token),
        api.adminGetSubscriptionPlans(clubId, token),
      ]);
      setTemplates(tpls); setPlans(pls);
    }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, clubId]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  const create = async () => {
    if (!token || !clubId) return;
    if (!name.trim() || !price) { setError('Nom et prix requis.'); return; }
    setBusy(true);
    try {
      setError(null);
      const created = await api.adminCreatePackageTemplate(clubId, {
        kind, name: name.trim(), description: description.trim() || undefined, price: Number(price),
        entriesCount: kind === 'ENTRIES' ? Number(entries) : undefined,
        walletAmount: kind === 'WALLET' ? Number(walletAmount) : undefined,
        validityDays: validity ? Number(validity) : null,
        sportKeys: tSportKeys,
      }, token);
      const pendingImage = imageFile;
      setName(''); setDescription(''); setPrice(''); setWallet(''); setImageFile(null); setTSportKeys([]);
      await load();
      if (pendingImage) {
        try { await api.adminUploadPackageTemplateImage(clubId, created.id, pendingImage, token); await load(); }
        catch (e) { setError(`Offre créée, mais l'image n'a pas pu être envoyée (${(e as Error).message}). Ajoutez-la depuis la liste ci-dessous.`); }
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const toggleActive = async (t: PackageTemplate) => {
    if (!token || !clubId) return;
    setBusy(true);
    try { setError(null); await api.adminUpdatePackageTemplate(clubId, t.id, { isActive: !t.isActive }, token); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  /** Un seul point d'enregistrement pour la description ET l'image d'une offre. */
  const saveTemplateEdits = async (t: PackageTemplate, descriptionValue: string, removeImage: boolean, newImageFile: File | null) => {
    if (!token || !clubId) return;
    setBusy(true);
    try {
      setError(null);
      await api.adminUpdatePackageTemplate(clubId, t.id, {
        description: descriptionValue.trim() || null,
        ...(removeImage && !newImageFile ? { imageUrl: null } : {}),
      }, token);
      if (newImageFile) await api.adminUploadPackageTemplateImage(clubId, t.id, newImageFile, token);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const sportOptions = ['padel', 'squash', 'tennis', 'badminton', 'pickleball', 'pingpong'];
  const toggleSport = (k: string) =>
    setPSports((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  const toggleTemplateSport = (k: string) =>
    setTSportKeys((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  const createPlan = async () => {
    if (!token || !clubId) return;
    if (!pName.trim() || !pPrice || pSports.length === 0) { setError('Nom, prix et au moins un sport requis.'); return; }
    setBusy(true);
    try {
      setError(null);
      const created = await api.adminCreateSubscriptionPlan(clubId, {
        name: pName.trim(), description: pDescription.trim() || undefined, sportKeys: pSports, monthlyPrice: Number(pPrice), commitmentMonths: Number(pMonths),
        offPeakOnly: pOffPeak, benefit: pBenefit,
        discountPercent: pBenefit === 'DISCOUNT' ? Number(pDiscount) : null,
        dailyCap: pDailyCap ? Number(pDailyCap) : null,
        weeklyCap: pWeeklyCap ? Number(pWeeklyCap) : null,
      }, token);
      const pendingImage = pImageFile;
      setPName(''); setPDescription(''); setPPrice(''); setPImageFile(null);
      await load();
      if (pendingImage) {
        try { await api.adminUploadSubscriptionPlanImage(clubId, created.id, pendingImage, token); await load(); }
        catch (e) { setError(`Abonnement créé, mais l'image n'a pas pu être envoyée (${(e as Error).message}). Ajoutez-la depuis la liste ci-dessous.`); }
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const togglePlanActive = async (p: SubscriptionPlan) => {
    if (!token || !clubId) return;
    setBusy(true);
    try { setError(null); await api.adminUpdateSubscriptionPlan(clubId, p.id, { isActive: !p.isActive }, token); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  /** Un seul point d'enregistrement pour la description ET l'image d'un abonnement. */
  const savePlanEdits = async (p: SubscriptionPlan, descriptionValue: string, removeImage: boolean, newImageFile: File | null) => {
    if (!token || !clubId) return;
    setBusy(true);
    try {
      setError(null);
      await api.adminUpdateSubscriptionPlan(clubId, p.id, {
        description: descriptionValue.trim() || null,
        ...(removeImage && !newImageFile ? { imageUrl: null } : {}),
      }, token);
      if (newImageFile) await api.adminUploadSubscriptionPlanImage(clubId, p.id, newImageFile, token);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const input = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '8px 10px', fontFamily: th.fontUI, fontSize: 14 } as const;
  const label = { fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column' as const, gap: 4 };

  return (
    <div>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: '0 0 18px', color: th.text }}>Offres prépayées</h1>
      {error && <div style={{ marginBottom: 16, background: '#ff7a4d', color: '#fff', borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

      {/* création */}
      <div style={{ background: th.surface, borderRadius: 16, padding: 18, marginBottom: 22, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
        <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.text, marginBottom: 12 }}>Nouvelle offre</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['ENTRIES', 'WALLET'] as PackageKind[]).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              style={{ border: `1.5px solid ${kind === k ? th.accent : th.line}`, background: kind === k ? th.surface2 : 'transparent', borderRadius: 10, padding: '7px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text }}>
              {k === 'ENTRIES' ? 'Carnet d’entrées' : 'Porte-monnaie €'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {sportOptions.map((k) => (
            <button key={k} type="button" onClick={() => toggleTemplateSport(k)}
              style={{ border: `1.5px solid ${tSportKeys.includes(k) ? th.accent : th.line}`, background: tSportKeys.includes(k) ? th.surface2 : 'transparent', borderRadius: 10, padding: '6px 11px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text }}>
              {k}
            </button>
          ))}
        </div>
        <PendingImagePicker file={imageFile} onChange={setImageFile} />
        <label style={{ ...label, marginBottom: 10 }}>Description complète (affichée aux joueurs)
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
            placeholder="Ex. Valable dans tous les créneaux du club, cessible en famille, sans engagement…"
            style={{ ...input, height: 'auto', resize: 'vertical', lineHeight: 1.5 }} />
        </label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ ...label, flex: 1, minWidth: 180 }}>Nom
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'ENTRIES' ? 'Ex. 10 entrées' : 'Ex. Avoir 200 €'} style={input} />
          </label>
          <label style={label}>Prix de vente €
            <input type="number" min={0} step="0.5" value={price} onChange={(e) => setPrice(e.target.value)} style={{ ...input, width: 90 }} />
          </label>
          {kind === 'ENTRIES' ? (
            <label style={label}>Entrées
              <input type="number" min={1} step="1" value={entries} onChange={(e) => setEntries(e.target.value)} style={{ ...input, width: 70 }} />
            </label>
          ) : (
            <label style={label}>Montant crédité €
              <input type="number" min={0} step="0.5" value={walletAmount} onChange={(e) => setWallet(e.target.value)} style={{ ...input, width: 110 }} />
            </label>
          )}
          <label style={label}>Validité (jours, vide = sans)
            <input type="number" min={1} step="1" value={validity} onChange={(e) => setValidity(e.target.value)} style={{ ...input, width: 110 }} />
          </label>
          <Btn type="button" icon="plus" onClick={create} disabled={busy}>{busy ? '…' : 'Créer'}</Btn>
        </div>
      </div>

      {/* liste */}
      {loading ? (
        <div style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
      ) : templates.length === 0 ? (
        <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucune offre pour l’instant.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {templates.map((t) => (
            <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 10, background: th.surface, borderRadius: 14, padding: '13px 16px', boxShadow: `inset 0 0 0 1px ${th.line}`, opacity: t.isActive ? 1 : 0.55 }}>
              <div>
                <div style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 700, color: th.text }}>{t.name}</div>
                <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>
                  {t.kind === 'ENTRIES' ? `${t.entriesCount} entrées` : `${euro(t.walletAmount ?? 0)} crédités`}
                  {' · '}{euro(t.price)}
                  {t.validityDays ? ` · valable ${t.validityDays} j` : ' · sans expiration'}
                  {' · '}{t.sportKeys.length > 0 ? t.sportKeys.join(', ') : 'Tous sports'}
                </div>
                <OfferEditor description={t.description} imageUrl={t.imageUrl} busy={busy}
                  onSave={(d, r, f) => saveTemplateEdits(t, d, r, f)} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => toggleActive(t)} disabled={busy}
                  style={{ border: `1px solid ${th.line}`, background: 'transparent', color: t.isActive ? '#ff7a4d' : th.text, borderRadius: 9, padding: '7px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>
                  {t.isActive ? 'Désactiver' : 'Réactiver'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ===== Abonnements ===== */}
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: '40px 0 18px', color: th.text }}>Abonnements</h1>

      <div style={{ background: th.surface, borderRadius: 16, padding: 18, marginBottom: 22, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
        <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.text, marginBottom: 12 }}>Nouvel abonnement</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {sportOptions.map((k) => (
            <button key={k} type="button" onClick={() => toggleSport(k)}
              style={{ border: `1.5px solid ${pSports.includes(k) ? th.accent : th.line}`, background: pSports.includes(k) ? th.surface2 : 'transparent', borderRadius: 10, padding: '6px 11px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text }}>
              {k}
            </button>
          ))}
        </div>
        <PendingImagePicker file={pImageFile} onChange={setPImageFile} />
        <label style={{ ...label, marginBottom: 10 }}>Description complète (affichée aux joueurs)
          <textarea value={pDescription} onChange={(e) => setPDescription(e.target.value)} rows={3}
            placeholder="Ex. Accès illimité aux heures creuses, résiliable après la période d'engagement…"
            style={{ ...input, height: 'auto', resize: 'vertical', lineHeight: 1.5 }} />
        </label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ ...label, flex: 1, minWidth: 180 }}>Nom
            <input type="text" value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Ex. Abonnement Padel — heures creuses" style={input} />
          </label>
          <label style={label}>Prix mensuel €
            <input type="number" min={0} step="1" value={pPrice} onChange={(e) => setPPrice(e.target.value)} style={{ ...input, width: 110 }} />
          </label>
          <label style={label}>Engagement (mois)
            <input type="number" min={1} step="1" value={pMonths} onChange={(e) => setPMonths(e.target.value)} style={{ ...input, width: 90 }} />
          </label>
          <label style={{ ...label, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={pOffPeak} onChange={(e) => setPOffPeak(e.target.checked)} /> Heures creuses uniquement
          </label>
          <label style={label}>Avantage
            <select value={pBenefit} onChange={(e) => setPBenefit(e.target.value as SubscriptionBenefit)} style={{ ...input, width: 130 }}>
              <option value="INCLUDED">Inclus (gratuit)</option>
              <option value="DISCOUNT">Remise %</option>
            </select>
          </label>
          {pBenefit === 'DISCOUNT' && (
            <label style={label}>Remise %
              <input type="number" min={1} max={100} step="1" value={pDiscount} onChange={(e) => setPDiscount(e.target.value)} style={{ ...input, width: 80 }} />
            </label>
          )}
          <label style={label}>Plafond / jour
            <input type="number" min={1} step="1" value={pDailyCap} onChange={(e) => setPDailyCap(e.target.value)} placeholder="∞" style={{ ...input, width: 90 }} />
          </label>
          <label style={label}>Plafond / sem.
            <input type="number" min={1} step="1" value={pWeeklyCap} onChange={(e) => setPWeeklyCap(e.target.value)} placeholder="∞" style={{ ...input, width: 90 }} />
          </label>
          <Btn type="button" icon="plus" onClick={createPlan} disabled={busy}>{busy ? '…' : 'Créer'}</Btn>
        </div>
      </div>

      {plans.length === 0 ? (
        <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucun abonnement pour l’instant.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {plans.map((p) => (
            <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 10, background: th.surface, borderRadius: 14, padding: '13px 16px', boxShadow: `inset 0 0 0 1px ${th.line}`, opacity: p.isActive ? 1 : 0.55 }}>
              <div>
                <div style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 700, color: th.text }}>{p.name}</div>
                <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>
                  {p.sportKeys.join(', ')} · {euro(p.monthlyPrice)}/mois · {p.commitmentMonths} mois
                  {' · '}{p.offPeakOnly ? 'heures creuses' : 'toutes heures'}
                  {' · '}{p.benefit === 'INCLUDED' ? 'inclus' : `−${p.discountPercent} %`}
                  {(p.dailyCap || p.weeklyCap) ? ` · max ${p.dailyCap ?? '∞'}/j, ${p.weeklyCap ?? '∞'}/sem` : ''}
                </div>
                <OfferEditor description={p.description} imageUrl={p.imageUrl} busy={busy}
                  onSave={(d, r, f) => savePlanEdits(p, d, r, f)} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => togglePlanActive(p)} disabled={busy}
                  style={{ border: `1px solid ${th.line}`, background: 'transparent', color: p.isActive ? '#ff7a4d' : th.text, borderRadius: 9, padding: '7px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>
                  {p.isActive ? 'Désactiver' : 'Réactiver'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
