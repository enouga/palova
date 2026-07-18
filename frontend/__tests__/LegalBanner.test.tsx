import { render, screen, waitFor } from '@testing-library/react';
import { LegalBanner } from '../components/admin/LegalBanner';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../lib/api', () => ({ api: { adminGetClub: jest.fn() } }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { api } = require('../lib/api') as { api: Record<string, jest.Mock> };

const wrap = () => render(<ThemeProvider><LegalBanner clubId="c1" token="t" /></ThemeProvider>);

describe('LegalBanner', () => {
  beforeEach(() => jest.clearAllMocks());

  it('affichée quand Stripe est ACTIVE et les infos légales incomplètes', async () => {
    api.adminGetClub.mockResolvedValue({ stripeAccountStatus: 'ACTIVE', legalEntityName: null, siret: '123', legalEmail: null, mediatorName: null });
    wrap();
    await screen.findByText(/complétez vos informations légales/i);
  });

  it('rien quand les 4 champs sont remplis', async () => {
    api.adminGetClub.mockResolvedValue({ stripeAccountStatus: 'ACTIVE', legalEntityName: 'X', siret: '1', legalEmail: 'a@b.fr', mediatorName: 'CM2C' });
    const { container } = wrap();
    await waitFor(() => expect(api.adminGetClub).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('rien quand Stripe n\'est pas actif', async () => {
    api.adminGetClub.mockResolvedValue({ stripeAccountStatus: 'NONE', legalEntityName: null, siret: null, legalEmail: null, mediatorName: null });
    const { container } = wrap();
    await waitFor(() => expect(api.adminGetClub).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
