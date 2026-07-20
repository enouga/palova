'use client';
import { useEffect, useState } from 'react';
import { api, ClubMemberSearchResult } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { colorForSeed } from '@/lib/playerColors';

/**
 * Sélecteur d'un membre du club par recherche — réutilise l'annuaire existant
 * `GET /:slug/members/search?q=` (réservé aux membres actifs), même API que
 * `PartnerSearch`/`AddStudentPicker`/`AssociateMemberPicker`. Utilisé par la table de marque
 * pour ajouter un retardataire au banc ou composer un binôme tardif (ouvert deux fois en
 * séquence par l'appelant — cf. `MarkTable`, Task 14). Feuille basse (mobile-first, le J/A
 * est debout au bord du terrain).
 */
export function MemberPicker({ slug, token, onPick, onClose }: {
  slug: string;
  token: string;
  onPick: (userId: string, name: string) => void;
  onClose: () => void;
}) {
  const { th } = useTheme();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ClubMemberSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const query = q.trim();
  useEffect(() => {
    if (!query) { setResults([]); setError(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      api.searchClubMembers(slug, query, token)
        .then((rows) => { if (alive) { setResults(rows); setError(null); } })
        .catch(() => { if (alive) { setResults([]); setError('Recherche indisponible, réessayez.'); } });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [query, slug, token]);

  return (
    <div role="dialog" aria-label="Choisir un membre" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 0 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 480, maxHeight: '72vh', display: 'flex', flexDirection: 'column',
          background: th.bg, borderRadius: '18px 18px 0 0', padding: 16, gap: 10, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>Choisir un membre</span>
          <button type="button" aria-label="Fermer" onClick={onClose}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 18, padding: 4, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ position: 'relative' }}>
          <span aria-hidden style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', pointerEvents: 'none' }}>
            <Icon name="search" size={16} color={th.textMute} />
          </span>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un nom…"
            style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${th.line}`, background: th.surface2, color: th.text,
              borderRadius: 10, padding: '10px 12px 10px 36px', fontFamily: th.fontUI, fontSize: 14.5, outline: 'none' }} />
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {error && (
            <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: '#e5484d', padding: '8px 4px' }}>{error}</div>
          )}
          {!error && !query && (
            <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, padding: '8px 4px' }}>Tapez un nom pour trouver un membre.</div>
          )}
          {!error && query && results.length === 0 && (
            <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, padding: '8px 4px' }}>Aucun membre trouvé.</div>
          )}
          {results.map((r) => (
            <button key={r.id} type="button" onClick={() => onPick(r.id, `${r.firstName} ${r.lastName}`.trim())}
              onMouseEnter={(e) => { e.currentTarget.style.background = th.surface2; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', border: 'none', background: 'transparent',
                cursor: 'pointer', padding: '8px 6px', borderRadius: 10, fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
              <Avatar firstName={r.firstName} lastName={r.lastName} avatarUrl={null} size={32} color={colorForSeed(r.id)} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{r.firstName} {r.lastName}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
