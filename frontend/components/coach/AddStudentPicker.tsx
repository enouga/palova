'use client';
import { useEffect, useState } from 'react';
import { api, ClubMemberSearchResult } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';

/**
 * Overlay de recherche pour ajouter un élève à un cours (espace coach). Champ vide = invite à
 * taper ; en tapant → annuaire du club (api.searchClubMembers, débounce 250ms, pattern
 * NewConversationPanel). Clic sur une ligne = onPick(userId).
 */
export function AddStudentPicker({ slug, token, onClose, onPick }: {
  slug: string;
  token: string;
  onClose: () => void;
  onPick: (userId: string) => void;
}) {
  const { th } = useTheme();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ClubMemberSearchResult[]>([]);
  const [searchError, setSearchError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  const pick = (userId: string) => {
    setBusyId(userId);
    onPick(userId);
  };

  return (
    <div role="dialog" aria-label="Ajouter un élève" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: 360, maxWidth: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          background: th.bg, border: `1px solid ${th.line}`, borderRadius: 16, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>Ajouter un élève</span>
          <button type="button" aria-label="Fermer" onClick={onClose}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 18, padding: 4 }}>✕</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un membre…" autoFocus
          style={{ border: `1px solid ${th.line}`, background: th.surface2, color: th.text, borderRadius: 10,
            padding: '10px 12px', fontFamily: th.fontUI, fontSize: 14, marginBottom: 10 }} />
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {results.length === 0 && (
            <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: query && searchError ? th.danger : th.textMute, padding: '12px 4px' }}>
              {query
                ? (searchError ? 'Recherche indisponible, réessayez.' : 'Aucun membre trouvé.')
                : 'Tapez un nom pour trouver un membre.'}
            </div>
          )}
          {results.map((r) => (
            <button key={r.id} type="button" disabled={busyId === r.id} onClick={() => pick(r.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                border: 'none', background: 'transparent', cursor: busyId === r.id ? 'default' : 'pointer',
                padding: '8px 4px', borderBottom: `1px solid ${th.line}`, opacity: busyId === r.id ? 0.6 : 1 }}>
              <Avatar firstName={r.firstName} lastName={r.lastName} avatarUrl={null} size={34} color={colorForSeed(r.id)} />
              <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14, color: th.text, fontWeight: 600 }}>{r.firstName} {r.lastName}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
