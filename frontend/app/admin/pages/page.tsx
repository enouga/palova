'use client';

import { useCallback, useEffect, useState, CSSProperties } from 'react';
import { api, ClubAdminDetail, ClubPageKind, AdminFaqItem } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { isClubAdmin, useAdminRole } from '@/lib/adminRole';
import type { Theme } from '@/lib/theme';
import { Btn } from '@/components/ui/atoms';

const KINDS: { key: ClubPageKind; label: string; path: string }[] = [
  { key: 'MENTIONS_LEGALES', label: 'Mentions légales', path: '/mentions-legales' },
  { key: 'CGV', label: 'CGV', path: '/cgv' },
  { key: 'CONFIDENTIALITE', label: 'Confidentialité', path: '/confidentialite' },
  { key: 'OFFRES', label: 'Nos offres', path: '/offres' },
];

type Tab = 'legal' | ClubPageKind | 'faq';

const card = (th: Theme): CSSProperties => ({ background: th.surface, borderRadius: 18, padding: 22, boxShadow: th.shadowSoft });
const inputStyle = (th: Theme): CSSProperties => ({
  width: '100%', boxSizing: 'border-box', height: 46, padding: '0 14px', borderRadius: 12,
  border: `1px solid ${th.line}`, background: th.bg, color: th.text, fontFamily: th.fontUI, fontSize: 15,
});
const areaStyle = (th: Theme): CSSProperties => ({
  width: '100%', boxSizing: 'border-box', minHeight: 320, padding: 14, borderRadius: 12,
  border: `1px solid ${th.line}`, background: th.bg, color: th.text, fontFamily: th.fontMono, fontSize: 13.5, lineHeight: 1.6, resize: 'vertical',
});
const labelStyle = (th: Theme): CSSProperties => ({ fontSize: 12.5, fontWeight: 600, color: th.textMute, display: 'block', marginBottom: 6 });

export default function AdminPagesPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club: hostClub } = useClub();
  const clubId = hostClub?.id;
  const admin = isClubAdmin(useAdminRole());
  const [tab, setTab] = useState<Tab>('legal');
  const [loading, setLoading] = useState(true);

  const [club, setClub] = useState<ClubAdminDetail | null>(null);
  const [pages, setPages] = useState<Record<string, { bodyMarkdown: string; published: boolean; updatedAt: string | null }>>({});
  const [faq, setFaq] = useState<AdminFaqItem[]>([]);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try {
      const [c, ps, fs] = await Promise.all([
        api.adminGetClub(clubId, token),
        api.adminGetPages(clubId, token),
        api.adminGetFaq(clubId, token),
      ]);
      setClub(c);
      const map: Record<string, { bodyMarkdown: string; published: boolean; updatedAt: string | null }> = {};
      for (const p of ps) map[p.kind] = { bodyMarkdown: p.bodyMarkdown, published: p.published, updatedAt: p.updatedAt };
      setPages(map);
      setFaq(fs);
    } finally { setLoading(false); }
  }, [token, clubId]);

  useEffect(() => { if (ready && token && clubId && admin) load(); }, [ready, token, clubId, admin, load]);

  if (!admin) {
    return <div style={{ padding: 24, fontFamily: th.fontUI, color: th.textMute }}>Cette page est réservée aux administrateurs du club.</div>;
  }

  if (!ready || loading || !club || !clubId || !token) {
    return <p style={{ color: th.textFaint, fontFamily: th.fontUI }}>Chargement…</p>;
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'legal', label: 'Coordonnées légales' },
    ...KINDS.map((k) => ({ key: k.key as Tab, label: k.label })),
    { key: 'faq', label: 'FAQ' },
  ];

  return (
    <div style={{ maxWidth: 820, fontFamily: th.fontUI }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 4px', color: th.text }}>Contenu & mentions légales</h1>
      <p style={{ color: th.textMute, margin: '0 0 18px', fontSize: 14 }}>
        Renseignez vos coordonnées légales, puis publiez vos pages. Un modèle Palova pré-rempli vous évite la page blanche.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
        {tabs.map((t) => {
          const active = t.key === tab;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              border: 'none', cursor: 'pointer', borderRadius: 10, padding: '8px 14px',
              fontFamily: th.fontUI, fontWeight: active ? 700 : 500, fontSize: 14,
              background: active ? th.accent : th.surface2, color: active ? th.onAccent : th.textMute,
            }}>{t.label}</button>
          );
        })}
      </div>

      {tab === 'legal' && <LegalForm clubId={clubId} token={token} club={club} onSaved={load} />}
      {KINDS.map((k) => tab === k.key && (
        <PageEditor key={k.key} clubId={clubId} token={token} kind={k.key} path={k.path}
          initial={pages[k.key]} onSaved={load} />
      ))}
      {tab === 'faq' && <FaqEditor clubId={clubId} token={token} items={faq} onChanged={load} />}
    </div>
  );
}

