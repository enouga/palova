import { render, screen } from '@testing-library/react';
import { LevelChip } from '../components/player/LevelChip';
import { LevelBadge } from '../components/player/LevelBadge';
import { ThemeProvider } from '../lib/ThemeProvider';

const clubVal: { club: { levelSystemEnabled?: boolean } | null } = { club: { levelSystemEnabled: true } };
jest.mock('../lib/ClubProvider', () => ({ useClub: () => clubVal }));

const lvl = { level: 4.2, tier: 'Intermédiaire', isProvisional: false, reliability: 92 };

it('LevelChip affiche le niveau quand activé', () => {
  clubVal.club = { levelSystemEnabled: true };
  render(<ThemeProvider><LevelChip level={lvl as any} /></ThemeProvider>);
  expect(screen.getByText('4.2')).toBeInTheDocument();
});
it('LevelChip ne rend rien quand désactivé', () => {
  clubVal.club = { levelSystemEnabled: false };
  const { container } = render(<ThemeProvider><LevelChip level={lvl as any} /></ThemeProvider>);
  expect(container).toBeEmptyDOMElement();
});
it('LevelBadge ne rend rien quand désactivé', () => {
  clubVal.club = { levelSystemEnabled: false };
  const { container } = render(<ThemeProvider><LevelBadge rating={{ level: 4.2, tier: 'Intermédiaire', isProvisional: false } as any} /></ThemeProvider>);
  expect(container).toBeEmptyDOMElement();
});
it('LevelBadge affiche la fiabilité en %', () => {
  clubVal.club = { levelSystemEnabled: true };
  render(<ThemeProvider><LevelBadge rating={{ level: 4.2, tier: 'Intermédiaire', isProvisional: true, reliability: 62 } as any} /></ThemeProvider>);
  expect(screen.getByText(/62\s*%/)).toBeInTheDocument();
});
