import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { PlayerActionSheet } from '@/components/match/PlayerActionSheet';

const player = { userId: 'u1', firstName: 'Karim', lastName: 'Benali', team: 2 as const };

const base = {
  player, playerName: 'Karim Benali', slotLabel: 'G', teamColor: '#ff7a4d', team: 2 as const,
  canMove: true, canReplace: true, canRemove: true,
  onMove: jest.fn(), onReplace: jest.fn(), onRemove: jest.fn(), onClose: jest.fn(),
};

const wrap = (over = {}) => render(<ThemeProvider><PlayerActionSheet {...base} {...over} /></ThemeProvider>);

describe('PlayerActionSheet', () => {
  beforeEach(() => jest.clearAllMocks());

  it("affiche l'identité, la chip d'équipe et les 3 actions", () => {
    wrap();
    expect(screen.getByText('Karim Benali')).toBeInTheDocument();
    expect(screen.getByText(/ÉQ\. 2 · G/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Passer dans l'équipe 1/ }));
    expect(base.onMove).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Remplacer par un autre joueur/ }));
    expect(base.onReplace).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Retirer de la partie/ }));
    expect(base.onRemove).toHaveBeenCalled();
  });

  it('masque les actions non permises (canMove/canReplace/canRemove à false)', () => {
    wrap({ canMove: false, canReplace: false, canRemove: false });
    expect(screen.queryByRole('button', { name: /Passer dans l'équipe 1/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remplacer/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retirer de la partie/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
  });

  it('busy : les actions sont désactivées (Annuler reste actif)', () => {
    wrap({ busy: true });
    expect(screen.getByRole('button', { name: /Passer dans l'équipe 1/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Remplacer par un autre joueur/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Retirer de la partie/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeEnabled();
  });

  it("« Annuler » ferme la feuille", () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(base.onClose).toHaveBeenCalled();
  });
});
