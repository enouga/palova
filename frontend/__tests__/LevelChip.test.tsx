import { render, screen } from '@testing-library/react';
import { LevelChip } from '../components/player/LevelChip';
import { LevelBadge } from '../components/player/LevelBadge';

const clubVal: { club: { levelSystemEnabled?: boolean } | null } = { club: { levelSystemEnabled: true } };
jest.mock('../lib/ClubProvider', () => ({ useClub: () => clubVal }));

const lvl = { level: 4.2, tier: 'Intermédiaire', isProvisional: false };

it('LevelChip affiche le niveau quand activé', () => {
  clubVal.club = { levelSystemEnabled: true };
  render(<LevelChip level={lvl as any} />);
  expect(screen.getByText('4.2')).toBeInTheDocument();
});
it('LevelChip ne rend rien quand désactivé', () => {
  clubVal.club = { levelSystemEnabled: false };
  const { container } = render(<LevelChip level={lvl as any} />);
  expect(container).toBeEmptyDOMElement();
});
it('LevelBadge ne rend rien quand désactivé', () => {
  clubVal.club = { levelSystemEnabled: false };
  const { container } = render(<LevelBadge rating={{ level: 4.2, tier: 'Intermédiaire', isProvisional: false } as any} />);
  expect(container).toBeEmptyDOMElement();
});
