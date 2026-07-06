import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StepRules } from '@/components/onboarding/StepRules';
import { StepLaunch } from '@/components/onboarding/StepLaunch';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { ClubAdminDetail } from '@/lib/api';
import { PreviewState } from '@/lib/onboarding';

jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: { adminUpdateClub: jest.fn() },
}));
import { api } from '@/lib/api';

const club = {
  id: 'c1', slug: 'padel-riviera', name: 'Padel Riviera',
  logoUrl: null, accentColor: '#d6ff3f', defaultThemeMode: 'floodlit',
  publicBookingDays: 7, memberBookingDays: 14, cancellationCutoffHours: 0,
  listedInDirectory: true, stripeAccountStatus: 'NONE',
} as unknown as ClubAdminDetail;

const preview: PreviewState = {
  name: 'Padel Riviera', slug: 'padel-riviera', logoUrl: null, accentColor: '#d6ff3f',
  sports: [{ key: 'padel', name: 'Padel', icon: '🎾', noun: 'piste', courtCount: 4, minPrice: 25 }],
};

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('StepRules', () => {
  beforeEach(() => jest.clearAllMocks());

  it('presets pré-sélectionnés depuis le club, save envoie les 3 champs', async () => {
    (api.adminUpdateClub as jest.Mock).mockResolvedValue(club);
    const onPatched = jest.fn(); const advance = jest.fn();
    wrap(<StepRules club={club} clubId="c1" token="t" onPatched={onPatched} advance={advance} />);
    // présélection initiale depuis les valeurs du club (7/14 j, « Jusqu’au début »)
    expect(screen.getByText('7 jours').closest('button')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByText('14 jours'));
    fireEvent.click(screen.getByText('24 h avant'));
    fireEvent.click(screen.getByText('Continuer →'));
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalledWith(
      'c1', { publicBookingDays: 14, memberBookingDays: 28, cancellationCutoffHours: 24 }, 't',
    ));
    expect(onPatched).toHaveBeenCalled();
    expect(advance).toHaveBeenCalled();
  });

  it('Passer cette étape → avance sans appel', () => {
    const advance = jest.fn();
    wrap(<StepRules club={club} clubId="c1" token="t" onPatched={jest.fn()} advance={advance} />);
    fireEvent.click(screen.getByText('Passer cette étape'));
    expect(api.adminUpdateClub).not.toHaveBeenCalled();
    expect(advance).toHaveBeenCalled();
  });

  it('échec API du save des règles → message, pas d’avance', async () => {
    (api.adminUpdateClub as jest.Mock).mockRejectedValue(new Error('boom'));
    const advance = jest.fn();
    wrap(<StepRules club={club} clubId="c1" token="t" onPatched={jest.fn()} advance={advance} />);
    fireEvent.click(screen.getByText('Continuer →'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();
  });
});

describe('StepLaunch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } });
  });

  it('mise en ligne → persiste listedInDirectory puis affiche le final festif', async () => {
    (api.adminUpdateClub as jest.Mock).mockResolvedValue(club);
    const onFinished = jest.fn();
    wrap(<StepLaunch club={club} preview={preview} clubId="c1" token="t" onPatched={jest.fn()} onFinished={onFinished} />);
    fireEvent.click(screen.getByText(/Mettre mon club en ligne/));
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalledWith('c1', { listedInDirectory: true }, 't'));
    expect(onFinished).toHaveBeenCalled();
    // le final : titre, URL copiable, récap, CTAs
    expect(screen.getByText(/en ligne\./)).toBeInTheDocument();
    // l'URL apparaît deux fois (chip copiable + aperçu téléphone) — les deux sont voulues
    expect(screen.getAllByText('padel-riviera.palova.fr').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('✓ Padel · 4 pistes')).toBeInTheDocument();
    expect(screen.getByText(/Paiement en ligne · plus tard/)).toBeInTheDocument();
    expect(screen.getByText(/Découvrir mon club-house/).closest('a')).toHaveAttribute('href', '/');
    expect(screen.getByText(/Aller à l’espace de gestion/).closest('a')).toHaveAttribute('href', '/admin');
  });

  it('décocher l’annuaire → envoie listedInDirectory: false', async () => {
    (api.adminUpdateClub as jest.Mock).mockResolvedValue({ ...club, listedInDirectory: false });
    wrap(<StepLaunch club={club} preview={preview} clubId="c1" token="t" onPatched={jest.fn()} onFinished={jest.fn()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /annuaire/i }));
    fireEvent.click(screen.getByText(/Mettre mon club en ligne/));
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalledWith('c1', { listedInDirectory: false }, 't'));
  });

  it('copier l’URL du club', async () => {
    (api.adminUpdateClub as jest.Mock).mockResolvedValue(club);
    wrap(<StepLaunch club={club} preview={preview} clubId="c1" token="t" onPatched={jest.fn()} onFinished={jest.fn()} />);
    fireEvent.click(screen.getByText(/Mettre mon club en ligne/));
    await screen.findAllByText('padel-riviera.palova.fr');
    fireEvent.click(screen.getByText(/Copier/));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('padel-riviera')));
    expect(await screen.findByText(/Copié/)).toBeInTheDocument();
  });

  it('échec API de la mise en ligne → message, on reste sur le formulaire', async () => {
    (api.adminUpdateClub as jest.Mock).mockRejectedValue(new Error('boom'));
    const onFinished = jest.fn();
    wrap(<StepLaunch club={club} preview={preview} clubId="c1" token="t" onPatched={jest.fn()} onFinished={onFinished} />);
    fireEvent.click(screen.getByText(/Mettre mon club en ligne/));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onFinished).not.toHaveBeenCalled();
    expect(screen.getByText(/Mettre mon club en ligne/)).toBeInTheDocument(); // toujours phase form
  });
});
