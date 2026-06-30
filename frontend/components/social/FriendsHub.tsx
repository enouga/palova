'use client';
import { useEffect, useState } from 'react';
import { api, Friend } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { FollowButton } from '@/components/social/FollowButton';
import { colorForSeed } from '@/lib/playerColors';

type Tab = 'amis' | 'following' | 'followers';

// Hub social du joueur : amis (mutuels), je suis, me suivent. Suivi club-scoped via `slug`.
export function FriendsHub({ slug, token, initialTab = 'amis' }: { slug: string; token: string; initialTab?: Tab }) {
  const { th } = useTheme();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [following, setFollowing] = useState<Friend[]>([]);
  const [followers, setFollowers] = useState<Friend[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => { api.listFollowing(token).then(setFollowing).catch(() => {}); }, [token]);
  useEffect(() => { api.listFollowers(token).then(setFollowers).catch(() => {}); }, [token]);

  const amis = following.filter((f) => f.mutual);
  const source = tab === 'amis' ? amis : tab === 'following' ? following : followers;
  const ql = q.trim().toLowerCase();
  const list = ql ? source.filter((f) => `${f.firstName} ${f.lastName}`.toLowerCase().includes(ql)) : source;

  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: 'amis',      label: 'Amis',       n: amis.length },
    { key: 'following', label: 'Je suis',    n: following.length },
    { key: 'followers', label: 'Me suivent', n: followers.length },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            style={{ flex: 1, border: `1px solid ${tab === t.key ? th.accent : th.line}`, background: tab === t.key ? th.accent : 'transparent', color: tab === t.key ? th.onAccent : th.text, borderRadius: 10, padding: '8px 6px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
            {t.label} <span style={{ opacity: 0.7 }}>{t.n}</span>
          </button>
        ))}
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un joueur…"
        style={{ border: `1px solid ${th.line}`, background: th.surface2, color: th.text, borderRadius: 10, padding: '10px 12px', fontFamily: th.fontUI, fontSize: 14 }} />

      {list.length === 0
        ? <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, padding: '16px 4px' }}>
            {tab === 'followers' ? 'Personne ne vous suit encore.' : tab === 'amis' ? 'Aucun ami mutuel pour l\'instant.' : 'Vous ne suivez personne pour l\'instant.'}
          </div>
        : list.map((f) => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: `1px solid ${th.line}` }}>
              <Avatar firstName={f.firstName} lastName={f.lastName} avatarUrl={f.avatarUrl} size={36} color={colorForSeed(f.id)} />
              <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14.5, color: th.text, fontWeight: 600 }}>{f.firstName} {f.lastName}</span>
              <FollowButton slug={slug} userId={f.id} token={token}
                initial={{ iFollow: tab !== 'followers' || f.mutual, mutual: f.mutual }} />
            </div>
          ))}
    </div>
  );
}
