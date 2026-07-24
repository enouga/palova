import { render } from '@testing-library/react';

const replace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

// Contexte club contrôlable : slug null = hôte plateforme, sinon hôte club.
let clubCtx: { slug: string | null } = { slug: null };
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => clubCtx }));

// Import après les mocks (les pages lisent `useClub`/`useRouter` au montage).
import ClubsPage from '../app/clubs/page';
import TournoisPage from '../app/tournois/page';
import DecouvrirRedirect from '../app/decouvrir/page';

beforeEach(() => {
  replace.mockClear();
  clubCtx = { slug: null };
  window.history.replaceState(null, '', '/');
});

// La découverte (parties / tournois / clubs) vit désormais dans l'accueil : les trois anciennes
// URLs y renvoient, chacune sur son ancre.
describe('redirections vers l’accueil unifié', () => {
  it('/clubs (hôte plateforme) redirige vers /#clubs', () => {
    render(<ClubsPage />);
    expect(replace).toHaveBeenCalledWith('/#clubs');
  });

  it('/tournois (hôte plateforme) redirige vers /#tournois', () => {
    render(<TournoisPage />);
    expect(replace).toHaveBeenCalledWith('/#tournois');
  });

  it('/tournois (hôte club) redirige toujours vers /events?filtre=competitions', () => {
    clubCtx = { slug: 'demo' };
    render(<TournoisPage />);
    expect(replace).toHaveBeenCalledWith('/events?filtre=competitions');
  });

  it('/decouvrir redirige vers l’accueil', () => {
    render(<DecouvrirRedirect />);
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('/decouvrir conserve query ET hash (un favori ?q=Toulouse#clubs reste utile)', () => {
    window.history.replaceState(null, '', '/decouvrir?q=Toulouse#clubs');
    render(<DecouvrirRedirect />);
    expect(replace).toHaveBeenCalledWith('/?q=Toulouse#clubs');
  });
});
