'use client';
import { useEffect, useRef, useState } from 'react';
import type { Member, CreateMemberBody } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';

export interface PlayerPickerProps {
  members: Member[];
  value: { firstName: string; lastName: string } | null;
  onSelect: (m: Member) => void;
  onClear: () => void;
  // Forme minimale requise par ce composant (il n'exploite que ces 2 champs) — les appelants
  // sont libres de renvoyer des champs additionnels (userId, member…) pour leur propre usage.
  onCreate: (body: CreateMemberBody) => Promise<{ tempPassword: string | null; existed: boolean }>;
  placeholder?: string;
  /** mutation en cours côté appelant (sélection existante OU création) : désactive la liste, feedback immédiat. */
  busy?: boolean;
}

// "Jean Dupont" → { firstName: 'Jean', lastName: 'Dupont' } ; un seul mot → prénom.
function splitName(q: string): { firstName: string; lastName: string } {
  const parts = q.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export function PlayerPicker({ members, value, onSelect, onClear, onCreate, placeholder, busy = false }: PlayerPickerProps) {
  const { th } = useTheme();
  const [query, setQuery]           = useState('');
  const [open, setOpen]             = useState(false);
  const [editing, setEditing]       = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm]             = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [creating, setCreating]     = useState(false);
  const [createErr, setCreateErr]   = useState<string | null>(null);
  const [createMsg, setCreateMsg]   = useState<string | null>(null);
  const inputRef                    = useRef<HTMLInputElement>(null);
  // Ligne cliquée : feedback immédiat (avant même la résolution réseau), remis à zéro dès que
  // l'appelant n'est plus busy (succès → le picker repasse en mode chip ; échec → réessai possible).
  const [pickedId, setPickedId]     = useState<string | null>(null);
  useEffect(() => { if (!busy) setPickedId(null); }, [busy]);

  const valueKey = value ? `${value.firstName} ${value.lastName}` : '';
  // Changement de cible (autre résa / réinit) : on repart en mode « chip ».
  useEffect(() => { setEditing(false); setShowCreate(false); }, [valueKey]);
  // Passage en édition (clic « Changer ») : focus le champ pour ouvrir la liste tout de suite.
  useEffect(() => { if (editing && !showCreate) inputRef.current?.focus(); }, [editing, showCreate]);

  const showChip = !!value && !editing;

  // Liste visible dès le focus (parcourir les membres) OU dès qu'on tape ; vide → tous
  // les membres, sinon filtrés par nom/email.
  const q = query.trim().toLowerCase();
  const showList = !showChip && !showCreate && (open || q.length > 0);
  const matches = showList
    ? (q ? members.filter((m) => `${m.firstName} ${m.lastName} ${m.email}`.toLowerCase().includes(q)) : members).slice(0, 8)
    : [];

  // La liste s'ouvre en absolu SOUS le champ : quand le picker vit en bas d'une modale
  // scrollable (élèves du planning, Détails…), le menu naît hors de la zone visible et le
  // conteneur ne défile pas de lui-même → on l'amène en vue à l'ouverture.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (showList) listRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [showList]);

  const pick = (m: Member) => { setPickedId(m.userId); setQuery(''); setOpen(false); setEditing(false); setCreateMsg(null); onSelect(m); };

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
  // Champ de recherche « voyant » : loupe à gauche + bordure à l'accent du club + halo au focus.
  const searchInput = { ...input, border: `1.5px solid ${th.accent}`, borderRadius: 10, padding: '11px 12px 11px 38px', fontSize: 14.5, outline: 'none', boxShadow: open ? `0 0 0 3px ${th.accent}22` : 'none', transition: 'box-shadow .15s ease' } as const;

  return (
    <div style={{ position: 'relative' }}>
      {busy && pickedId ? (
        // Sélection d'un membre existant en vol : retour immédiat (avant même la résolution
        // réseau) — la liste se referme déjà au clic, sans ce bandeau on aurait l'impression
        // que rien ne s'est passé pendant l'aller-retour.
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${th.line}`, borderRadius: 8, padding: '8px 10px', opacity: 0.7 }}>
          <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>Sélection…</span>
        </div>
      ) : showChip ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${th.line}`, borderRadius: 8, padding: '8px 10px' }}>
          <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14, color: th.text }}>{value!.firstName} {value!.lastName}</span>
          <button type="button" onClick={() => { setEditing(true); setQuery(''); setOpen(true); onClear(); }}
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
          {createErr && <div style={{ color: th.danger, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>{createErr}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={submitCreate} disabled={creating}
              style={{ border: 'none', background: th.accent, color: '#fff', borderRadius: 9, padding: '7px 13px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>{creating ? 'Création…' : 'Créer le joueur'}</button>
            <button type="button" onClick={() => setShowCreate(false)}
              style={{ border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5 }}>Annuler</button>
          </div>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <span data-testid="player-search-loupe" aria-hidden style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', pointerEvents: 'none' }}>
            <Icon name="search" size={16} color={th.textMute} />
          </span>
          <input ref={inputRef} type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder ?? 'Rechercher un joueur…'}
            onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
            style={{ ...searchInput, width: '100%', boxSizing: 'border-box' }} />
        </div>
      )}

      {showList && (
        <div ref={listRef} style={{ position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 10, maxHeight: 240, overflowY: 'auto', background: th.surface, border: `1px solid ${th.line}`, borderRadius: 8, marginTop: 4, boxShadow: th.shadowSoft, padding: 4 }}>
          {matches.length === 0
            ? <div style={{ padding: '8px 10px', fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>{members.length === 0 ? 'Aucun membre dans ce club.' : 'Aucun membre trouvé.'}</div>
            : matches.map((m) => (
                // Ligne « annuaire » alignée sur AddPlayerSheet du front (avatar + niveau + « + »), sans rangée « Mes amis ».
                <button key={m.userId} type="button" onClick={() => pick(m)}
                  // Sans ça, le mousedown sur la ligne fait perdre le focus au champ AVANT le
                  // click : le blur programme la fermeture (setTimeout 150ms) et, si le clic
                  // dépasse ce délai (trackpad, clic appuyé…), la ligne disparaît avant que le
                  // click ne se déclenche — sélection silencieusement ratée.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={(e) => { e.currentTarget.style.background = th.surface2; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 10, padding: '8px 6px', fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
                  <Avatar firstName={m.firstName} lastName={m.lastName} avatarUrl={m.avatarUrl ?? null} size={28} color={colorForSeed(m.userId)} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{m.firstName} {m.lastName}</span>
                  <LevelChip level={m.level} size="xs" />
                  <span aria-hidden style={{ width: 26, height: 26, borderRadius: '50%', background: `${th.accent}22`, color: th.accent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>+</span>
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
