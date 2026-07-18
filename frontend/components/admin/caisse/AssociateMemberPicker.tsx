'use client';
import { useEffect, useState } from 'react';
import { api, ClubMemberSearchResult, Member, CreateMemberBody, UserLevel } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';

interface Row { id: string; firstName: string; lastName: string; level: UserLevel | null }

/**
 * Sélecteur « associer un membre » de la Caisse express : même liste que l'ajout d'un joueur sur
 * une partie ouverte (annuaire des membres ACTIFS, avatars + niveau) MAIS **sans** la rangée
 * « Mes amis ». On garde l'option « Créer un joueur » (client de passage non encore membre).
 * Repli défensif sur la liste locale `members` si l'annuaire est indisponible : un compte STAFF
 * de comptoir n'a pas forcément d'adhésion active, or `searchClubMembers` exige le caller membre
 * actif (sinon MEMBERSHIP_REQUIRED) — l'association doit rester possible dans tous les cas.
 */
export function AssociateMemberPicker({ slug, token, excludeIds, members, onSelect, onCancel, onCreate, busy = false }: {
  slug: string;
  token: string;
  /** Ids (userId) à masquer : titulaire + participants déjà présents. */
  excludeIds: string[];
  /** Repli local (membres du club chargés par la page) si l'annuaire échoue. */
  members: Member[];
  onSelect: (userId: string) => void;
  onCancel: () => void;
  onCreate: (body: CreateMemberBody) => Promise<{ tempPassword: string | null; existed: boolean; userId: string }>;
  /** requête d'association en cours (sélection existante OU création) : désactive la liste, feedback immédiat. */
  busy?: boolean;
}) {
  const { th } = useTheme();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ClubMemberSearchResult[]>([]);
  const [fellBack, setFellBack] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  // Ligne cliquée : feedback immédiat (avant même la résolution réseau), remis à zéro
  // dès que le parent n'est plus busy (succès → composant démonté ; échec → réessai possible).
  const [pickedId, setPickedId] = useState<string | null>(null);
  useEffect(() => { if (!busy) setPickedId(null); }, [busy]);

  // Annuaire des membres actifs (mêmes API que PartnerSearch / AddPlayerSheet), débounce 250 ms ;
  // vide → liste complète. Un échec (MEMBERSHIP_REQUIRED…) bascule sur le repli local.
  useEffect(() => {
    if (showCreate) return;
    const query = q.trim();
    const handle = setTimeout(() => {
      api.searchClubMembers(slug, query, token)
        .then((r) => { setResults(r); setFellBack(false); })
        .catch(() => setFellBack(true));
    }, query ? 250 : 0);
    return () => clearTimeout(handle);
  }, [q, slug, token, showCreate]);

  const ql = q.trim().toLowerCase();
  const rows: Row[] = fellBack
    ? members
        .filter((m) => m.status === 'ACTIVE' && !excludeIds.includes(m.userId) && (!ql || `${m.firstName} ${m.lastName}`.toLowerCase().includes(ql)))
        .slice(0, 20)
        .map((m) => ({ id: m.userId, firstName: m.firstName, lastName: m.lastName, level: null }))
    : results
        .filter((m) => !excludeIds.includes(m.id))
        .map((m) => ({ id: m.id, firstName: m.firstName, lastName: m.lastName, level: m.level ?? null }));

  const input = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '8px 10px', fontFamily: th.fontUI, fontSize: 14 } as const;

  const submitCreate = async () => {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) { setCreateErr('Prénom, nom et email sont requis.'); return; }
    setCreating(true);
    try {
      setCreateErr(null);
      const r = await onCreate({ firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim(), phone: form.phone.trim() || undefined });
      setCreateMsg(r.existed
        ? 'Ce joueur avait déjà un compte — rattaché au club.'
        : `Compte créé — mot de passe temporaire : ${r.tempPassword ?? '—'}`);
      setShowCreate(false);
    } catch (e) { setCreateErr((e as Error).message); }
    finally { setCreating(false); }
  };

  if (showCreate) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input aria-label="Prénom" placeholder="Prénom" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} style={{ ...input, flex: 1, minWidth: 120 }} />
          <input aria-label="Nom" placeholder="Nom" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} style={{ ...input, flex: 1, minWidth: 120 }} />
        </div>
        <input aria-label="Email" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ ...input, width: '100%', boxSizing: 'border-box' }} />
        <input aria-label="Téléphone" placeholder="Téléphone (optionnel)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={{ ...input, width: '100%', boxSizing: 'border-box' }} />
        {createErr && <div style={{ color: th.danger, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>{createErr}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={submitCreate} disabled={creating} style={{ border: 'none', background: th.accent, color: th.onAccent, borderRadius: 9, padding: '7px 13px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>{creating ? 'Création…' : 'Créer le joueur'}</button>
          <button type="button" onClick={() => setShowCreate(false)} style={{ border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5 }}>Annuler</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <span aria-hidden style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', pointerEvents: 'none' }}>
          <Icon name="search" size={16} color={th.textMute} />
        </span>
        <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Rechercher un membre…"
          style={{ width: '100%', boxSizing: 'border-box', background: th.surface2, border: `1.5px solid ${th.accent}`, borderRadius: 10, padding: '11px 12px 11px 38px', fontFamily: th.fontUI, fontSize: 14.5, color: th.text, outline: 'none' }} />
      </div>
      <div style={{ maxHeight: 240, overflowY: 'auto', opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }}>
        {rows.length === 0
          ? <div style={{ padding: '8px 6px', fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>Aucun membre trouvé.</div>
          : rows.map((m) => (
              <button key={m.id} type="button" disabled={busy} onClick={() => { setPickedId(m.id); onSelect(m.id); }}
                onMouseEnter={(e) => { e.currentTarget.style.background = th.surface2; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer', borderRadius: 10, padding: '8px 6px', fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
                <Avatar firstName={m.firstName} lastName={m.lastName} avatarUrl={null} size={28} color={colorForSeed(m.id)} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{m.firstName} {m.lastName}</span>
                {pickedId === m.id
                  ? <span style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 600, color: th.accent, flexShrink: 0 }}>Association…</span>
                  : <LevelChip level={m.level} size="xs" />}
                <span aria-hidden style={{ width: 26, height: 26, borderRadius: '50%', background: `${th.accent}22`, color: th.accent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>+</span>
              </button>
            ))}
      </div>
      {createMsg && <div style={{ marginTop: 8, background: `${th.accent}22`, color: th.text, borderRadius: 10, padding: '8px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>{createMsg}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8 }}>
        <button type="button" onClick={() => { setForm({ firstName: '', lastName: '', email: '', phone: '' }); setCreateErr(null); setShowCreate(true); }}
          style={{ border: 'none', background: 'transparent', color: th.accent, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, padding: 0 }}>+ Créer un joueur</button>
        <button type="button" onClick={onCancel}
          style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: th.textFaint, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, padding: 0 }}>Fermer</button>
      </div>
    </div>
  );
}
