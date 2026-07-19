import { render, screen, waitFor } from '@testing-library/react';
import AidePage from '@/app/aide/page';
import { ThemeProvider } from '@/lib/ThemeProvider';
import type { ClubPresentation } from '@/lib/api';

const replaceMock = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: replaceMock, push: jest.fn() }) }));

let clubCtx: any = {
  slug: 'padel-arena-paris',
  club: { id: 'club-demo', name: 'Padel Arena Paris', address: '12 rue du Padel', city: 'Paris' },
};
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => clubCtx }));

jest.mock('@/lib/api', () => ({
  assetUrl: (u: string) => u,
  api: {
    getClubPresentation: jest.fn(),
    getClubFaq: jest.fn(),
  },
}));

// react-markdown est un module ESM-only que ce projet ne transpile pas pour les tests
// (cf. ClubPageView.test.tsx) — FaqView le charge transitivement via Markdown ; on stubbe
// un rendu texte brut, suffisant ici (les assertions portent sur la question, pas la réponse).
jest.mock('@/components/ui/Markdown', () => ({ Markdown: ({ children }: { children: string }) => <div>{children}</div> }));

const PRES: ClubPresentation = {
  presentationText: null, coverImageUrl: null, address: '12 rue du Padel', city: 'Paris',
  latitude: null, longitude: null, contactPhone: '01 23 45 67 89', contactEmail: 'accueil@arena.fr',
  openingHoursText: 'Tous les jours 8h–22h', foundedYear: null, amenities: [], photos: [],
};

function renderPage(pres = PRES) {
  const { api } = require('@/lib/api');
  api.getClubPresentation.mockResolvedValue(pres);
  api.getClubFaq.mockResolvedValue({ socle: [{ id: 's1', category: 'Réserver un terrain', question: 'Comment réserver ?', answer: 'Sur le site.' }], custom: [] });
  return render(<ThemeProvider><AidePage /></ThemeProvider>);
}

beforeEach(() => {
  replaceMock.mockClear();
  clubCtx = { slug: 'padel-arena-paris', club: { id: 'club-demo', name: 'Padel Arena Paris', address: '12 rue du Padel', city: 'Paris' } };
});

it('affiche les coordonnées du club (tel, email, horaires) et l encart Palova', async () => {
  renderPage();
  await waitFor(() => expect(screen.getByText('01 23 45 67 89')).toBeInTheDocument());
  expect(screen.getByRole('link', { name: /01 23 45 67 89/ })).toHaveAttribute('href', 'tel:0123456789');
  expect(screen.getByRole('link', { name: /accueil@arena\.fr/ })).toHaveAttribute('href', 'mailto:accueil@arena.fr');
  expect(screen.getByText(/Tous les jours 8h–22h/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /contact@palova\.fr/ })).toHaveAttribute('href', 'mailto:contact@palova.fr');
});

it('masque les lignes absentes et affiche le repli accueil sans aucune coordonnée', async () => {
  renderPage({ ...PRES, contactPhone: null, contactEmail: null, openingHoursText: null });
  await waitFor(() => expect(screen.getByText(/à l'accueil du club/i)).toBeInTheDocument());
  expect(screen.queryByRole('link', { name: /tel:/ })).not.toBeInTheDocument();
});

it('rend la FAQ du club (socle)', async () => {
  renderPage();
  await waitFor(() => expect(screen.getByText('Comment réserver ?')).toBeInTheDocument());
});

it('hôte plateforme : redirige vers /faq', async () => {
  clubCtx = { slug: null, club: null };
  renderPage();
  await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/faq'));
});
