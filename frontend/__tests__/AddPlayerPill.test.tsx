import { render, screen, fireEvent } from '@testing-library/react';
import { AddPlayerPill } from '../components/player/AddPlayerPill';
import { ThemeProvider } from '../lib/ThemeProvider';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('AddPlayerPill', () => {
  it('affiche le libellé par défaut « Ajouter un joueur »', () => {
    wrap(<AddPlayerPill onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Ajouter un joueur' })).toBeInTheDocument();
  });

  it('accepte un libellé et un aria-label personnalisés', () => {
    wrap(<AddPlayerPill onClick={() => {}} label="Ajouter" ariaLabel="Ajouter un joueur à Terrain 1" />);
    expect(screen.getByRole('button', { name: 'Ajouter un joueur à Terrain 1' })).toBeInTheDocument();
    expect(screen.getByText('Ajouter')).toBeInTheDocument();
  });

  it('déclenche onClick au clic', () => {
    const onClick = jest.fn();
    wrap(<AddPlayerPill onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un joueur' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('ne déclenche pas onClick quand disabled', () => {
    const onClick = jest.fn();
    wrap(<AddPlayerPill onClick={onClick} disabled />);
    const btn = screen.getByRole('button', { name: 'Ajouter un joueur' });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});
