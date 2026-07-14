'use client';
import { useState, CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/lib/ThemeProvider';
import { Member, MemberHistory } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/atoms';
import { colorForSeed } from '@/lib/playerColors';
import { STAFF_LABEL } from '@/lib/members';
import { fmtEuros } from '@/lib/caisse';
import { openDm } from '@/lib/messages';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { StaffRoleMenu, StaffRole } from '@/components/admin/StaffRoleMenu';

const CORAL = '#ff7a4d';
const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

export function CockpitHeader({ member, history, watch, unpaidCents, canManageStaff, viewerUserId, onToggleWatch, onToggleBlocked, onSetRole, onDelete, onCollect, onClose }: {
  member: Member;
  history: MemberHistory;
  watch: boolean;
  unpaidCents: number;
  canManageStaff: boolean;
  viewerUserId: string | null;
  onToggleWatch: () => void;
  onToggleBlocked: () => void;
  onSetRole: (role: StaffRole) => void;
  onDelete: () => void;
  onCollect: () => void;          // scrolle vers la carte Argent
  onClose?: () => void;           // mobile : bouton retour
}) {
  const { th } = useTheme();
  const router = useRouter();
  const isDesktop = useIsDesktop(900);
  const [menuOpen, setMenuOpen] = useState(false);
  const [roleAnchor, setRoleAnchor] = useState<{ top: number; bottom: number; right: number } | null>(null);

  const m = history.member;
  const blocked = member.status === 'BLOCKED';
  const showRole = canManageStaff && member.staffRole !== 'OWNER' && member.userId !== viewerUserId;

  const actionBtn: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', cursor: 'pointer',
    borderRadius: 999, padding: '8px 14px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700,
  };
  const menuItem: CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent',
    cursor: 'pointer', padding: '9px 14px', fontFamily: th.fontUI, fontSize: 13.5, color: th.text,
  };

  const contact = [m.email, m.phone, m.membershipNo ? `n° ${m.membershipNo}` : null].filter(Boolean).join(' · ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {onClose && (
          <button onClick={onClose} aria-label="Retour à la liste" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 22, lineHeight: 1, padding: 4 }}>←</button>
        )}
        <Avatar firstName={m.firstName} lastName={m.lastName} avatarUrl={m.avatarUrl} size={52} color={colorForSeed(m.userId)} />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 24, letterSpacing: -0.4, color: th.text }}>{m.firstName} {m.lastName}</span>
            {member.staffRole && <Chip tone="accent">{STAFF_LABEL[member.staffRole]}</Chip>}
            {(member.isSubscriber || member.hasActiveSubscription) && (
              <Chip tone="accent">{member.subscriptionPlan ? `Abonné · ${member.subscriptionPlan}` : 'Abonné'}</Chip>
            )}
            {m.hasActivePackage && <Chip tone="line">Carnet</Chip>}
            {blocked && <Chip tone="line">Bloqué</Chip>}
            {watch && <span title="À surveiller" style={{ fontSize: 15 }}>👁</span>}
          </div>
          <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {contact} · membre depuis {fmtDate(m.since)}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', position: 'relative' }}>
        {unpaidCents > 0 && (
          <button onClick={onCollect} style={{ ...actionBtn, background: CORAL, color: '#fff' }}>
            💶 Encaisser {fmtEuros(unpaidCents)}
          </button>
        )}
        <button
          onClick={() => openDm(member.userId, { isDesktop, navigate: (href) => router.push(href) })}
          style={{ ...actionBtn, background: th.accent, color: th.onAccent }}
        >💬 Message</button>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Plus d'actions"
          style={{ ...actionBtn, background: th.surface, color: th.text, boxShadow: `inset 0 0 0 1px ${th.line}` }}
        >⋯</button>

        {menuOpen && (
          <>
            <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
            <div role="menu" style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 31, background: th.surface, borderRadius: 12, boxShadow: th.shadow, minWidth: 220, padding: '6px 0' }}>
              <button role="menuitem" style={menuItem} onClick={() => { setMenuOpen(false); onToggleWatch(); }}>
                👁 {watch ? 'Ne plus surveiller' : 'Marquer à surveiller'}
              </button>
              <button role="menuitem" style={menuItem} onClick={() => { setMenuOpen(false); onToggleBlocked(); }}>
                {blocked ? 'Débloquer' : 'Bloquer'}
              </button>
              {showRole && (
                <button
                  role="menuitem" style={menuItem}
                  aria-label={`Rôle staff de ${m.firstName} ${m.lastName}`}
                  onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenuOpen(false); setRoleAnchor({ top: r.top, bottom: r.bottom, right: r.right }); }}
                >Rôle…</button>
              )}
              <button role="menuitem" style={{ ...menuItem, color: CORAL }} onClick={() => { setMenuOpen(false); onDelete(); }}>
                Supprimer le membre
              </button>
            </div>
          </>
        )}

        {roleAnchor && (
          <StaffRoleMenu
            current={(member.staffRole ?? null) as StaffRole}
            anchor={roleAnchor}
            onPick={(r) => { setRoleAnchor(null); onSetRole(r); }}
            onClose={() => setRoleAnchor(null)}
          />
        )}
      </div>
    </div>
  );
}
