import { render, screen, fireEvent } from '@testing-library/react';
import { SuggestionsRow } from '@/components/social/SuggestionsRow';
import { FavoritesRow } from '@/components/social/FavoritesRow';
import { FollowersFooter } from '@/components/social/FollowersFooter';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: {
  accent: '#06c', onAccent: '#fff', surface: '#fff', surface2: '#eee', line: '#ccc',
  text: '#111', textMute: '#666', fontUI: 'sans-serif', fontDisplay: 'serif', mode: 'light',
} }) }));
jest.mock('@/lib/useLevelSystem', () => ({ useLevelSystemEnabled: () => true }));
jest.mock('@/lib/api', () => ({ assetUrl: (p: string | null) => p, api: {
  followUser: jest.fn().mockResolvedValue({ iFollow: true, followsMe: false, mutual: false }),
  unfollowUser: jest.fn().mockResolvedValue({ iFollow: false, followsMe: false, mutual: false }),
  requestFriend: jest.fn().mockResolvedValue({ status: 'pending_out', requestable: false }),
} }));

const friend = (id: string, first: string) => ({ id, firstName: first, lastName: 'X', avatarUrl: null, mutual: false });
const NOW = new Date('2026-07-14T10:00:00');

describe('SuggestionsRow', () => {
  const sugg = { id: 'p1', firstName: 'Karim', lastName: 'B', avatarUrl: null, level: null,
    lastPlayedAt: '2026-07-11T10:00:00', playedCount: 2, requestable: false };

  it('rien si vide', () => {
    const { container } = render(<SuggestionsRow suggestions={[]} slug="demo" token="t" now={NOW} onChange={jest.fn()} onMessage={jest.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('raison + pas de bouton ami si non requestable (jamais de bouton grisé)', () => {
    render(<SuggestionsRow suggestions={[sugg]} slug="demo" token="t" now={NOW} onChange={jest.fn()} onMessage={jest.fn()} />);
    expect(screen.getByText('Vous avez joué ensemble samedi')).toBeInTheDocument();
    expect(screen.getByText('☆ Favori')).toBeInTheDocument();
    expect(screen.queryByText(/N'accepte pas/)).not.toBeInTheDocument();
    expect(screen.queryByText('Ajouter')).not.toBeInTheDocument();
  });

  it('bouton ami présent si requestable', () => {
    render(<SuggestionsRow suggestions={[{ ...sugg, requestable: true }]} slug="demo" token="t" now={NOW} onChange={jest.fn()} onMessage={jest.fn()} />);
    // le libellé exact vient de FriendButton (état none/requestable)
    expect(screen.getByText(/Ajouter/)).toBeInTheDocument();
  });

  it('le bouton message déclenche onMessage', () => {
    const onMessage = jest.fn();
    render(<SuggestionsRow suggestions={[sugg]} slug="demo" token="t" now={NOW} onChange={jest.fn()} onMessage={onMessage} />);
    fireEvent.click(screen.getByLabelText('Écrire à Karim B'));
    expect(onMessage).toHaveBeenCalledWith(sugg);
  });
});

describe('FavoritesRow', () => {
  it("chip → barre d'actions", () => {
    const onInvite = jest.fn();
    render(<FavoritesRow favorites={[friend('u2', 'Léa')]} onMessage={jest.fn()} onInvite={onInvite} onRemove={jest.fn()} />);
    fireEvent.click(screen.getByText('Léa'));
    fireEvent.click(screen.getByText('⚡ Inviter'));
    expect(onInvite).toHaveBeenCalled();
  });

  it('re-cliquer la même chip referme la barre', () => {
    render(<FavoritesRow favorites={[friend('u2', 'Léa')]} onMessage={jest.fn()} onInvite={jest.fn()} onRemove={jest.fn()} />);
    fireEvent.click(screen.getByText('Léa'));
    expect(screen.getByText('⚡ Inviter')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Léa'));
    expect(screen.queryByText('⚡ Inviter')).not.toBeInTheDocument();
  });

  it("cliquer une autre chip ferme la première et ouvre la seconde", () => {
    render(<FavoritesRow favorites={[friend('u2', 'Léa'), friend('u3', 'Marc')]} onMessage={jest.fn()} onInvite={jest.fn()} onRemove={jest.fn()} />);
    fireEvent.click(screen.getByText('Léa'));
    expect(screen.getByText(/Léa X :/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Marc'));
    expect(screen.queryByText(/Léa X :/)).not.toBeInTheDocument();
    expect(screen.getByText(/Marc X :/)).toBeInTheDocument();
  });

  it('onMessage et onRemove sont appelés ; retirer referme la barre', () => {
    const f = friend('u2', 'Léa');
    const onMessage = jest.fn();
    const onRemove = jest.fn();
    render(<FavoritesRow favorites={[f]} onMessage={onMessage} onInvite={jest.fn()} onRemove={onRemove} />);
    fireEvent.click(screen.getByText('Léa'));
    fireEvent.click(screen.getByText('💬 Message'));
    expect(onMessage).toHaveBeenCalledWith(f);
    fireEvent.click(screen.getByText('Retirer ★'));
    expect(onRemove).toHaveBeenCalledWith(f);
    expect(screen.queryByText('💬 Message')).not.toBeInTheDocument();
  });
});

describe('FollowersFooter', () => {
  it('replié par défaut, déplié par anchorOpen, ★ en retour si pas mutuel', () => {
    const { rerender } = render(<FollowersFooter followers={[friend('u2', 'Léa')]} slug="demo" token="t" onChange={jest.fn()} />);
    expect(screen.queryByText('Léa X')).not.toBeInTheDocument();
    rerender(<FollowersFooter followers={[friend('u2', 'Léa')]} slug="demo" token="t" anchorOpen onChange={jest.fn()} />);
    expect(screen.getByText('Léa X')).toBeInTheDocument();
    expect(screen.getByText('☆ Favori')).toBeInTheDocument();
  });

  it('un follower mutuel ne montre pas de bouton Favori', () => {
    render(<FollowersFooter followers={[{ ...friend('u2', 'Léa'), mutual: true }]} slug="demo" token="t" anchorOpen onChange={jest.fn()} />);
    expect(screen.getByText('Léa X')).toBeInTheDocument();
    expect(screen.queryByText('☆ Favori')).not.toBeInTheDocument();
  });

  it('état vide déplié : 0 followers', () => {
    render(<FollowersFooter followers={[]} slug="demo" token="t" anchorOpen onChange={jest.fn()} />);
    expect(screen.getByText('Qui me suit · 0', { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Personne ne vous suit pour l'instant.")).toBeInTheDocument();
  });
});
