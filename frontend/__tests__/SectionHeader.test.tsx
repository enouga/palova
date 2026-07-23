import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { SectionHeader } from '@/components/clubhouse/SectionHeader';

const wrap = (props: React.ComponentProps<typeof SectionHeader>) =>
  render(<ThemeProvider><SectionHeader {...props} /></ThemeProvider>);

it('titre seul : ni compteur ni lien', () => {
  wrap({ title: 'Ça joue bientôt' });
  expect(screen.getByRole('heading', { name: 'Ça joue bientôt' })).toBeInTheDocument();
  expect(screen.queryByText(/résultat|offre|partie/)).toBeNull();
  expect(screen.queryByRole('link')).toBeNull();
});

it('compteur seul, sans lien « voir tout »', () => {
  wrap({ title: 'Abonnements & offres', count: '4 offres' });
  expect(screen.getByText('4 offres')).toBeInTheDocument();
  expect(screen.queryByRole('link')).toBeNull();
});

it('compteur + lien « voir tout » ensemble', () => {
  wrap({ title: 'Ça joue bientôt', count: '4 parties', action: { label: 'Toutes les parties →', href: '/parties' } });
  expect(screen.getByText('4 parties')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Toutes les parties →' })).toHaveAttribute('href', '/parties');
});
