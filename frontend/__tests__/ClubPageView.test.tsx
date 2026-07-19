import { render, screen } from '@testing-library/react';
import { ClubPageView } from '../components/content/ClubPageView';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ slug: 'padel-arena', club: null, loading: false }) }));
jest.mock('../lib/api', () => ({ api: { getClubPage: jest.fn() } }));
// react-markdown est un module ESM-only que ce projet ne transpile pas pour les tests
// (aucune autre suite ne rend Markdown) — on stubbe un rendu texte brut, suffisant ici.
jest.mock('../components/ui/Markdown', () => ({ Markdown: ({ children }: { children: string }) => <div>{children}</div> }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { api } = require('../lib/api') as { api: Record<string, jest.Mock> };

describe('ClubPageView', () => {
  beforeEach(() => jest.clearAllMocks());

  it('page en repli → bandeau « Document type fourni par Palova »', async () => {
    api.getClubPage.mockResolvedValue({ kind: 'CGV', bodyMarkdown: 'CGV type', updatedAt: null, isFallback: true });
    render(<ThemeProvider><ClubPageView pageKind="CGV" platformBody="" /></ThemeProvider>);
    await screen.findByText('CGV type');
    expect(screen.getByText(/Document type fourni par Palova/)).toBeInTheDocument();
  });

  it('page publiée → contenu du club, pas de bandeau de repli', async () => {
    api.getClubPage.mockResolvedValue({ kind: 'CGV', bodyMarkdown: 'Mes CGV', updatedAt: '2026-07-18T00:00:00.000Z', isFallback: false });
    render(<ThemeProvider><ClubPageView pageKind="CGV" platformBody="" /></ThemeProvider>);
    await screen.findByText('Mes CGV');
    expect(screen.queryByText(/Document type fourni par Palova/)).not.toBeInTheDocument();
  });
});
