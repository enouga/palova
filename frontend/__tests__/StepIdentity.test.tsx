import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StepIdentity } from '@/components/onboarding/StepIdentity';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { ClubAdminDetail } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: {
    adminUpdateClub: jest.fn(),
    uploadClubLogo: jest.fn(),
  },
}));
import { api } from '@/lib/api';

const club = {
  id: 'c1', slug: 'padel-riviera', name: 'Padel Riviera',
  logoUrl: null, accentColor: '#d6ff3f', defaultThemeMode: 'floodlit',
} as unknown as ClubAdminDetail;

const setup = () => {
  const onLocal = jest.fn();
  const onPatched = jest.fn();
  const advance = jest.fn();
  render(
    <ThemeProvider>
      <StepIdentity club={club} clubId="c1" token="t" onLocal={onLocal} onPatched={onPatched} advance={advance} />
    </ThemeProvider>,
  );
  return { onLocal, onPatched, advance };
};

describe('StepIdentity', () => {
  beforeEach(() => jest.clearAllMocks());

  it('choisir une couleur remonte instantanément via onLocal (aperçu vivant)', () => {
    const { onLocal } = setup();
    fireEvent.click(screen.getByLabelText('Accent #5e93da'));
    expect(onLocal).toHaveBeenCalledWith({ accentColor: '#5e93da' });
  });

  it('Continuer → persiste accent + thème, propage le club serveur et avance', async () => {
    (api.adminUpdateClub as jest.Mock).mockResolvedValue({ ...club, accentColor: '#d6ff3f' });
    const { onPatched, advance } = setup();
    fireEvent.click(screen.getByText('Continuer →'));
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalledWith(
      'c1', { accentColor: '#d6ff3f', defaultThemeMode: 'floodlit' }, 't',
    ));
    expect(onPatched).toHaveBeenCalled();
    expect(advance).toHaveBeenCalled();
  });

  it('échec API → message, on reste sur l’étape', async () => {
    (api.adminUpdateClub as jest.Mock).mockRejectedValue(new Error('boom'));
    const { advance } = setup();
    fireEvent.click(screen.getByText('Continuer →'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();
  });

  it('upload logo → uploadClubLogo puis onLocal({ logoUrl })', async () => {
    (api.uploadClubLogo as jest.Mock).mockResolvedValue({ logoUrl: '/uploads/x.png' });
    const { onLocal } = setup();
    const input = screen.getByLabelText('Importer votre logo') as HTMLInputElement;
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(api.uploadClubLogo).toHaveBeenCalledWith('c1', file, 't'));
    expect(onLocal).toHaveBeenCalledWith({ logoUrl: '/uploads/x.png' });
  });

  it('Passer cette étape → avance sans appel API', () => {
    const { advance } = setup();
    fireEvent.click(screen.getByText('Passer cette étape'));
    expect(api.adminUpdateClub).not.toHaveBeenCalled();
    expect(advance).toHaveBeenCalled();
  });

  it('pendant l’upload du logo, Continuer et Passer sont verrouillés', async () => {
    let release!: (v: { logoUrl: string }) => void;
    (api.uploadClubLogo as jest.Mock).mockImplementation(() => new Promise((r) => { release = r; }));
    const { onLocal } = setup();
    const input = screen.getByLabelText('Importer votre logo') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'logo.png', { type: 'image/png' })] } });
    expect(await screen.findByText('Envoi…')).toBeInTheDocument();
    expect(screen.getByText('Continuer →')).toBeDisabled();
    expect(screen.getByText('Passer cette étape')).toBeDisabled();
    release({ logoUrl: '/uploads/x.png' });
    await waitFor(() => expect(onLocal).toHaveBeenCalledWith({ logoUrl: '/uploads/x.png' }));
    expect(screen.getByText('Continuer →')).not.toBeDisabled();
  });
});
