'use client';
import { useEffect, useState } from 'react';
import { api, ClubMemberSearchResult, ConversationSummary, Friend } from '@/lib/api';
import { dmErrorMessage } from '@/lib/messages';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';

type Row = { id: string; firstName: string; lastName: string; avatarUrl?: string | null; level?: Friend['level'] };

// Panneau "Nouvelle conversation" (dialog overlay, pattern "Membres bloqués" de MessagesHub) :
// champ vide → mes amis du club ; en tapant → annuaire (searchClubMembers, débounce 250 ms).
export function NewConversationPanel({ slug, token, viewerUserId, onClose, onOpened }: {
  slug: string;
  token: string;
  viewerUserId: string;
  onClose: () => void;
  onOpened: (conversation: ConversationSummary) => void;
}) {
  const { th } = useTheme();
  const [q, setQ] = useState('');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [results, setResults] = useState<ClubMemberSearchResult[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState(false);

  useEffect(() => {
    api.listClubFriends(slug, token).then(setFriends).catch(() => setFriends([]));
  }, [slug, token]);

  const query = q.trim();
  useEffect(() => {
    if (!query) { setResults([]); setSearchError(false); return; }
    const handle = setTimeout(() => {
      api.searchClubMembers(slug, query, token)
        .then((r) => { setResults(r); setSearchError(false); })
        .catch(() => { setResults([]); setSearchError(true); });
    }, 250);
    return () => clearTimeout(handle);
  }, [query, slug, token]);

  const select = async (userId: string) => {
    setBusyId(userId);
    setError(null);
    try {
      const conversation = await api.openConversation(userId, token, slug);
      onOpened(conversation);
    } catch (err) {
      setError(dmErrorMessage(err));
      setBusyId(null);
    }
  };

  const rows: Row[] = (query ? results : friends).filter((r) => r.id !== viewerUserId);

  return (
    <div role="dialog" aria-label="Nouvelle conversation" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: 360, maxWidth: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          background: th.bg, border: `1px solid ${th.line}`, borderRadius: 16, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>Nouvelle conversation</span>
          <button type="button" aria-label="Fermer" onClick={onClose}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 18, padding: 4 }}>✕</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un membre…" autoFocus
          style={{ border: `1px solid ${th.line}`, background: th.surface2, color: th.text, borderRadius: 10,
            padding: '10px 12px', fontFamily: th.fontUI, fontSize: 14, marginBottom: 10 }} />
        {error && <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.danger, marginBottom: 8 }}>{error}</div>}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {!query && rows.length > 0 && (
            <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.4, padding: '4px 4px 8px' }}>
              Mes amis
            </div>
          )}
          {rows.length === 0 && (
            <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: query && searchError ? th.danger : th.textMute, padding: '12px 4px' }}>
              {query
                ? (searchError ? 'Recherche indisponible, réessayez.' : 'Aucun membre trouvé.')
                : 'Tapez un nom pour trouver un membre.'}
            </div>
          )}
          {rows.map((r) => (
            <button key={r.id} type="button" disabled={busyId === r.id} onClick={() => select(r.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                border: 'none', background: 'transparent', cursor: busyId === r.id ? 'default' : 'pointer',
                padding: '8px 4px', borderBottom: `1px solid ${th.line}`, opacity: busyId === r.id ? 0.6 : 1 }}>
              <Avatar firstName={r.firstName} lastName={r.lastName} avatarUrl={r.avatarUrl ?? null} size={34} color={colorForSeed(r.id)} />
              <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14, color: th.text, fontWeight: 600 }}>{r.firstName} {r.lastName}</span>
              <LevelChip level={r.level} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
