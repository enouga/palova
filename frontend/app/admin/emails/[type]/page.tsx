'use client';
import { useState, useEffect, useCallback, CSSProperties } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, AdminEmailDetail, EmailDraft } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';
import { EmailPreview } from '@/components/admin/email/EmailPreview';
import { RichEmailEditor } from '@/components/admin/email/RichEmailEditor';

export default function EmailEditorPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const router = useRouter();
  const clubId = club?.id;
  const type = String((useParams() as { type: string }).type);

  const [detail, setDetail] = useState<AdminEmailDetail | null>(null);
  const [draft, setDraft] = useState<EmailDraft>({ subject: '', heading: '', bodyHtml: '', ctaLabel: '', footerNote: '' });
  const [previewHtml, setPreviewHtml] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoadError(null);
    try {
      const d = await api.adminGetEmail(clubId, type, token);
      setDetail(d);
      const src = d.override ?? d.defaults;
      setDraft({ subject: src.subject, heading: src.heading, bodyHtml: src.bodyHtml, ctaLabel: src.ctaLabel ?? '', footerNote: src.footerNote ?? '' });
    } catch (e) { setLoadError((e as Error).message); }
  }, [token, clubId, type]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  // Aperçu serveur débouncé.
  useEffect(() => {
    if (!token || !clubId || !detail) return;
    const h = setTimeout(async () => {
      try { setPreviewHtml((await api.adminPreviewEmail(clubId, type, draft, token)).html); } catch { /* ignore */ }
    }, 400);
    return () => clearTimeout(h);
  }, [token, clubId, type, draft, detail]);

  const setField = (f: keyof EmailDraft) => (stored: string) => setDraft((d) => ({ ...d, [f]: stored }));

  const uploadImage = useCallback(async (file: File) => {
    if (!token || !clubId) throw new Error('Non connecté');
    return (await api.adminUploadEmailImage(clubId, file, token)).url;
  }, [token, clubId]);

  async function save() {
    if (!token || !clubId) return;
    setBusy(true); setMsg(null);
    try {
      const res = await api.adminSaveEmail(clubId, type, draft, token);
      setMsg(res.unknownVars.length ? `Enregistré. Variables inconnues ignorées : ${res.unknownVars.map((v) => `{{${v}}}`).join(', ')}` : 'Enregistré ✅');
      await load();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  async function reset() {
    if (!token || !clubId) return;
    setBusy(true); setMsg(null);
    try { await api.adminResetEmail(clubId, type, token); await load(); setMsg('Réinitialisé au défaut.'); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  async function sendTest() {
    if (!token || !clubId) return;
    setBusy(true); setMsg(null);
    try { await api.adminTestEmail(clubId, type, draft, token); setMsg('Email de test envoyé.'); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  const labelStyle: CSSProperties = { fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 6 };

  if (!detail) {
    if (loadError) return <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: '#e55' }}>{loadError}</p>;
    return <p style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</p>;
  }

  return (
    <div style={{ maxWidth: 1120, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <button onClick={() => router.push('/admin/emails')} style={{ ...labelStyle, background: 'none', border: 'none', cursor: 'pointer', alignSelf: 'start' }}>← Tous les emails</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, margin: 0, color: th.text }}>{detail.title}</h1>
        <span style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, padding: '3px 11px', borderRadius: 99, background: detail.override ? `${th.accent}22` : th.bgElev, color: detail.override ? th.accent : th.textFaint, border: `1px solid ${detail.override ? th.accent : th.line}` }}>
        {detail.override ? 'Personnalisé' : 'Défaut'}
        </span>
      </div>
      <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: '-8px 0 0' }}>{detail.description}</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24, alignItems: 'start' }}>
        {/* Colonne édition */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div style={labelStyle}>Objet
            <RichEmailEditor singleLine value={draft.subject} vars={detail.vars} onChange={setField('subject')} />
          </div>
          <div style={labelStyle}>Titre
            <RichEmailEditor singleLine value={draft.heading} vars={detail.vars} onChange={setField('heading')} />
          </div>
          <div style={labelStyle}>Message
            <RichEmailEditor value={draft.bodyHtml} vars={detail.vars} onChange={setField('bodyHtml')} onUploadImage={uploadImage} />
          </div>
          {detail.hasCta && (
            <div style={labelStyle}>Libellé du bouton
              <RichEmailEditor singleLine value={draft.ctaLabel ?? ''} vars={detail.vars} onChange={setField('ctaLabel')} />
            </div>
          )}
          {msg && <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.accent, margin: 0 }}>{msg}</p>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Btn variant="primary" disabled={busy} onClick={save}>Enregistrer</Btn>
            <Btn variant="ghost" disabled={busy} onClick={sendTest}>Envoyer un test</Btn>
            <Btn variant="ghost" disabled={busy || !detail.override} onClick={reset}>Réinitialiser</Btn>
          </div>
        </div>

        {/* Colonne aperçu (collante en desktop) */}
        <div style={{ position: 'sticky', top: 12, minWidth: 0 }}>
          <div style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute, marginBottom: 6 }}>Aperçu</div>
          <EmailPreview html={previewHtml} />
        </div>
      </div>
    </div>
  );
}
