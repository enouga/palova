import { render } from '@testing-library/react';
import InfosPage from '../app/infos/page';

const replace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

it('/infos redirige vers /club-house', () => {
  render(<InfosPage />);
  expect(replace).toHaveBeenCalledWith('/club-house');
});
