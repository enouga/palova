'use client';
import { useState, useEffect, CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { api } from '@/lib/api';
import { Btn, Segmented } from '@/components/ui/atoms';

type Tab = 'existing' | 'new';

// Dialog unifié d'ajout de membre : onglet « Compte existant » (par email) / « Nouveau compte » (création).
export function AddMemberDialog({ clubId, token, onClose, onAdded }: {
  clubId: string;
  token: string;
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  const { th } = useTheme();
  const [tab, setTab] = useState<Tab>('existing');
  const [email, setEmail] = useState('');
  const [nm, setNm] = useState({ firstName: '', lastName: '', email: '', phone: '', membershipNo: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const input: CSSProperties = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 9, padding: '10px 11px', fontFamily: th.fontUI, fontSize: 14, width: '100%' };
  const label: CSSProperties = { fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.3, display: 'block', marginBottom: 5 };

  const addByEmail = async () => {
    if (!email.trim()) return;
    setBusy(true);
    try {
      setErr(null);
      await api.adminAddMemberByEmail(clubId, email.trim(), token);
      await onAdded();
      onClose();
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg === 'USER_NOT_FOUND' ? "Aucun compte avec cet email. Utilisez « Nouveau compte »." : msg);
    } finally { setBusy(false); }
  };

  const create = async () => {
    if (!nm.firstName.trim() || !nm.lastName.trim() || !nm.email.trim()) return;
    setBusy(true);
    try {
      setErr(null); setCreated(null);
      const r = await api.adminCreateMember(clubId, nm, token);
      setCreated(r.existed
        ? `Compte existant « ${nm.email} » ajouté comme membre.`
        : `Membre créé. Mot de passe temporaire à transmettre : ${r.tempPassword}`);
      setNm({ firstName: '', lastName: '', email: '', phone: '', membershipNo: '' });
      await onAdded();
    } catch (e) {
      setErr((e as Error).message === 'VALIDATION_ERROR' ? 'Prénom, nom et email requis.' : (e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8vh 16px 16px', overflowY: 'auto' }}>
      <div role="dialog" aria-modal="true" aria-label="Ajouter un membre" onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 440, background: th.surface, borderRadius: 18, boxShadow: th.shadow, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 20, margin: 0, color: th.text }}>Ajouter un membre</h2>
          <button onClick={onClose} aria-label="Fermer" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 22, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <Segmented<Tab>
            value={tab}
            onChange={(t) => { setTab(t); setErr(null); }}
            options={[{ value: 'existing', label: 'Compte existant' }, { value: 'new', label: 'Nouveau compte' }]}
          />
        </div>

        {err && <div style={{ marginBottom: 12, background: th.accent, color: th.onAccent, borderRadius: 10, padding: '9px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>{err}</div>}
        {created && <div style={{ marginBottom: 12, background: `${th.accent}22`, color: th.text, borderRadius: 10, padding: '10px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, userSelect: 'all' }}>{created}</div>}

        {tab === 'existing' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, margin: 0 }}>Ajoute au club un joueur qui a déjà un compte Palova.</p>
            <div><span style={label}>Email d'un compte joueur</span><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="joueur@exemple.fr" type="email" style={input} /></div>
            <Btn onClick={addByEmail} icon="plus" disabled={busy || !email.trim()} style={{ height: 46 }}>{busy ? '…' : 'Ajouter'}</Btn>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, margin: 0 }}>Crée un compte joueur et l'ajoute au club. Un mot de passe temporaire s'affichera à transmettre.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}><span style={label}>Prénom</span><input value={nm.firstName} onChange={(e) => setNm({ ...nm, firstName: e.target.value })} style={input} /></div>
              <div style={{ flex: 1, minWidth: 0 }}><span style={label}>Nom</span><input value={nm.lastName} onChange={(e) => setNm({ ...nm, lastName: e.target.value })} style={input} /></div>
            </div>
            <div><span style={label}>Email</span><input type="email" value={nm.email} onChange={(e) => setNm({ ...nm, email: e.target.value })} style={input} /></div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}><span style={label}>Téléphone</span><input value={nm.phone} onChange={(e) => setNm({ ...nm, phone: e.target.value })} style={input} /></div>
              <div style={{ flex: 1, minWidth: 0 }}><span style={label}>N° adhérent</span><input value={nm.membershipNo} onChange={(e) => setNm({ ...nm, membershipNo: e.target.value })} style={input} /></div>
            </div>
            <Btn onClick={create} icon="plus" disabled={busy || !nm.firstName.trim() || !nm.lastName.trim() || !nm.email.trim()} style={{ height: 46 }}>{busy ? 'Création…' : 'Créer'}</Btn>
          </div>
        )}
      </div>
    </div>
  );
}
