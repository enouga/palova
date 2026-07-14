'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ClubMemberSearchResult, Friend, FriendRequests, FriendsAgendaItem, PlayerSuggestion } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SectionHeader, listRowStyle } from '@/components/clubhouse/SectionHeader';
import { FollowButton } from '@/components/social/FollowButton';
import { FriendButton } from '@/components/social/FriendButton';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';
import { openDm } from '@/lib/messages';
import { dedupFavorites, FriendsAnchor } from '@/lib/social';
import { FriendRequestsBanner } from './FriendRequestsBanner';
import { FriendsAgendaRail } from './FriendsAgendaRail';
import { FriendCard } from './FriendCard';
import { SuggestionsRow } from './SuggestionsRow';
import { FavoritesRow } from './FavoritesRow';
import { FollowersFooter } from './FollowersFooter';

export const INVITE_DRAFT = 'On se fait une partie ?';

// Hub social « Mes amis » : scroll unique sans onglet — recherche (filtre mes joueurs +
// annuaire), bannière demandes, « ça joue bientôt », amis enrichis, suggestions,
// favoris ★ (dédupliqués des amis), pied « qui me suit ». Actions club-scoped via `slug`.
export function FriendsHub({ slug, token, timezone, anchor = null }: {
  slug: string;
  token: string;
  timezone: string;
  anchor?: FriendsAnchor;
}) {
  const { th } = useTheme();
  const isDesktop = useIsDesktop();
  const router = useRouter();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequests>({ received: [], sent: [] });
  const [following, setFollowing] = useState<Friend[]>([]);
  const [followers, setFollowers] = useState<Friend[]>([]);
  const [agenda, setAgenda] = useState<FriendsAgendaItem[]>([]);
  const [suggestions, setSuggestions] = useState<PlayerSuggestion[]>([]);
  const [q, setQ] = useState('');
  const [searchResults, setSearchResults] = useState<ClubMemberSearchResult[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Friend | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, []);

  // Chaque brique échoue en silence : une section en erreur n'empêche pas le reste.
  const reload = useCallback(() => {
    Promise.allSettled([
      api.listFriendships(token).then(setFriends),
      api.listFriendRequests(token).then(setRequests),
      api.listFollowing(token).then(setFollowing),
      api.listFollowers(token).then(setFollowers),
      api.getFriendsAgenda(slug, token).then(setAgenda),
      api.getPlayerSuggestions(slug, token).then(setSuggestions),
    ]).then(() => setLoaded(true));
  }, [slug, token]);
  useEffect(() => { reload(); }, [reload]);

  // Annuaire débouncé (250 ms) dès qu'on tape — remplace l'onglet « Trouver ».
  useEffect(() => {
    const query = q.trim();
    if (!query) { setSearchResults([]); return; }
    const handle = setTimeout(() => {
      api.searchClubMembers(slug, query, token).then(setSearchResults).catch(() => setSearchResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [q, slug, token]);

  // Deep-link ?tab= : scroll une seule fois, une fois les données chargées.
  const didAnchor = useRef(false);
  useEffect(() => {
    if (!anchor || !loaded || didAnchor.current) return;
    didAnchor.current = true;
    document.getElementById(anchor === 'demandes' ? 'fh-demandes' : 'fh-followers')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [anchor, loaded]);

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
  const removeFriend = async (f: Friend) => {
    setBusyId(f.id);
    try { await api.removeFriend(slug, f.id, token); reload(); }
    catch { /* noop */ }
    finally { setBusyId(null); setRemoveTarget(null); }
  };
  const removeFavorite = async (f: Friend) => {
    setBusyId(f.id);
    try { await api.unfollowUser(slug, f.id, token); reload(); }
    catch { /* noop */ }
    finally { setBusyId(null); }
  };
  const message = (f: { id: string }) => openDm(f.id, { isDesktop, navigate: (h) => router.push(h) });
  const invite = (f: { id: string }) => openDm(f.id, { isDesktop, navigate: (h) => router.push(h), draft: INVITE_DRAFT });

  const searching = q.trim().length > 0;
  const norm = q.trim().toLowerCase();
  const matchName = (f: Friend) => `${f.firstName} ${f.lastName}`.toLowerCase().includes(norm);
  const visibleFriends = searching ? friends.filter(matchName) : friends;
  const favorites = dedupFavorites(following, friends);
  const visibleFavorites = searching ? favorites.filter(matchName) : favorites;
  const emptyHub = loaded && !searching && friends.length === 0 && favorites.length === 0
    && suggestions.length === 0 && requests.received.length === 0 && requests.sent.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher ou ajouter un joueur…"
        aria-label="Rechercher un joueur"
        style={{ border: `1px solid ${th.line}`, background: th.surface2, color: th.text, borderRadius: 12,
          padding: '11px 13px', fontFamily: th.fontUI, fontSize: 14.5 }} />

      <FriendRequestsBanner requests={requests} busyId={busyId} onRespond={respond} onCancelSent={cancelSent} />

      {!searching && <FriendsAgendaRail items={agenda} timezone={timezone} />}

      {emptyHub && (
        <div style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.textMute, lineHeight: 1.5 }}>
          Retrouvez ici vos partenaires de jeu : cherchez un joueur ci-dessus pour l&apos;ajouter en favori ★ ou en ami.
        </div>
      )}

      {visibleFriends.length > 0 && (
        <section aria-label="Amis">
          <SectionHeader title={`Amis · ${visibleFriends.length}`} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            {visibleFriends.map((f) => (
              <FriendCard key={f.id} friend={f} now={now} busy={busyId === f.id}
                onInvite={invite} onMessage={message} onRemove={setRemoveTarget} />
            ))}
          </div>
        </section>
      )}

      {!searching && (
        <SuggestionsRow suggestions={suggestions} slug={slug} token={token} now={now} onChange={reload} onMessage={message} />
      )}

      <FavoritesRow favorites={visibleFavorites} onMessage={message} onInvite={invite} onRemove={removeFavorite} />

      {searching && (
        <section aria-label="Dans le club">
          <SectionHeader title="Dans le club" />
          {searchResults.length === 0
            ? <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>Aucun membre trouvé.</div>
            : searchResults.map((r) => (
              <div key={r.id} style={listRowStyle(th)}>
                {/* ClubMemberSearchResult n'expose pas d'avatarUrl (searchMembers ne le sélectionne pas côté backend) */}
                <Avatar firstName={r.firstName} lastName={r.lastName} avatarUrl={null} size={36} color={colorForSeed(r.id)} />
                <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14.5, color: th.text, fontWeight: 600 }}>{r.firstName} {r.lastName}</span>
                {r.level != null && <LevelChip level={r.level} />}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                  <button type="button" aria-label={`Écrire à ${r.firstName} ${r.lastName}`} title="Envoyer un message" onClick={() => message(r)}
                    style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.text, borderRadius: 999,
                      padding: '5px 9px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
                    <Icon name="chat" size={15} color={th.textMute} />
                  </button>
                  <FollowButton slug={slug} userId={r.id} token={token} initial={{ iFollow: !!r.iFollow, mutual: !!r.mutual }} onChange={reload} />
                  {/* opt-out → aucun bouton ami (plus jamais de gros bouton grisé négatif) */}
                  {r.friend && (r.friend.requestable || r.friend.status !== 'none') && (
                    <FriendButton slug={slug} userId={r.id} token={token} relation={r.friend} onChange={reload} />
                  )}
                </span>
              </div>
            ))}
        </section>
      )}

      {!searching && <FollowersFooter followers={followers} slug={slug} token={token} anchorOpen={anchor === 'followers'} onChange={reload} />}

      {removeTarget && (
        <ConfirmDialog title="Retirer cet ami ?" detail={`${removeTarget.firstName} ${removeTarget.lastName}`}
          message="Vous pourrez renvoyer une demande plus tard."
          confirmLabel="Retirer" busy={busyId === removeTarget.id}
          onConfirm={() => removeFriend(removeTarget)} onCancel={() => setRemoveTarget(null)} />
      )}
    </div>
  );
}
