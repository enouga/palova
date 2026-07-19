import { render } from '@testing-library/react';

const replace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

// Contexte club contrôlable : slug null = hôte plateforme, sinon hôte club.
let clubCtx: { slug: string | null } = { slug: null };
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => clubCtx }));

// Import après les mocks (les pages lisent `useClub`/`useRouter` au montage).
import ClubsPage from '../app/clubs/page';
import TournoisPage from '../app/tournois/page';

beforeEach(() => {
  replace.mockClear();
  clubCtx = { slug: null };
});

describe('redirections /decouvrir', () => {
  it('/clubs (hôte plateforme) redirige vers /decouvrir#clubs', () => {
    render(<ClubsPage />);
    expect(replace).toHaveBeenCalledWith('/decouvrir#clubs');
  });

  it('/tournois (hôte plateforme) redirige vers /decouvrir#tournois', () => {
    render(<TournoisPage />);
    expect(replace).toHaveBeenCalledWith('/decouvrir#tournois');
  });

  it('/tournois (hôte club) redirige toujours vers /events?filtre=competitions', () => {
    clubCtx = { slug: 'demo' };
    render(<TournoisPage />);
    expect(replace).toHaveBeenCalledWith('/events?filtre=competitions');
  });
});
