'use client';
import { useEffect, useState } from 'react';
import type { Member, CreateMemberBody } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';

export interface PlayerPickerProps {
  members: Member[];
  value: { firstName: string; lastName: string } | null;
  onSelect: (m: Member) => void;
  onClear: () => void;
  onCreate: (body: CreateMemberBody) => Promise<{ tempPassword: string | null; existed: boolean }>;
  placeholder?: string;
}

// "Jean Dupont" → { firstName: 'Jean', lastName: 'Dupont' } ; un seul mot → prénom.
function splitName(q: string): { firstName: string; lastName: string } {
  const parts = q.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export function PlayerPicker({ members, value, onSelect, onClear, onCreate, placeholder }: PlayerPickerProps) {
  const { th } = useTheme();
  const [query, setQuery]           = useState('');
  const [editing, setEditing]       = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm]             = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [creating, setCreating]     = useState(false);
  const [createErr, setCreateErr]   = useState<string | null>(null);
  const [createMsg, setCreateMsg]   = useState<string | null>(null);

  const valueKey = value ? `${value.firstName} ${value.lastName}` : '';
  // Changement de cible (autre résa / réinit) : on repart en mode « chip ».
  useEffect(() => { setEditing(false); setShowCreate(false); }, [valueKey]);

  const showChip = !!value && !editing;

  const matches = !showChip && !showCreate && query.trim().length > 0
    ? members.filter((m) => `${m.firstName} ${m.lastName} ${m.email}`.toLowerCase().includes(query.toLowerCase())).slice(0, 6)
    : [];

  const pick = (m: Member) => { setQuery(''); setEditing(false); setCreateMsg(null); onSelect(m); };

  const openCreate = () => {
    const { firstName, lastName } = splitName(query);
    setForm({ firstName, lastName, email: '', phone: '' });
    setCreateErr(null);
    setShowCreate(true);
  };

  const submitCreate = async () => {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) {
      setCreateErr('Prénom, nom et email sont requis.');
      return;
    }
    setCreating(true);
    try {
      setCreateErr(null);
      const r = await onCreate({
        firstName: form.firstName.trim(),
        lastName:  form.lastName.trim(),
        email:     form.email.trim(),
        phone:     form.phone.trim() || undefined,
      });
      setCreateMsg(r.existed
        ? 'Ce joueur avait déjà un compte — rattaché au club.'
        : `Compte créé — mot de passe temporaire à transmettre : ${r.tempPassword ?? '—'}`);
      setShowCreate(false);
      setEditing(false);
      setQuery('');
    } catch (e) {
      setCreateErr((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const input = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '8px 10px', fontFamily: th.fontUI, fontSize: 14 } as const;

  return (
    <div style={{ position: 'relative' }}>
      {showChip ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${th.line}`, borderRadius: 8, padding: '8px 10px' }}>
          <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14, color: th.text }}>{value!.firstName} {value!.lastName}</span>
          <button type="button" onClick={() => { setEditing(true); setQuery(''); onClear(); }}
            style={{ border: 'none', background: th.surface2, cursor: 'pointer', borderRadius: 8, padding: '3px 8px', color: th.textMute, fontSize: 12 }}>Changer</button>
        </div>
      ) : showCreate ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, border: `1px solid ${th.line}`, borderRadius: 10, padding: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input aria-label="Prénom" placeholder="Prénom" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} style={{ ...input, flex: 1, minWidth: 120 }} />
            <input aria-label="Nom" placeholder="Nom" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} style={{ ...input, flex: 1, minWidth: 120 }} />
          </div>
          <input aria-label="Email" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ ...input, width: '100%', boxSizing: 'border-box' }} />
          <input aria-label="Téléphone" placeholder="Téléphone (optionnel)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={{ ...input, width: '100%', boxSizing: 'border-box' }} />
          {createErr && <div style={{ color: '#ff7a4d', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>{createErr}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={submitCreate} disabled={creating}
              style={{ border: 'none', background: th.accent, color: '#fff', borderRadius: 9, padding: '7px 13px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>{creating ? 'Création…' : 'Créer le joueur'}</button>
            <button type="button" onClick={() => setShowCreate(false)}
              style={{ border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5 }}>Annuler</button>
          </div>
        </div>
      ) : (
        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder ?? 'Rechercher un joueur…'}
          style={{ ...input, width: '100%', boxSizing: 'border-box' }} />
      )}

      {matches.length > 0 && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 10, background: th.surface, border: `1px solid ${th.line}`, borderRadius: 8, marginTop: 4, overflow: 'hidden', boxShadow: th.shadowSoft }}>
          {matches.map((m) => (
            <button key={m.userId} type="button" onClick={() => pick(m)}
              style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', padding: '8px 10px', fontFamily: th.fontUI, fontSize: 13.5, color: th.text }}>
              {m.firstName} {m.lastName} <span style={{ color: th.textFaint }}>· {m.email}</span>
            </button>
          ))}
        </div>
      )}

      {!showChip && !showCreate && (
        <button type="button" onClick={openCreate}
          style={{ marginTop: 6, border: 'none', background: 'transparent', color: th.accent, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, padding: 0 }}>
          + Créer un joueur
        </button>
      )}

      {createMsg && (
        <div style={{ marginTop: 8, background: `${th.accent}22`, color: th.text, borderRadius: 10, padding: '8px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>{createMsg}</div>
      )}
    </div>
  );
}
