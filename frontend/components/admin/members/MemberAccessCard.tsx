'use client';
// Carte « Rôle & accès » du cockpit fiche membre 360 — composant PUR (aucun fetch),
// reprend les contrôles de l'ex-MemberPanel (rôle staff, coach, J/A, abonné, bloquer, supprimer).
import { CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { MemberHistory } from '@/lib/api';
import { Segmented } from '@/components/ui/atoms';
import { STAFF_LABEL, StaffRole } from '@/lib/members';

type RoleSeg = 'NONE' | 'STAFF' | 'ADMIN';
const toSeg = (r: MemberHistory['member']['staffRole']): RoleSeg => (r === 'ADMIN' ? 'ADMIN' : r === 'STAFF' ? 'STAFF' : 'NONE');
const fromSeg = (s: RoleSeg): StaffRole => (s === 'NONE' ? null : s);
const ROLE_HINT: Record<RoleSeg, string> = {
  NONE: "Membre simple, pas d'accès au back-office",
  STAFF: 'Comptoir & quotidien (planning, caisse, membres, annonces)',
  ADMIN: 'Staff + structure du club (réglages, terrains, offres, comptabilité, staff, niveaux)',
};

export function MemberAccessCard({ member, viewer, canManageStaff, onSetRole, onSetCoach, onSetReferee, onSetSubscriber, onToggleBlocked, onDelete }: {
  member: MemberHistory['member'];
  viewer: { userId: string } | null;
  canManageStaff: boolean;
  onSetRole: (role: StaffRole) => void;
  onSetCoach: (v: boolean) => void;
  onSetReferee: (v: boolean) => void;
  onSetSubscriber: (v: boolean) => void;
  onToggleBlocked: () => void;
  onDelete: () => void;
}) {
  const { th } = useTheme();
  const blocked = member.status === 'BLOCKED';
  const canEditRole = canManageStaff && viewer != null && member.staffRole !== 'OWNER' && member.userId !== viewer.userId;
  const ghost: CSSProperties = { border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 10, padding: '9px 13px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute };
  const check: CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 14, color: th.text };

  return (
    <section aria-label="Rôle et accès" style={{ background: th.surface, borderRadius: 18, padding: 18, boxShadow: th.shadow, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 16, margin: 0, color: th.text }}>Rôle &amp; accès</h2>
      {canManageStaff && (canEditRole ? (
        <>
          <Segmented<RoleSeg> value={toSeg(member.staffRole)} onChange={(s) => onSetRole(fromSeg(s))}
            options={[{ value: 'NONE', label: 'Membre' }, { value: 'STAFF', label: 'Staff' }, { value: 'ADMIN', label: 'Admin' }]} />
          <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>{ROLE_HINT[toSeg(member.staffRole)]}</span>
        </>
      ) : (
        <span style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text }}>{member.staffRole ? STAFF_LABEL[member.staffRole] : 'Membre'}</span>
      ))}
      {canManageStaff && (
        <>
          <label style={check}><input type="checkbox" checked={member.isCoach} onChange={(e) => onSetCoach(e.target.checked)} style={{ width: 18, height: 18, accentColor: th.accent }} /> Coach — anime des cours</label>
          <label style={check}><input type="checkbox" checked={member.isReferee} onChange={(e) => onSetReferee(e.target.checked)} style={{ width: 18, height: 18, accentColor: th.accent }} /> Juge-arbitre — pilote des tournois</label>
        </>
      )}
      <label style={check}><input type="checkbox" checked={member.isSubscriber} onChange={(e) => onSetSubscriber(e.target.checked)} style={{ width: 18, height: 18, accentColor: th.accent }} /> Abonné (fenêtre de réservation élargie)</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: `1px solid ${th.line}`, paddingTop: 12 }}>
        <button onClick={onToggleBlocked} style={ghost}>{blocked ? 'Débloquer' : 'Bloquer'}</button>
        <button onClick={onDelete} style={{ ...ghost, color: ACCENTS.coral, marginLeft: 'auto' }}>Supprimer le membre</button>
      </div>
    </section>
  );
}
