import { render, screen, fireEvent } from '@testing-library/react';
import { PlayerPills, PlayerPillData } from '../components/player/PlayerPills';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/api', () => ({ assetUrl: (p: string | null) => p }));

const players: PlayerPillData[] = [
  { userId: 'u-org',  firstName: 'Org',  lastName: 'A',       avatarUrl: null, isOrganizer: true,  participantId: 'p1' },
  { userId: 'u-emma', firstName: 'Emma', lastName: 'Bernard', avatarUrl: null, isOrganizer: false, participantId: 'p2' },
];
const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('PlayerPills', () => {
  it('affiche les joueurs, le badge orga et les cases « Place libre »', () => {
    wrap(<PlayerPills players={players} spotsLeft={2} />);
    expect(screen.getByText('Org A')).toBeInTheDocument();
    expect(screen.getByText('Emma Bernard')).toBeInTheDocument();
    expect(screen.getByText('orga')).toBeInTheDocument();
    expect(screen.getAllByText('Place libre')).toHaveLength(2);
  });

  it('n affiche aucun × sans onRemove', () => {
    wrap(<PlayerPills players={players} />);
    expect(screen.queryByLabelText('Retirer Emma Bernard')).not.toBeInTheDocument();
  });

  it('affiche le × uniquement pour les joueurs retirables et appelle onRemove', () => {
    const onRemove = jest.fn();
    wrap(<PlayerPills players={players} onRemove={onRemove} canRemove={(p) => !p.isOrganizer} />);
    expect(screen.queryByLabelText('Retirer Org A')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Retirer Emma Bernard'));
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ participantId: 'p2', userId: 'u-emma' }));
  });

  it('désactive le × quand busy', () => {
    wrap(<PlayerPills players={players} onRemove={jest.fn()} canRemove={() => true} busy />);
    expect(screen.getByLabelText('Retirer Emma Bernard')).toBeDisabled();
  });

  it('remplace la première place libre par firstSpotSlot', () => {
    wrap(<PlayerPills players={players} spotsLeft={2} firstSpotSlot={<button>Ajouter</button>} />);
    expect(screen.getByText('Ajouter')).toBeInTheDocument();
    expect(screen.getAllByText('Place libre')).toHaveLength(1);
  });
});
