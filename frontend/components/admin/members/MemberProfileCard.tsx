'use client';
// Carte « Profil » du cockpit fiche membre 360 — composant PUR (aucun fetch, aucun
// appel api.* interne) : la page fournit le membre et le callback d'enregistrement.
import { useEffect, useState, CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { MemberHistory, UpdateMemberBody } from '@/lib/api';

export interface ProfileDraft {
  firstName: string; lastName: string; phone: string; address: string; postalCode: string; city: string;
  birthDate: string; sex: 'MALE' | 'FEMALE' | ''; membershipNo: string;
}

export function draftFromMember(m: MemberHistory['member']): ProfileDraft {
  return {
    firstName: m.firstName, lastName: m.lastName, phone: m.phone ?? '',
    address: m.address ?? '', postalCode: m.postalCode ?? '', city: m.city ?? '',
    birthDate: m.birthDate ?? '', sex: m.sex ?? '', membershipNo: m.membershipNo ?? '',
  };
}

export function bodyFromDraft(d: ProfileDraft): UpdateMemberBody {
  return {
    firstName: d.firstName.trim(), lastName: d.lastName.trim(),
    phone: d.phone.trim() || null, address: d.address.trim() || null,
    postalCode: d.postalCode.trim() || null, city: d.city.trim() || null,
    birthDate: d.birthDate || null, sex: d.sex || null, membershipNo: d.membershipNo.trim() || null,
  };
}

export function MemberProfileCard({ member, onSave, error }: {
  member: MemberHistory['member'];
  onSave: (body: UpdateMemberBody) => Promise<void>;
  error: string | null;
}) {
  const { th } = useTheme();
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromMember(member));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(draftFromMember(member)); }, [member.userId]);

  const input: CSSProperties = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 9, padding: '9px 10px', fontFamily: th.fontUI, fontSize: 14, width: '100%' };
  const label: CSSProperties = { fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.3, display: 'block', margin: '10px 0 4px' };
  const set = (k: keyof ProfileDraft, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const save = async () => { setBusy(true); try { await onSave(bodyFromDraft(draft)); } finally { setBusy(false); } };

  return (
    <section aria-label="Profil" style={{ background: th.surface, borderRadius: 18, padding: 18, boxShadow: th.shadow }}>
      <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 16, margin: 0, color: th.text }}>Profil</h2>
      {error && <div style={{ marginTop: 8, fontFamily: th.fontUI, fontSize: 12.5, color: th.danger }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}><span style={label}>Prénom</span><input aria-label="Prénom" value={draft.firstName} onChange={(e) => set('firstName', e.target.value)} style={input} /></div>
        <div style={{ flex: 1 }}><span style={label}>Nom</span><input aria-label="Nom" value={draft.lastName} onChange={(e) => set('lastName', e.target.value)} style={input} /></div>
      </div>
      <span style={label}>Téléphone</span><input aria-label="Téléphone" value={draft.phone} onChange={(e) => set('phone', e.target.value)} style={input} />
      <span style={label}>Adresse</span><input aria-label="Adresse" value={draft.address} onChange={(e) => set('address', e.target.value)} style={input} />
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: '0 0 34%' }}><span style={label}>Code postal</span><input aria-label="Code postal" value={draft.postalCode} onChange={(e) => set('postalCode', e.target.value)} style={input} /></div>
        <div style={{ flex: 1 }}><span style={label}>Ville</span><input aria-label="Ville" value={draft.city} onChange={(e) => set('city', e.target.value)} style={input} /></div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}><span style={label}>Naissance</span><input aria-label="Date de naissance" type="date" value={draft.birthDate} onChange={(e) => set('birthDate', e.target.value)} style={input} /></div>
        <div style={{ flex: 1 }}>
          <span style={label}>Sexe</span>
          <select aria-label="Sexe" value={draft.sex} onChange={(e) => set('sex', e.target.value as ProfileDraft['sex'])} style={input}>
            <option value="">—</option><option value="MALE">Homme</option><option value="FEMALE">Femme</option>
          </select>
        </div>
      </div>
      <span style={label}>N° licence / adhérent</span><input aria-label="N° licence / adhérent" value={draft.membershipNo} onChange={(e) => set('membershipNo', e.target.value)} style={input} />
      <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, marginTop: 8 }}>L&apos;email ({member.email}) ne peut être modifié que par le joueur.</div>
      <button onClick={save} disabled={busy} style={{ width: '100%', border: 'none', cursor: busy ? 'default' : 'pointer', borderRadius: 11, padding: 11, marginTop: 10, fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, background: th.accent, color: th.onAccent, opacity: busy ? 0.5 : 1 }}>
        {busy ? 'Enregistrement…' : 'Enregistrer'}
      </button>
    </section>
  );
}
