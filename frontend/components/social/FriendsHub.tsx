'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ClubMemberSearchResult, Friend, FriendRequests } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { FollowButton } from '@/components/social/FollowButton';
import { FriendButton } from '@/components/social/FriendButton';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';
import { openDm } from '@/lib/messages';

type Tab = 'amis' | 'demandes' | 'following' | 'followers' | 'search';

// Hub social du joueur : Amis (amitiés confirmées) / Demandes (reçues+envoyées) /
// Abonnements / Abonnés (suivi à sens unique) / Trouver (annuaire). Actions club-scoped via `slug`.
export function FriendsHub({ slug, token, initialTab = 'amis' }: { slug: string; token: string; initialTab?: Tab }) {
  const { th } = useTheme();
  const isDesktop = useIsDesktop();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequests>({ received: [], sent: [] });
  const [following, setFollowing] = useState<Friend[]>([]);
  const [followers, setFollowers] = useState<Friend[]>([]);
  const [q, setQ] = useState('');
  const [searchResults, setSearchResults] = useState<ClubMemberSearchResult[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Recharge toutes mes listes — au montage ET après chaque action (accepter/refuser/suivre/retirer),
  // pour que les compteurs d'onglets se mettent à jour en direct.
  const reload = useCallback(() => {
    api.listFriendships(token).then(setFriends).catch(() => {});
    api.listFriendRequests(token).then(setRequests).catch(() => {});
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

  const respond = async (userId: string, accept: boolean) => {
    setBusyId(userId);
    try { await api.respondFriend(slug, userId, accept, token); reload(); }
    catch { /* noop */ }
    finally { setBusyId(null); }
  };
  const cancelSent = async (userId: string) => {
    setBusyId(userId);
    try { await api.removeFriend(slug, userId, token); reload(); }
    catch { /* noop */ }
    finally { setBusyId(null); }
  };

  const tabs: { key: Tab; label: string; n?: number }[] = [
    { key: 'amis',      label: 'Amis',        n: friends.length },
    { key: 'demandes',  label: 'Demandes',    n: requests.received.length },
    { key: 'following', label: 'Abonnements', n: following.length },
    { key: 'followers', label: 'Abonnés',     n: followers.length },
    { key: 'search',    label: 'Trouver' },
  ];

  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: `1px solid ${th.line}` };
  const identity = (f: { id: string; firstName: string; lastName: string; avatarUrl?: string | null; level?: Friend['level'] }) => (
    <>
      <Avatar firstName={f.firstName} lastName={f.lastName} avatarUrl={f.avatarUrl ?? null} size={36} color={colorForSeed(f.id)} />
      <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14.5, color: th.text, fontWeight: 600 }}>{f.firstName} {f.lastName}</span>
      {f.level != null && <LevelChip level={f.level} />}
    </>
  );

  const btnStyle = (fill: boolean): React.CSSProperties => ({
    border: `1px solid ${th.accent}`, background: fill ? th.accent : 'transparent', color: fill ? th.onAccent : th.accent,
    borderRadius: 999, padding: '5px 11px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  });

  // Bouton 💬 « Envoyer un message » : widget ancré en desktop, page /me/messages en mobile.
  const message = (userId: string) => openDm(userId, { isDesktop, navigate: (h) => router.push(h) });
  const msgBtn = (f: { id: string; firstName: string; lastName: string }) => (
    <button type="button" aria-label={`Écrire à ${f.firstName} ${f.lastName}`} title="Envoyer un message"
      onClick={() => message(f.id)}
      style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.text, borderRadius: 999,
        padding: '5px 9px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
      <Icon name="chat" size={15} color={th.textMute} />
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            style={{ flex: 1, minWidth: 90, border: `1px solid ${tab === t.key ? th.accent : th.line}`, background: tab === t.key ? th.accent : 'transparent', color: tab === t.key ? th.onAccent : th.text, borderRadius: 10, padding: '8px 6px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
            {t.label}{t.n != null ? <span style={{ opacity: 0.7 }}> {t.n}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'demandes' ? (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {requests.received.length === 0 && requests.sent.length === 0 && (
            <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, padding: '16px 4px' }}>Aucune demande en attente.</div>
          )}
          {requests.received.map((f) => (
            <div key={`rec-${f.id}`} style={rowStyle}>
              {identity(f)}
              {msgBtn(f)}
              <button type="button" disabled={busyId === f.id} style={btnStyle(true)} onClick={() => respond(f.id, true)}>Accepter</button>
              <button type="button" disabled={busyId === f.id} style={btnStyle(false)} onClick={() => respond(f.id, false)}>Refuser</button>
            </div>
          ))}
          {requests.sent.length > 0 && (
            <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.4, padding: '12px 4px 4px' }}>Envoyées</div>
          )}
          {requests.sent.map((f) => (
            <div key={`sent-${f.id}`} style={rowStyle}>
              {identity(f)}
              {msgBtn(f)}
              <button type="button" disabled={busyId === f.id} style={btnStyle(false)} onClick={() => cancelSent(f.id)}>Annuler</button>
            </div>
          ))}
        </div>
      ) : tab === 'search' ? (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un joueur…"
            style={{ border: `1px solid ${th.line}`, background: th.surface2, color: th.text, borderRadius: 10, padding: '10px 12px', fontFamily: th.fontUI, fontSize: 14 }} />
          {searchResults.length === 0
            ? <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, padding: '16px 4px' }}>Aucun membre trouvé.</div>
            : searchResults.map((r) => (
                <div key={r.id} style={rowStyle}>
                  {identity(r)}
                  {msgBtn(r)}
                  <FollowButton slug={slug} userId={r.id} token={token} initial={{ iFollow: !!r.iFollow, mutual: !!r.mutual }} onChange={reload} />
                  <FriendButton slug={slug} userId={r.id} token={token} relation={r.friend ?? { status: 'none', requestable: false }} onChange={reload} />
                </div>
              ))}
        </>
      ) : (
        (() => {
          const list = tab === 'amis' ? friends : tab === 'following' ? following : followers;
          const empty = tab === 'amis' ? "Aucun ami confirmé pour l'instant." : tab === 'following' ? 'Vous ne suivez personne.' : 'Personne ne vous suit encore.';
          return list.length === 0
            ? <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, padding: '16px 4px' }}>{empty}</div>
            : list.map((f) => (
                <div key={f.id} style={rowStyle}>
                  {identity(f)}
                  {msgBtn(f)}
                  {tab === 'amis'
                    ? <FriendButton slug={slug} userId={f.id} token={token} relation={{ status: 'friends', requestable: false }} onChange={reload} />
                    : <FollowButton slug={slug} userId={f.id} token={token} initial={{ iFollow: tab === 'following' || f.mutual, mutual: f.mutual }} onChange={reload} />}
                </div>
              ));
        })()
      )}
    </div>
  );
}
