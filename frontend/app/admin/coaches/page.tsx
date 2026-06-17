'use client';
import { useState, useEffect, useCallback, CSSProperties } from 'react';
import { api, Coach, CoachBody } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';

const EMPTY = { name: '', bio: '', sortOrder: '0', isActive: true };

export default function AdminCoachesPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;
  const [items, setItems]   = useState<Coach[]>([]);
  const [form, setForm]     = useState(EMPTY);
  const [editId, setEditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const labelStyle: CSSProperties = { fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 6 };
  const inputStyle: CSSProperties = { height: 46, padding: '0 14px', borderRadius: 12, background: th.bg, color: th.text, border: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 15 };

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try { setError(null); setItems(await api.adminListCoaches(clubId, token)); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, clubId]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  const resetForm = () => { setForm(EMPTY); setEditId(null); };

  const submit = async () => {
    if (!token || !clubId || !form.name.trim()) return;
    setSaving(true);
    const body: CoachBody = {
      name: form.name.trim(),
      bio: form.bio.trim() || null,
      sortOrder: Number.parseInt(form.sortOrder, 10) || 0,
      isActive: form.isActive,
    };
    try {
      setError(null);
      if (editId) await api.adminUpdateCoach(clubId, editId, body, token);
      else        await api.adminCreateCoach(clubId, body, token);
      resetForm();
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  const startEdit = (c: Coach) => {
    setEditId(c.id);
    setForm({ name: c.name, bio: c.bio ?? '', sortOrder: String(c.sortOrder), isActive: c.isActive });
  };

  const remove = async (c: Coach) => {
    if (!token || !clubId) return;
    if (!confirm(`Désactiver le coach « ${c.name} » ?`)) return;
    try { await api.adminDeleteCoach(clubId, c.id, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, color: th.text, margin: '0 0 18px' }}>Coachs</h1>

      {error && <div style={{ marginBottom: 14, background: '#ff7a4d', color: '#fff', borderRadius: 12, padding: '10px 13px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>{error}</div>}

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr', background: th.surface, borderRadius: 16, padding: 18, marginBottom: 22 }}>
        <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>Nom
          <input style={inputStyle} value={form.name} placeholder="Nom du coach" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </label>
        <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>Bio (optionnel)
          <input style={inputStyle} value={form.bio} placeholder="Spécialité, diplômes…" onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} />
        </label>
        <label style={labelStyle}>Ordre
          <input style={inputStyle} type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'end', fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text }}>
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} /> Actif
        </label>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10 }}>
          <Btn type="button" icon="check" onClick={submit} disabled={saving || !form.name.trim()}>
            {saving ? '…' : editId ? 'Enregistrer' : 'Ajouter le coach'}
          </Btn>
          {editId && <button type="button" onClick={resetForm} style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.text, borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontFamily: th.fontUI, fontWeight: 600 }}>Annuler</button>}
        </div>
      </div>

      {loading ? <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Chargement…</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: th.surface, borderRadius: 12, padding: '12px 16px', opacity: c.isActive ? 1 : 0.5 }}>
              <div style={{ flex: 1, fontFamily: th.fontUI, fontWeight: 600, color: th.text }}>
                {c.name}{!c.isActive && <span style={{ marginLeft: 8, fontSize: 12, color: th.textMute }}>(inactif)</span>}
                {c.bio && <div style={{ fontSize: 12.5, fontWeight: 400, color: th.textMute }}>{c.bio}</div>}
              </div>
              <button type="button" onClick={() => startEdit(c)} style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.text, borderRadius: 9, padding: '6px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>Modifier</button>
              {c.isActive && <button type="button" onClick={() => remove(c)} style={{ border: 'none', background: th.surface2, color: th.textMute, borderRadius: 9, padding: '6px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>Désactiver</button>}
            </div>
          ))}
          {items.length === 0 && <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucun coach pour l&apos;instant.</div>}
        </div>
      )}
    </div>
  );
}
