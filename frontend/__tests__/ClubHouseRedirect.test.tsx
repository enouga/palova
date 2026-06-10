import { render } from '@testing-library/react';
import ClubHousePage from '../app/club-house/page';

const replace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

it('/club-house redirige vers la racine (Club-house)', () => {
  render(<ClubHousePage />);
  expect(replace).toHaveBeenCalledWith('/');
});
