import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LegalUpdateBanner } from '../components/LegalUpdateBanner';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/api', () => ({ api: { getMyProfile: jest.fn(), acceptLegal: jest.fn() } }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { api } = require('../lib/api') as { api: Record<string, jest.Mock> };

const PROFILE_BASE = { id: 'u1', email: 'e@x.fr', firstName: 'E', lastName: 'N' };
const wrap = () => render(<ThemeProvider><LegalUpdateBanner /></ThemeProvider>);

describe('LegalUpdateBanner', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rien quand tout est à jour', async () => {
    api.getMyProfile.mockResolvedValue({ ...PROFILE_BASE, legal: {
      cgu: { accepted: '2026-07-18', current: '2026-07-18' },
      privacy: { accepted: '2026-07-18', current: '2026-07-18' },
    } });
    wrap();
    await waitFor(() => expect(api.getMyProfile).toHaveBeenCalled());
    expect(screen.queryByText(/conditions ont évolué/)).not.toBeInTheDocument();
  });

  it('document en retard → bandeau, « J\'ai compris » accepte et masque', async () => {
    api.getMyProfile.mockResolvedValue({ ...PROFILE_BASE, legal: {
      cgu: { accepted: null, current: '2026-07-18' },
      privacy: { accepted: '2026-07-18', current: '2026-07-18' },
    } });
    api.acceptLegal.mockResolvedValue({ ok: true });
    wrap();
    await screen.findByText(/conditions ont évolué/);
    expect(screen.getByRole('link', { name: 'CGU' })).toHaveAttribute('href', '/cgu');
    fireEvent.click(screen.getByRole('button', { name: /J'ai compris/ }));
    await waitFor(() => expect(api.acceptLegal).toHaveBeenCalledWith('CGU', 'tok'));
    await waitFor(() => expect(screen.queryByText(/conditions ont évolué/)).not.toBeInTheDocument());
  });
});
