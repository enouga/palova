'use client';
import { useState, useEffect, CSSProperties } from 'react';
import Link from 'next/link';
import { useTheme } from '@/lib/ThemeProvider';
import { Member } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { colorForSeed } from '@/lib/playerColors';
import { STAFF_LABEL } from '@/lib/members';
import { StaffRoleMenu, StaffRole } from '@/components/admin/StaffRoleMenu';

export interface MemberDraft { phone: string; membershipNo: string; note: string; isSubscriber: boolean }

export function MemberPanel({ member, viewer, canManageStaff, isDesktop, error, onSave, onToggleBlocked, onSetRole, onDelete, onClose }: {
  member: Member;
  viewer: { userId: string; role: 'OWNER' | 'ADMIN' | 'STAFF' } | null;
  canManageStaff: boolean;
  isDesktop: boolean;
  error: string | null;
  onSave: (draft: MemberDraft) => Promise<void>;
  onToggleBlocked: () => void;
  onSetRole: (role: StaffRole) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { th } = useTheme();
  const [draft, setDraft] = useState<MemberDraft>({ phone: '', membershipNo: '', note: '', isSubscriber: false });
  const [busy, setBusy] = useState(false);
  const [roleAnchor, setRoleAnchor] = useState<{ top: number; bottom: number; right: number } | null>(null);

  // Reset du brouillon quand on change de membre (le panneau est réutilisé en place).
  useEffect(() => {
    setDraft({ phone: member.phone ?? '', membershipNo: member.membershipNo ?? '', note: member.note ?? '', isSubscriber: member.isSubscriber });
    setRoleAnchor(null);
  }, [member.userId, member.phone, member.membershipNo, member.note, member.isSubscriber]);

  const blocked = member.status === 'BLOCKED';
  const showRole = canManageStaff && viewer && member.staffRole !== 'OWNER' && member.userId !== viewer.userId;

  const input: CSSProperties = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 9, padding: '9px 10px', fontFamily: th.fontUI, fontSize: 14, width: '100%' };
  const label: CSSProperties = { fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.3, display: 'block', marginBottom: 5 };
  const ghostBtn: CSSProperties = { border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 10, padding: '9px 13px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute };

  const save = async () => { setBusy(true); try { await onSave(draft); } finally { setBusy(false); } };

  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header identité */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Avatar firstName={member.firstName} lastName={member.lastName} avatarUrl={member.avatarUrl ?? null} size={46} color={colorForSeed(member.userId)} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 19, color: th.text, lineHeight: 1.15 }}>{member.firstName} {member.lastName}</div>
          <div style={{ fontSize: 12.5, color: th.textMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.email}</div>
        </div>
        {!isDesktop && (
          <button onClick={onClose} aria-label="Fermer" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 22, lineHeight: 1, padding: 4 }}>×</button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {member.staffRole && <Chip tone="accent">{STAFF_LABEL[member.staffRole]}</Chip>}
        {member.hasActivePackage && <Chip tone="line">Carnet actif</Chip>}
        <Chip tone={blocked ? 'line' : 'accent'}>{blocked ? 'Bloqué' : 'Actif'}</Chip>
      </div>

      <Link href={`/admin/members/${member.userId}`} style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.accent, textDecoration: 'none' }}>
        Voir la fiche complète →
      </Link>

      {error && <div style={{ background: th.accent, color: th.onAccent, borderRadius: 10, padding: '9px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>{error}</div>}

      {/* Champs éditables */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div><span style={label}>Téléphone</span><input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="—" style={input} /></div>
        <div><span style={label}>N° adhérent</span><input value={draft.membershipNo} onChange={(e) => setDraft({ ...draft, membershipNo: e.target.value })} placeholder="—" style={input} /></div>
        <div><span style={label}>Note</span><textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="—" rows={2} style={{ ...input, resize: 'vertical' }} /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
          <input type="checkbox" checked={draft.isSubscriber} onChange={(e) => setDraft({ ...draft, isSubscriber: e.target.checked })} style={{ width: 18, height: 18, accentColor: th.accent, cursor: 'pointer' }} />
          Abonné (fenêtre de réservation élargie)
        </label>
      </div>

      <button onClick={save} disabled={busy} style={{ border: 'none', cursor: busy ? 'default' : 'pointer', borderRadius: 11, padding: '11px', fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, background: th.accent, color: th.onAccent, opacity: busy ? 0.5 : 1 }}>
        {busy ? 'Enregistrement…' : 'Enregistrer'}
      </button>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: `1px solid ${th.line}`, paddingTop: 14 }}>
        <button onClick={onToggleBlocked} style={ghostBtn}>{blocked ? 'Débloquer' : 'Bloquer'}</button>
        {showRole && (
          <button
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setRoleAnchor(roleAnchor ? null : { top: r.top, bottom: r.bottom, right: r.right }); }}
            onMouseDown={(e) => e.stopPropagation()}
            aria-haspopup="menu" aria-expanded={!!roleAnchor}
            aria-label={`Rôle staff de ${member.firstName} ${member.lastName}`}
            style={ghostBtn}
          >Rôle…</button>
        )}
        <button onClick={onDelete} style={{ ...ghostBtn, color: '#ff7a4d', marginLeft: 'auto' }}>Supprimer le membre</button>
      </div>

      {roleAnchor && (
        <StaffRoleMenu
          current={(member.staffRole ?? null) as StaffRole}
          anchor={roleAnchor}
          onPick={(r) => { setRoleAnchor(null); onSetRole(r); }}
          onClose={() => setRoleAnchor(null)}
        />
      )}
    </div>
  );

  if (isDesktop) {
    return (
      <div style={{ flex: '0 0 360px', alignSelf: 'flex-start', position: 'sticky', top: 12, background: th.surface, borderRadius: 18, boxShadow: `inset 0 0 0 1px ${th.line}`, padding: 18 }}>
        {body}
      </div>
    );
  }
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 40, background: th.bg, overflowY: 'auto', padding: 18, animation: 'sp-sheet-in .25s ease' }}>
      {body}
    </div>
  );
}
