'use client';
import { useState, useEffect, useCallback, useRef, CSSProperties } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, AdminEmailDetail, EmailDraft, EmailVarDef } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';
import { EmailPreview } from '@/components/admin/email/EmailPreview';

type Field = 'subject' | 'heading' | 'bodyHtml' | 'ctaLabel';

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
  const [busy, setBusy] = useState(false);
  const focused = useRef<Field>('bodyHtml');
  const refs = {
    subject: useRef<HTMLInputElement>(null), heading: useRef<HTMLInputElement>(null),
    bodyHtml: useRef<HTMLTextAreaElement>(null), ctaLabel: useRef<HTMLInputElement>(null),
  };

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    const d = await api.adminGetEmail(clubId, type, token);
    setDetail(d);
    const src = d.override ?? d.defaults;
    setDraft({ subject: src.subject, heading: src.heading, bodyHtml: src.bodyHtml, ctaLabel: src.ctaLabel ?? '', footerNote: src.footerNote ?? '' });
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

  function insertVar(v: EmailVarDef) {
    const f = focused.current;
    const el = refs[f].current;
    const token2 = `{{${v.key}}}`;
    setDraft((d) => {
      const cur = (d[f] ?? '') as string;
      const start = el?.selectionStart ?? cur.length;
      const end = el?.selectionEnd ?? cur.length;
      return { ...d, [f]: cur.slice(0, start) + token2 + cur.slice(end) };
    });
  }

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
  const inputStyle: CSSProperties = { height: 44, padding: '0 14px', borderRadius: 12, background: th.bg, color: th.text, border: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 15 };
  const areaStyle: CSSProperties = { padding: '12px 14px', borderRadius: 12, background: th.bg, color: th.text, border: `1px solid ${th.line}`, fontFamily: 'monospace', fontSize: 14, minHeight: 150, resize: 'vertical' };

  if (!detail) return <p style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</p>;

  return (
    <div style={{ maxWidth: 1080, display: 'grid', gridTemplateColumns: '1fr', gap: 24 }}>
      <button onClick={() => router.push('/admin/emails')} style={{ ...labelStyle, background: 'none', border: 'none', cursor: 'pointer', alignSelf: 'start' }}>← Tous les emails</button>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, margin: 0, color: th.text }}>{detail.title}</h1>
      <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: '-12px 0 0' }}>{detail.description}</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 24 }}>
        {/* Colonne édition */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {detail.vars.map((v) => (
              <button key={v.key} type="button" title={v.label} onClick={() => insertVar(v)}
                style={{ fontFamily: 'monospace', fontSize: 12, padding: '4px 8px', borderRadius: 8, border: `1px solid ${th.line}`, background: th.bgElev, color: th.text, cursor: 'pointer' }}>
                {`{{${v.key}}}`}
              </button>
            ))}
          </div>
          <label style={labelStyle}>Objet
            <input ref={refs.subject} style={inputStyle} value={draft.subject} onFocus={() => (focused.current = 'subject')} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} />
          </label>
          <label style={labelStyle}>Titre
            <input ref={refs.heading} style={inputStyle} value={draft.heading} onFocus={() => (focused.current = 'heading')} onChange={(e) => setDraft((d) => ({ ...d, heading: e.target.value }))} />
          </label>
          <label style={labelStyle}>Corps (HTML)
            <textarea ref={refs.bodyHtml} style={areaStyle} value={draft.bodyHtml} onFocus={() => (focused.current = 'bodyHtml')} onChange={(e) => setDraft((d) => ({ ...d, bodyHtml: e.target.value }))} />
          </label>
          {detail.hasCta && (
            <label style={labelStyle}>Libellé du bouton
              <input ref={refs.ctaLabel} style={inputStyle} value={draft.ctaLabel} onFocus={() => (focused.current = 'ctaLabel')} onChange={(e) => setDraft((d) => ({ ...d, ctaLabel: e.target.value }))} />
            </label>
          )}
          {msg && <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.accent, margin: 0 }}>{msg}</p>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Btn variant="primary" disabled={busy} onClick={save}>Enregistrer</Btn>
            <Btn variant="ghost" disabled={busy} onClick={sendTest}>Envoyer un test</Btn>
            <Btn variant="ghost" disabled={busy || !detail.override} onClick={reset}>Réinitialiser</Btn>
          </div>
        </div>

        {/* Colonne aperçu */}
        <div>
          <div style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute, marginBottom: 6 }}>Aperçu</div>
          <EmailPreview html={previewHtml} />
        </div>
      </div>
    </div>
  );
}
