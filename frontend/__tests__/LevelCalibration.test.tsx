import { render, screen, fireEvent } from '@testing-library/react';
import { LevelCalibration } from '@/components/player/LevelCalibration';

describe('LevelCalibration', () => {
  it('affiche le niveau courant et son palier (défaut 4,0 → Intermédiaire)', () => {
    render(<LevelCalibration onSelect={() => {}} onSkip={() => {}} busy={false} />);
    expect(screen.getByRole('slider')).toBeInTheDocument();
    expect(screen.getByText('4,0')).toBeInTheDocument();
    expect(screen.getByText('Intermédiaire')).toBeInTheDocument();
  });

  it('le curseur permet un niveau au dixième et Valider renvoie la valeur exacte', () => {
    const onSelect = jest.fn();
    render(<LevelCalibration onSelect={onSelect} onSkip={() => {}} busy={false} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '7.2' } });
    expect(screen.getByText('7,2')).toBeInTheDocument();
    expect(screen.getByText('Expert')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Valider/));
    expect(onSelect).toHaveBeenCalledWith(7.2);
  });

  it('« Passer » appelle onSkip', () => {
    const onSkip = jest.fn();
    render(<LevelCalibration onSelect={() => {}} onSkip={onSkip} busy={false} />);
    fireEvent.click(screen.getByText('Passer'));
    expect(onSkip).toHaveBeenCalled();
  });
});