// --- Coordonnées légales ---

function LegalForm({ clubId, token, club, onSaved }: { clubId: string; token: string; club: ClubAdminDetail; onSaved: () => void }) {
  const { th } = useTheme();
  const [f, setF] = useState({
    legalEntityName: club.legalEntityName ?? '', legalForm: club.legalForm ?? '', siret: club.siret ?? '',
    vatNumber: club.vatNumber ?? '', legalRepresentative: club.legalRepresentative ?? '',
    legalEmail: club.legalEmail ?? '', legalPhone: club.legalPhone ?? '',
    address: club.address ?? '', city: club.city ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upd = (k: keyof typeof f, v: string) => { setSaved(false); setF((s) => ({ ...s, [k]: v })); };

  const save = async () => {
    setSaving(true); setError(null);
    try { await api.adminUpdateClub(clubId, f, token); setSaved(true); onSaved(); }
    catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  const fields: [keyof typeof f, string, string?][] = [
    ['legalEntityName', 'Raison sociale', 'Padel Arena SAS'],
    ['legalForm', 'Forme juridique', 'SAS, SARL, association loi 1901…'],
    ['siret', 'SIRET'],
    ['vatNumber', 'TVA intracommunautaire'],
    ['legalRepresentative', 'Directeur de la publication'],
    ['legalEmail', 'E-mail de contact', 'contact@votreclub.fr'],
    ['legalPhone', 'Téléphone'],
    ['address', 'Adresse'],
    ['city', 'Ville'],
  ];

  return (
    <div style={card(th)}>
      <p style={{ color: th.textMute, fontSize: 13.5, margin: '0 0 16px' }}>
        Ces informations alimentent automatiquement vos mentions légales et les modèles de CGV / confidentialité.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        {fields.map(([k, label, ph]) => (
          <label key={k}>
            <span style={labelStyle(th)}>{label}</span>
            <input value={f[k]} placeholder={ph} onChange={(e) => upd(k, e.target.value)} style={inputStyle(th)} />
          </label>
        ))}
      </div>
      {error && <p style={{ color: '#ff7a4d', fontSize: 13, marginTop: 12 }}>{error}</p>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 18 }}>
        <Btn onClick={save} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</Btn>
        {saved && <span style={{ color: th.accent, fontSize: 14, fontWeight: 600 }}>Enregistré ✓</span>}
      </div>
    </div>
  );
}

// --- Éditeur d'une page (markdown) ---

function PageEditor({ clubId, token, kind, path, initial, onSaved }: {
  clubId: string; token: string; kind: ClubPageKind; path: string;
  initial?: { bodyMarkdown: string; published: boolean; updatedAt: string | null }; onSaved: () => void;
}) {
  const { th } = useTheme();
  const [body, setBody] = useState(initial?.bodyMarkdown ?? '');
  const [published, setPublished] = useState(initial?.published ?? false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingTpl, setLoadingTpl] = useState(false);

  const prefill = async () => {
    if (body.trim() && !window.confirm('Remplacer le contenu actuel par le modèle Palova ?')) return;
    setLoadingTpl(true); setError(null);
    try { const { bodyMarkdown } = await api.adminGetPageTemplate(clubId, kind, token); setBody(bodyMarkdown); setSaved(false); }
    catch (e) { setError((e as Error).message); }
    finally { setLoadingTpl(false); }
  };

  const save = async () => {
    if (!body.trim()) { setError('Le contenu ne peut pas être vide.'); return; }
    setSaving(true); setError(null);
    try { await api.adminPutPage(clubId, kind, { bodyMarkdown: body, published }, token); setSaved(true); onSaved(); }
    catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <div style={card(th)}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <Btn variant="surface" icon="bolt" onClick={prefill} disabled={loadingTpl}>
          {loadingTpl ? 'Chargement…' : 'Pré-remplir avec le modèle Palova'}
        </Btn>
        <a href={path} target="_blank" rel="noreferrer" style={{ color: th.accent, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
          Aperçu public ↗
        </a>
      </div>
      <p style={{ color: th.textFaint, fontSize: 12.5, margin: '0 0 10px' }}>
        Format Markdown : <code># Titre</code>, <code>## Sous-titre</code>, <code>**gras**</code>, listes avec <code>-</code>.
      </p>
      <textarea value={body} onChange={(e) => { setBody(e.target.value); setSaved(false); }} style={areaStyle(th)} />
      {error && <p style={{ color: '#ff7a4d', fontSize: 13, marginTop: 10 }}>{error}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginTop: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, color: th.text }}>
          <input type="checkbox" checked={published} onChange={(e) => { setPublished(e.target.checked); setSaved(false); }} />
          Publiée (visible du public)
        </label>
        <Btn onClick={save} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</Btn>
        {saved && <span style={{ color: th.accent, fontSize: 14, fontWeight: 600 }}>Enregistré ✓</span>}
        {initial?.updatedAt && (
          <span style={{ color: th.textFaint, fontSize: 12.5, marginLeft: 'auto' }}>
            MAJ {new Date(initial.updatedAt).toLocaleDateString('fr-FR')}
          </span>
        )}
      </div>
    </div>
  );
}

// --- Éditeur FAQ ---

interface FaqDraft { id?: string; question: string; answerMarkdown: string; category: string; published: boolean }

function FaqEditor({ clubId, token, items, onChanged }: { clubId: string; token: string; items: AdminFaqItem[]; onChanged: () => void }) {
  const { th } = useTheme();
  const [rows, setRows] = useState<FaqDraft[]>(
    items.map((i) => ({ id: i.id, question: i.question, answerMarkdown: i.answerMarkdown, category: i.category ?? '', published: i.published })),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setRow = (idx: number, patch: Partial<FaqDraft>) => setRows((r) => r.map((row, i) => (i === idx ? { ...row, ...patch } : row)));

  const saveRow = async (idx: number) => {
    const row = rows[idx];
    if (!row.question.trim() || !row.answerMarkdown.trim()) { setError('Question et réponse sont requises.'); return; }
    setBusy(true); setError(null);
    try {
      const body = { question: row.question, answerMarkdown: row.answerMarkdown, category: row.category || null, published: row.published };
      if (row.id) await api.adminUpdateFaq(clubId, row.id, body, token);
      else await api.adminCreateFaq(clubId, body, token);
      onChanged();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const removeRow = async (idx: number) => {
    const row = rows[idx];
    if (row.id) {
      if (!window.confirm('Supprimer cette question ?')) return;
      setBusy(true);
      try { await api.adminDeleteFaq(clubId, row.id, token); onChanged(); }
      catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    } else {
      setRows((r) => r.filter((_, i) => i !== idx));
    }
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[idx], next[j]] = [next[j], next[idx]];
    setRows(next);
    const orderedIds = next.filter((r) => r.id).map((r) => r.id!) as string[];
    if (orderedIds.length === next.length) {
      setBusy(true);
      try { await api.adminReorderFaq(clubId, orderedIds, token); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }
  };

  const addRow = () => setRows((r) => [...r, { question: '', answerMarkdown: '', category: '', published: true }]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...card(th), background: th.surface2 }}>
        <p style={{ margin: 0, fontSize: 13.5, color: th.textMute }}>
          Un <strong>socle de questions communes</strong> (réserver, annuler, payer…) est déjà affiché d'office sur votre FAQ et tenu à jour par Palova.
          Ajoutez ici les questions propres à votre club (accès, parking, tarifs, tenue…).
        </p>
      </div>

      {error && <p style={{ color: '#ff7a4d', fontSize: 13, margin: 0 }}>{error}</p>}

      {rows.map((row, idx) => (
        <div key={row.id ?? `new-${idx}`} style={card(th)}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input value={row.question} placeholder="Question" onChange={(e) => setRow(idx, { question: e.target.value })} style={{ ...inputStyle(th), flex: 1 }} />
            <input value={row.category} placeholder="Rubrique (ex. Accès)" onChange={(e) => setRow(idx, { category: e.target.value })} style={{ ...inputStyle(th), width: 180 }} />
          </div>
          <textarea value={row.answerMarkdown} placeholder="Réponse (Markdown autorisé)" onChange={(e) => setRow(idx, { answerMarkdown: e.target.value })}
            style={{ ...areaStyle(th), minHeight: 110 }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, color: th.text }}>
              <input type="checkbox" checked={row.published} onChange={(e) => setRow(idx, { published: e.target.checked })} />
              Publiée
            </label>
            <button onClick={() => move(idx, -1)} disabled={idx === 0 || busy} aria-label="Monter" style={iconBtn(th)}>↑</button>
            <button onClick={() => move(idx, 1)} disabled={idx === rows.length - 1 || busy} aria-label="Descendre" style={iconBtn(th)}>↓</button>
            <button onClick={() => removeRow(idx)} disabled={busy} style={{ ...iconBtn(th), color: '#ff7a4d', marginLeft: 'auto' }}>Supprimer</button>
            <Btn onClick={() => saveRow(idx)} disabled={busy}>{row.id ? 'Enregistrer' : 'Ajouter'}</Btn>
          </div>
        </div>
      ))}

      <div><Btn variant="surface" icon="plus" onClick={addRow}>Nouvelle question</Btn></div>
    </div>
  );
}

const iconBtn = (th: Theme): CSSProperties => ({
  border: `1px solid ${th.line}`, background: th.bg, color: th.text, cursor: 'pointer',
  borderRadius: 9, height: 36, padding: '0 12px', fontSize: 14, fontFamily: 'inherit',
});
