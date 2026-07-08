'use client';
import { useState, useEffect, useCallback, useMemo, CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { api, Member } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { Pill } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { StaffRole } from '@/components/admin/StaffRoleMenu';
import { MemberRow } from '@/components/admin/members/MemberRow';
import { MemberPanel, MemberDraft } from '@/components/admin/members/MemberPanel';
import { AddMemberDialog } from '@/components/admin/members/AddMemberDialog';
import {
  MemberSeg, MemberSort, filterMembers, segCounts, sortMembers, memberKpis, membersCsv,
} from '@/lib/members';

const STAFF_ERRORS: Record<string, string> = {
  CANNOT_CHANGE_OWNER: 'Le rôle du gérant ne peut pas être modifié.',
  CANNOT_CHANGE_SELF:  'Vous ne pouvez pas modifier votre propre rôle.',
  MEMBER_IS_STAFF:     'Ce membre a un rôle staff : retirez d\'abord son rôle (bouton « Rôle… ») avant de le supprimer.',
};

const CORAL = '#ff7a4d';

export default function AdminMembersPage() {
  const { th } = useTheme();
  const router = useRouter();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;
  const isDesktop = useIsDesktop(900);

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [query, setQuery]     = useState('');
  const [seg, setSeg]         = useState<MemberSeg>('all');
  const [sort, setSort]       = useState<MemberSort>('name');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<Member | null>(null);
  const [nowMs, setNowMs] = useState(0);

  // Viewer (gestion staff réservée OWNER/ADMIN ; jamais sur sa propre ligne).
  const [viewer, setViewer] = useState<{ userId: string; role: 'OWNER' | 'ADMIN' | 'STAFF' } | null>(null);
  const canManageStaff = viewer !== null && (viewer.role === 'OWNER' || viewer.role === 'ADMIN');

  useEffect(() => {
    if (!ready || !token || !clubId) return;
    Promise.all([api.getMyClubs(token), api.getMyProfile(token)])
      .then(([clubs, me]) => {
        const mine = clubs.find((c) => c.clubId === clubId);
        setViewer(mine ? { userId: me.id, role: mine.role } : null);
      })
      .catch(() => setViewer(null));
  }, [ready, token, clubId]);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try { setError(null); setMembers(await api.adminGetMembers(clubId, token)); setNowMs(Date.now()); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, clubId]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  const searchAll = useMemo(() => filterMembers(members, query, 'all'), [members, query]);
  const counts = useMemo(() => segCounts(searchAll), [searchAll]);
  const visible = useMemo(() => sortMembers(filterMembers(members, query, seg), sort), [members, query, seg, sort]);
  const kpis = useMemo(() => memberKpis(members, nowMs), [members, nowMs]);

  const selected = useMemo(() => members.find((m) => m.userId === selectedUserId) ?? null, [members, selectedUserId]);

  const save = async (draft: MemberDraft) => {
    if (!token || !clubId || !selected) return;
    try {
      setError(null);
      await api.adminUpdateMember(clubId, selected.id, { phone: draft.phone, membershipNo: draft.membershipNo, note: draft.note, isSubscriber: draft.isSubscriber }, token);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const toggleBlocked = async () => {
    if (!token || !clubId || !selected) return;
    try { setError(null); await api.adminSetMemberBlocked(clubId, selected.id, selected.status !== 'BLOCKED', token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  const setRole = async (role: StaffRole) => {
    if (!token || !clubId || !selected) return;
    if ((selected.staffRole ?? null) === role) return;
    try { setError(null); await api.adminSetMemberStaffRole(clubId, selected.userId, role, token); await load(); }
    catch (e) { const msg = (e as Error).message; setError(STAFF_ERRORS[msg] ?? msg); }
  };

  const remove = async (m: Member) => {
    if (!token || !clubId) return;
    try { setError(null); await api.adminRemoveMember(clubId, m.id, token); setConfirmRemove(null); await load(); }
    catch (e) { const msg = (e as Error).message; setError(STAFF_ERRORS[msg] ?? msg); setConfirmRemove(null); }
  };

  const exportCsv = () => {
    const blob = new Blob([membersCsv(visible, nowMs)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `membres-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const searchInput: CSSProperties = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 10, padding: '0 10px', fontFamily: th.fontUI, fontSize: 14, height: 40, width: '100%' };
  const toolBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 14px', borderRadius: 10, border: `1px solid ${th.line}`, background: th.surface, color: th.text, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap' };

  const kpiStat = (label: string, value: number, color: string) => (
    <div style={{ padding: '2px 14px', minWidth: 74 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.05, marginTop: 2, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
  const kpiSep = <div style={{ width: 1, alignSelf: 'stretch', background: th.line, margin: '4px 0' }} />;

  const SEG_OPTS: { value: MemberSeg; label: string; n: number }[] = [
    { value: 'all', label: 'Tous', n: counts.all },
    { value: 'subs', label: 'Abonnés', n: counts.subs },
    { value: 'staff', label: 'Staff', n: counts.staff },
    { value: 'watch', label: 'À surveiller', n: counts.watch },
    { value: 'blocked', label: 'Bloqués', n: counts.blocked },
  ];

  return (
    <div>
      {/* Titre + bandeau KPI */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', margin: '0 0 6px' }}>
        <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: 0, color: th.text }}>Membres</h1>
        {!loading && members.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', background: th.surface, borderRadius: 14, boxShadow: `inset 0 0 0 1px ${th.line}`, padding: '6px 2px' }}>
            {kpiStat('Membres', kpis.total, th.text)}
            {kpiSep}
            {kpiStat('Abonnés', kpis.subscribers, th.accent)}
            {kpiSep}
            {kpiStat('Actifs 30 j', kpis.activeRecent, th.mode === 'floodlit' ? th.accent : th.text)}
            {kpiSep}
            {kpiStat('Bloqués', kpis.blocked, kpis.blocked > 0 ? CORAL : th.textFaint)}
          </div>
        )}
      </div>
      <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: '0 0 20px' }}>
        Le fichier-membres de votre club. Être membre (non bloqué) permet de réserver. « Abonné » ouvre la fenêtre de réservation élargie (voir Réglages).
      </p>

      {error && !selected && (
        <div style={{ marginBottom: 16, background: th.accent, color: th.onAccent, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ padding: '32px 0', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
      ) : (
        <>
          {/* Toolbar */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 340 }}>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un membre (nom, email, tél., n° adhérent)…" aria-label="Rechercher un membre" style={{ ...searchInput, paddingRight: query ? 30 : 10 }} />
              {query && <button onClick={() => setQuery('')} aria-label="Effacer la recherche" style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>}
            </div>
            <select value={sort} onChange={(e) => setSort(e.target.value as MemberSort)} aria-label="Trier" style={{ ...toolBtn, appearance: 'auto' }}>
              <option value="name">Nom A–Z</option>
              <option value="recent">Plus récents</option>
              <option value="activity">Dernière activité</option>
            </select>
            <button onClick={exportCsv} disabled={visible.length === 0} style={{ ...toolBtn, opacity: visible.length === 0 ? 0.5 : 1, cursor: visible.length === 0 ? 'default' : 'pointer' }}>
              <Icon name="download" size={16} color={th.text} />Exporter CSV
            </button>
            <button onClick={() => setAddOpen(true)} style={{ ...toolBtn, background: th.accent, color: th.onAccent, border: 'none' }}>
              <Icon name="plus" size={17} color={th.onAccent} />Ajouter un membre
            </button>
          </div>

          {/* Segments */}
          <div className="sp-scroll-x" style={{ display: 'flex', gap: 8, marginBottom: 16, paddingBottom: 2 }}>
            {SEG_OPTS.map((o) => (
              <Pill key={o.value} label={`${o.label} · ${o.n}`} active={seg === o.value} size="sm" onClick={() => setSeg(o.value)} />
            ))}
          </div>

          {/* Liste + panneau */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8 }}>
              {visible.length === 0 ? (
                <div style={{ padding: '28px 14px', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>
                  {members.length === 0 ? "Aucun membre pour l'instant." : `Aucun membre ne correspond${query.trim() ? ` à « ${query.trim()} »` : ''}.`}
                </div>
              ) : (
                visible.map((m) => (
                  <MemberRow key={m.id} m={m} nowMs={nowMs} selected={selectedUserId === m.userId}
                    onOpen={() => setSelectedUserId(m.userId)}
                    onNavigate={() => router.push(`/admin/members/${m.userId}`)} />
                ))
              )}
              {query.trim() && visible.length > 0 && (
                <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint, padding: '2px 4px' }}>{visible.length} sur {members.length}</div>
              )}
            </div>

            {selected && isDesktop && (
              <MemberPanel member={selected} viewer={viewer} canManageStaff={canManageStaff} isDesktop error={error}
                onSave={save} onToggleBlocked={toggleBlocked} onSetRole={setRole} onDelete={() => setConfirmRemove(selected)} onClose={() => setSelectedUserId(null)} />
            )}
          </div>
        </>
      )}

      {selected && !isDesktop && (
        <MemberPanel member={selected} viewer={viewer} canManageStaff={canManageStaff} isDesktop={false} error={error}
          onSave={save} onToggleBlocked={toggleBlocked} onSetRole={setRole} onDelete={() => setConfirmRemove(selected)} onClose={() => setSelectedUserId(null)} />
      )}

      {addOpen && token && clubId && (
        <AddMemberDialog clubId={clubId} token={token} onClose={() => setAddOpen(false)} onAdded={load} />
      )}

      {confirmRemove && (
        <ConfirmDialog
          title="Supprimer ce membre ?"
          detail={<>{confirmRemove.firstName} {confirmRemove.lastName} · {confirmRemove.email}</>}
          message="Le membre est retiré du fichier (ses réservations existantes sont conservées). Il pourra re-rejoindre automatiquement en réservant. Pour couper l'accès durablement, utilisez plutôt « Bloquer »."
          confirmLabel="Supprimer"
          cancelLabel="Retour"
          onConfirm={() => remove(confirmRemove)}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
}
