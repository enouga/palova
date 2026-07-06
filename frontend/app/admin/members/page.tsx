'use client';
import { useState, useEffect, useCallback, useMemo, CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { api, Member } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn, Chip } from '@/components/ui/atoms';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { StaffRoleMenu, StaffRole } from '@/components/admin/StaffRoleMenu';

// minuscules + suppression des accents, pour une recherche tolérante (« benoit » trouve « Benoît »)
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const STAFF_LABEL: Record<'OWNER' | 'ADMIN' | 'STAFF', string> = { OWNER: 'Gérant', ADMIN: 'Admin', STAFF: 'Staff' };
const STAFF_ERRORS: Record<string, string> = {
  CANNOT_CHANGE_OWNER: 'Le rôle du gérant ne peut pas être modifié.',
  CANNOT_CHANGE_SELF:  'Vous ne pouvez pas modifier votre propre rôle.',
  MEMBER_IS_STAFF:     'Ce membre a un rôle staff : retirez d\'abord son rôle (bouton « Rôle… ») avant de le supprimer.',
};

export default function AdminMembersPage() {
  const { th } = useTheme();
  const router = useRouter();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [query, setQuery]     = useState('');

  // recherche locale : tous les membres sont déjà chargés. Chaque mot tapé doit
  // matcher (ET), en sous-chaîne, sur nom complet / email / tél. / N° adhérent.
  const filtered = useMemo(() => {
    const terms = norm(query).split(/\s+/).filter(Boolean);
    if (terms.length === 0) return members;
    return members.filter((m) => {
      const hay = norm(`${m.firstName} ${m.lastName} ${m.email} ${m.phone ?? ''} ${m.membershipNo ?? ''}`);
      return terms.every((t) => hay.includes(t));
    });
  }, [members, query]);

  const [email, setEmail]     = useState('');
  const [adding, setAdding]   = useState(false);
  const [nm, setNm]           = useState({ firstName: '', lastName: '', email: '', phone: '', membershipNo: '' });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null); // message après création
  const [confirmRemove, setConfirmRemove] = useState<Member | null>(null);

  // Gestion du staff : réservée aux viewers OWNER/ADMIN ; jamais sur sa propre ligne.
  const [viewer, setViewer] = useState<{ userId: string; role: 'OWNER' | 'ADMIN' | 'STAFF' } | null>(null);
  // Menu « Rôle… » ouvert : userId + rect du déclencheur (le menu est position:fixed).
  const [roleMenuFor, setRoleMenuFor] = useState<{ userId: string; anchor: { top: number; bottom: number; right: number } } | null>(null);

  useEffect(() => {
    if (!ready || !token || !clubId) return;
    Promise.all([api.getMyClubs(token), api.getMyProfile(token)])
      .then(([clubs, me]) => {
        const mine = clubs.find((c) => c.clubId === clubId);
        setViewer(mine ? { userId: me.id, role: mine.role } : null);
      })
      .catch(() => setViewer(null)); // échec = pas d'action staff (les badges restent)
  }, [ready, token, clubId]);

  const canManageStaff = viewer !== null && (viewer.role === 'OWNER' || viewer.role === 'ADMIN');

  const cell: CSSProperties = { padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, color: th.text };
  const input: CSSProperties = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '6px 8px', fontFamily: th.fontUI, fontSize: 13.5 };
  const label: CSSProperties = { fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 5 };

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try { setError(null); setMembers(await api.adminGetMembers(clubId, token)); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, clubId]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  const editField = (id: string, field: 'phone' | 'membershipNo' | 'note', value: string) =>
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, [field]: value } : m)));

  const toggleSubLocal = (id: string, value: boolean) =>
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, isSubscriber: value } : m)));

  const save = async (m: Member) => {
    if (!token || !clubId) return;
    try {
      setError(null);
      await api.adminUpdateMember(clubId, m.id, {
        phone: m.phone, membershipNo: m.membershipNo, note: m.note, isSubscriber: m.isSubscriber,
      }, token);
      await load();
    } catch (e) { setError(`${m.firstName} ${m.lastName} : ${(e as Error).message}`); }
  };

  const toggleBlocked = async (m: Member) => {
    if (!token || !clubId) return;
    try { setError(null); await api.adminSetMemberBlocked(clubId, m.id, m.status !== 'BLOCKED', token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  const remove = async (m: Member) => {
    if (!token || !clubId) return;
    try { setError(null); await api.adminRemoveMember(clubId, m.id, token); setConfirmRemove(null); await load(); }
    catch (e) { const msg = (e as Error).message; setError(STAFF_ERRORS[msg] ?? msg); setConfirmRemove(null); }
  };

  const setRole = async (m: Member, role: StaffRole) => {
    if (!token || !clubId) return;
    setRoleMenuFor(null);
    if ((m.staffRole ?? null) === role) return;
    try {
      setError(null);
      await api.adminSetMemberStaffRole(clubId, m.userId, role, token);
      await load();
    } catch (e) {
      const msg = (e as Error).message;
      setError(STAFF_ERRORS[msg] ?? msg);
    }
  };

  const addByEmail = async () => {
    if (!token || !clubId || !email.trim()) return;
    setAdding(true);
    try {
      setError(null);
      await api.adminAddMemberByEmail(clubId, email.trim(), token);
      setEmail('');
      await load();
    } catch (e) {
      setError((e as Error).message === 'USER_NOT_FOUND' ? "Aucun compte avec cet email. Utilisez « Créer un membre »." : (e as Error).message);
    } finally { setAdding(false); }
  };

  const create = async () => {
    if (!token || !clubId || !nm.firstName.trim() || !nm.lastName.trim() || !nm.email.trim()) return;
    setCreating(true);
    try {
      setError(null); setCreated(null);
      const r = await api.adminCreateMember(clubId, nm, token);
      setCreated(r.existed
        ? `Compte existant « ${nm.email} » ajouté comme membre.`
        : `Membre créé. Mot de passe temporaire à transmettre : ${r.tempPassword}`);
      setNm({ firstName: '', lastName: '', email: '', phone: '', membershipNo: '' });
      await load();
    } catch (e) {
      setError((e as Error).message === 'VALIDATION_ERROR' ? 'Prénom, nom et email requis.' : (e as Error).message);
    } finally { setCreating(false); }
  };

  return (
    <div>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: '0 0 6px', color: th.text }}>Membres</h1>
      <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: '0 0 22px' }}>
        Le fichier-membres de votre club. Être membre (non bloqué) permet de réserver. Cochez « Abonné » pour la fenêtre de réservation élargie (voir Réglages).
      </p>

      {error && <div style={{ marginBottom: 16, background: th.accent, color: th.onAccent, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

      {/* Recherche */}
      {!loading && members.length > 0 && (
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 240, maxWidth: 360 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un membre (nom, email, tél., n° adhérent)…"
              aria-label="Rechercher un membre"
              style={{ ...input, width: '100%', height: 40, paddingRight: query ? 32 : 8 }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Effacer la recherche"
                style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 18, lineHeight: 1, padding: 4 }}
              >×</button>
            )}
          </div>
          {query.trim() && (
            <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
              {filtered.length} sur {members.length}
            </span>
          )}
        </div>
      )}

      {/* Liste */}
      {loading ? (
        <div style={{ padding: '32px 0', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
      ) : (
        <div style={{ marginBottom: 24, overflowX: 'auto', borderRadius: 18, background: th.surface, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${th.line}`, textAlign: 'left' }}>
                {['Membre', 'Email', 'Tél.', 'N° adhérent', 'Note', 'Abonné', 'Statut', ''].map((h, i) => (
                  <th key={i} style={{ padding: '12px 14px', fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, color: th.textMute }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ ...cell, textAlign: 'center', color: th.textFaint, padding: '28px 14px' }}>
                  {members.length === 0 ? "Aucun membre pour l'instant." : `Aucun membre ne correspond à « ${query.trim()} ».`}
                </td></tr>
              )}
              {filtered.map((m) => (
                <tr key={m.id} style={{ borderBottom: `1px solid ${th.line}`, opacity: m.status === 'BLOCKED' ? 0.55 : 1 }}>
                  <td
                    style={{ ...cell, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer', color: th.accent }}
                    onClick={() => router.push(`/admin/members/${m.userId}`)}
                    role="link"
                    tabIndex={0}
                    aria-label={`Voir le passif de ${m.firstName} ${m.lastName}`}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/admin/members/${m.userId}`); }}
                  >{m.firstName} {m.lastName}{m.watch ? <span title="À surveiller" style={{ marginLeft: 6 }}>👁</span> : null}{m.staffRole ? <span style={{ marginLeft: 8 }}><Chip tone="accent">{STAFF_LABEL[m.staffRole]}</Chip></span> : null}</td>
                  <td style={{ ...cell, color: th.textMute }}>{m.email}</td>
                  <td style={cell}><input value={m.phone ?? ''} onChange={(e) => editField(m.id, 'phone', e.target.value)} placeholder="—" style={{ ...input, width: 110 }} /></td>
                  <td style={cell}><input value={m.membershipNo ?? ''} onChange={(e) => editField(m.id, 'membershipNo', e.target.value)} placeholder="—" style={{ ...input, width: 100 }} /></td>
                  <td style={cell}><input value={m.note ?? ''} onChange={(e) => editField(m.id, 'note', e.target.value)} placeholder="—" style={{ ...input, width: 140 }} /></td>
                  <td style={{ ...cell, textAlign: 'center' }}>
                    <input type="checkbox" checked={m.isSubscriber} onChange={(e) => toggleSubLocal(m.id, e.target.checked)} style={{ width: 17, height: 17, accentColor: th.accent, cursor: 'pointer' }} />
                  </td>
                  <td style={cell}>
                    <Chip tone={m.status === 'BLOCKED' ? 'line' : 'accent'}>{m.status === 'BLOCKED' ? 'Bloqué' : 'Actif'}</Chip>
                  </td>
                  <td style={cell}>
                    <div style={{ display: 'flex', gap: 6, whiteSpace: 'nowrap' }}>
                      <button onClick={() => save(m)} style={{ border: 'none', cursor: 'pointer', borderRadius: 9, padding: '6px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, background: th.accent, color: th.onAccent }}>Enregistrer</button>
                      <button onClick={() => toggleBlocked(m)} style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '6px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute }}>{m.status === 'BLOCKED' ? 'Débloquer' : 'Bloquer'}</button>
                      {canManageStaff && viewer && m.staffRole !== 'OWNER' && m.userId !== viewer.userId && (
                        <>
                          <button
                            onClick={(e) => {
                              const r = e.currentTarget.getBoundingClientRect();
                              setRoleMenuFor(roleMenuFor?.userId === m.userId ? null : { userId: m.userId, anchor: { top: r.top, bottom: r.bottom, right: r.right } });
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            aria-haspopup="menu" aria-expanded={roleMenuFor?.userId === m.userId}
                            aria-label={`Rôle staff de ${m.firstName} ${m.lastName}`}
                            style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '6px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute }}
                          >Rôle…</button>
                          {roleMenuFor?.userId === m.userId && (
                            <StaffRoleMenu
                              current={(m.staffRole ?? null) as StaffRole}
                              anchor={roleMenuFor.anchor}
                              onPick={(r) => setRole(m, r)}
                              onClose={() => setRoleMenuFor(null)}
                            />
                          )}
                        </>
                      )}
                      <button onClick={() => setConfirmRemove(m)} style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '6px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: '#ff7a4d' }}>Suppr.</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {created && (
        <div style={{ marginBottom: 16, background: `${th.accent}22`, color: th.text, borderRadius: 12, padding: '12px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{created}</div>
      )}

      {/* Ajouter par email */}
      <div style={{ background: th.surface, borderRadius: 18, padding: 18, boxShadow: `inset 0 0 0 1px ${th.line}`, marginBottom: 16 }}>
        <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, margin: '0 0 12px', color: th.text }}>Ajouter un membre existant</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ ...label, flex: 1, minWidth: 220 }}>Email d'un compte joueur
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="joueur@exemple.fr" type="email" style={{ ...input, height: 40 }} />
          </label>
          <Btn onClick={addByEmail} icon="plus" disabled={adding || !email.trim()}>{adding ? '…' : 'Ajouter'}</Btn>
        </div>
      </div>

      {/* Créer un membre */}
      <div style={{ background: th.surface, borderRadius: 18, padding: 18, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
        <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, margin: '0 0 12px', color: th.text }}>Créer un membre</h2>
        <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, margin: '0 0 14px' }}>Crée un compte joueur et l'ajoute à votre club. Un mot de passe temporaire vous sera affiché à transmettre.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
          <label style={label}>Prénom<input value={nm.firstName} onChange={(e) => setNm({ ...nm, firstName: e.target.value })} style={{ ...input, height: 40, width: 130 }} /></label>
          <label style={label}>Nom<input value={nm.lastName} onChange={(e) => setNm({ ...nm, lastName: e.target.value })} style={{ ...input, height: 40, width: 130 }} /></label>
          <label style={label}>Email<input type="email" value={nm.email} onChange={(e) => setNm({ ...nm, email: e.target.value })} style={{ ...input, height: 40, width: 200 }} /></label>
          <label style={label}>Tél.<input value={nm.phone} onChange={(e) => setNm({ ...nm, phone: e.target.value })} style={{ ...input, height: 40, width: 120 }} /></label>
          <label style={label}>N° adhérent<input value={nm.membershipNo} onChange={(e) => setNm({ ...nm, membershipNo: e.target.value })} style={{ ...input, height: 40, width: 110 }} /></label>
          <Btn onClick={create} icon="plus" disabled={creating || !nm.firstName.trim() || !nm.lastName.trim() || !nm.email.trim()}>{creating ? 'Création…' : 'Créer'}</Btn>
        </div>
      </div>

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
