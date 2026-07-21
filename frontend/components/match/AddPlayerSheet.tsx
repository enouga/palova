'use client';
import { useEffect, useState } from 'react';
import { api, ClubMemberSearchResult, Friend, UserLevel } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';
import { FriendsQuickRow } from '@/components/social/FriendsQuickRow';
import { SheetShell } from '@/components/ui/SheetShell';
import { SIDE_COLOR, SLOT_LABELS } from '@/components/match/MatchTeams';

/** Joueur choisi dans la feuille (membre de l'annuaire ou ami). */
export interface PickedMember {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  level?: UserLevel | null;
}

// Feuille de sélection de joueur partagée : recherche d'annuaire (mêmes API que
// PartnerSearch, conservé pour la branche non-padel de ReservationPlayersInline),
// rangée « Mes amis », liste des membres avec bouton +. Avec `team`, affiche la
// chip de destination colorée « ÉQUIPE X · G/D » du mini-terrain ; sans elle, la
// feuille sert de sélecteur générique (ex. coéquipier de tournoi via PartnerField).
export function AddPlayerSheet({ slug, token, team, slot, replaceName, title, excludeIds, busy = false, onPick, onClose }: {
  slug: string;
  token: string;
  /** Équipe visée — omise hors contexte de mini-terrain. */
  team?: 1 | 2;
  /** Emplacement visé (0=G, 1=D) — affiché dans la chip en double. */
  slot?: number;
  /** Mode remplacement : nom du joueur remplacé (sinon ajout). */
  replaceName?: string;
  /** Titre explicite (sinon dérivé de replaceName). */
  title?: string;
  excludeIds: string[];
  busy?: boolean;
  onPick: (m: PickedMember) => void;
  onClose: () => void;
}) {
  const { th } = useTheme();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ClubMemberSearchResult[]>([]);

  // Même mécanique que PartnerSearch : liste complète à vide, débounce 250 ms en saisie.
  useEffect(() => {
    const query = q.trim();
    const handle = setTimeout(() => {
      api.searchClubMembers(slug, query, token).then(setResults).catch(() => setResults([]));
    }, query ? 250 : 0);
    return () => clearTimeout(handle);
  }, [q, slug, token]);

  const visible = results.filter((m) => !excludeIds.includes(m.id));
  const teamColor = team != null ? SIDE_COLOR[team] : null;
  const slotLabel = slot != null && slot < SLOT_LABELS.length ? SLOT_LABELS[slot] : undefined;
  const heading = title ?? (replaceName ? `Remplacer ${replaceName}` : 'Ajouter un joueur');

  return (
    <SheetShell onClose={onClose} label={heading}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '2px 2px 0' }}>
        <span style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 800, color: th.text }}>{heading}</span>
        {teamColor && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: `${teamColor}22`, borderRadius: 999, padding: '3px 10px', fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.3, color: th.text, whiteSpace: 'nowrap' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: teamColor, flexShrink: 0 }} />
            {`ÉQUIPE ${team}${slotLabel ? ` · ${slotLabel}` : ''}`}
          </span>
        )}
        <button type="button" onClick={onClose} aria-label="Fermer"
          style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 4 }}>✕</button>
      </div>
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <span aria-hidden="true" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', display: 'flex', pointerEvents: 'none' }}>
          <Icon name="search" size={17} color={th.textMute} />
        </span>
        <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus disabled={busy}
          placeholder="Rechercher un membre…"
          style={{ width: '100%', boxSizing: 'border-box', background: th.surface2, border: `1px solid ${th.line}`, borderRadius: 11, padding: '11px 13px 11px 40px', fontFamily: th.fontUI, fontSize: 14.5, color: th.text, outline: 'none' }} />
      </div>
      <FriendsQuickRow slug={slug} token={token} excludeIds={excludeIds} query={q} fadeColor={th.bgElev}
        disabled={busy} onPick={(f: Friend) => onPick(f)} />
      <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.4, margin: '2px 0 4px' }}>Membres du club</div>
      {visible.length === 0
        ? <div style={{ padding: '10px 5px', fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>Aucun membre trouvé.</div>
        : visible.map((m) => (
            <button key={m.id} type="button" disabled={busy} onClick={() => onPick(m)}
              onMouseEnter={(e) => { if (!busy) e.currentTarget.style.background = th.surface2; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer', borderRadius: 10, padding: '8px 6px', fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
              <Avatar firstName={m.firstName} lastName={m.lastName} avatarUrl={null} size={28} color={colorForSeed(m.id)} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{m.firstName} {m.lastName}</span>
              <LevelChip level={m.level} size="xs" />
              <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: '50%', background: `${th.accent}22`, color: th.accent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>+</span>
            </button>
          ))}
    </SheetShell>
  );
}
