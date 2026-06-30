'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ClubMemberSearchResult, Friend } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { FollowButton } from '@/components/social/FollowButton';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';

type Tab = 'amis' | 'following' | 'followers' | 'search';

// Hub social du joueur : amis (mutuels), je suis, me suivent, annuaire (Trouver). Suivi club-scoped via `slug`.
export function FriendsHub({ slug, token, initialTab = 'amis' }: { slug: string; token: string; initialTab?: Tab }) {
  const { th } = useTheme();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [following, setFollowing] = useState<Friend[]>([]);
  const [followers, setFollowers] = useState<Friend[]>([]);
  const [q, setQ] = useState('');
  const [searchResults, setSearchResults] = useState<ClubMemberSearchResult[]>([]);

  // Recharge mes listes (suivis + abonnés) — au montage ET après chaque (dé)suivi,
  // pour que les compteurs d'onglets (Amis / Je suis / Me suivent) se mettent à jour en direct.
  const reload = useCallback(() => {
    api.listFollowing(token).then(setFollowing).catch(() => {});
    api.listFollowers(token).then(setFollowers).catch(() => {});
  }, [token]);
  useEffect(() => { reload(); }, [reload]);

  // Debounced directory search — only active on the 'search' tab.
  useEffect(() => {
    if (tab !== 'search') return;
    const query = q.trim();
    const handle = setTimeout(() => {
      api.searchClubMembers(slug, query, token)
        .then(setSearchResults)
        .catch(() => setSearchResults([]));
    }, query ? 250 : 0);
    return () => clearTimeout(handle);
  }, [tab, q, slug, token]);

  const amis = following.filter((f) => f.mutual);
  const source = tab === 'amis' ? amis : tab === 'following' ? following : followers;
  const ql = q.trim().toLowerCase();
  const list = ql ? source.filter((f) => `${f.firstName} ${f.lastName}`.toLowerCase().includes(ql)) : source;

  const tabs: { key: Tab; label: string; n?: number }[] = [
    { key: 'amis',      label: 'Amis',       n: amis.length },
    { key: 'following', label: 'Je suis',    n: following.length },
    { key: 'followers', label: 'Me suivent', n: followers.length },
    { key: 'search',    label: 'Trouver' },
  ];

  const emptyMsg = tab === 'followers'
    ? 'Personne ne vous suit encore.'
    : tab === 'amis'
    ? "Aucun ami mutuel pour l'instant."
    : 'Vous ne suivez personne pour l\'instant.';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            style={{ flex: 1, border: `1px solid ${tab === t.key ? th.accent : th.line}`, background: tab === t.key ? th.accent : 'transparent', color: tab === t.key ? th.onAccent : th.text, borderRadius: 10, padding: '8px 6px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
            {t.label}{t.n != null ? <span style={{ opacity: 0.7 }}> {t.n}</span> : null}
          </button>
        ))}
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)}
        placeholder={tab === 'search' ? 'Rechercher un joueur à suivre…' : 'Rechercher un joueur…'}
        style={{ border: `1px solid ${th.line}`, background: th.surface2, color: th.text, borderRadius: 10, padding: '10px 12px', fontFamily: th.fontUI, fontSize: 14 }} />

      {tab === 'search' ? (
        searchResults.length === 0
          ? <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, padding: '16px 4px' }}>
              Aucun membre trouvé.
            </div>
          : searchResults.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: `1px solid ${th.line}` }}>
                <Avatar firstName={r.firstName} lastName={r.lastName} avatarUrl={null} size={36} color={colorForSeed(r.id)} />
                <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14.5, color: th.text, fontWeight: 600 }}>{r.firstName} {r.lastName}</span>
                <LevelChip level={r.level} />
                <FollowButton slug={slug} userId={r.id} token={token}
                  initial={{ iFollow: !!r.iFollow, mutual: !!r.mutual }} onChange={reload} />
              </div>
            ))
      ) : (
        list.length === 0
          ? <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, padding: '16px 4px' }}>
              {emptyMsg}
            </div>
          : list.map((f) => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: `1px solid ${th.line}` }}>
                <Avatar firstName={f.firstName} lastName={f.lastName} avatarUrl={f.avatarUrl} size={36} color={colorForSeed(f.id)} />
                <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14.5, color: th.text, fontWeight: 600 }}>{f.firstName} {f.lastName}</span>
                <FollowButton slug={slug} userId={f.id} token={token}
                  initial={{ iFollow: tab !== 'followers' || f.mutual, mutual: f.mutual }} onChange={reload} />
              </div>
            ))
      )}
    </div>
  );
}
