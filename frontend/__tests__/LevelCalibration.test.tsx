import { render, screen, fireEvent } from '@testing-library/react';
import { LevelCalibration } from '@/components/player/LevelCalibration';

describe('LevelCalibration', () => {
  it('affiche les 8 paliers', () => {
    render(<LevelCalibration onSelect={() => {}} onSkip={() => {}} busy={false} />);
    expect(screen.getByText('Débutant')).toBeInTheDocument();
    expect(screen.getByText('Élite')).toBeInTheDocument();
  });

  it('cliquer un palier appelle onSelect avec son niveau', () => {
    const onSelect = jest.fn();
    render(<LevelCalibration onSelect={onSelect} onSkip={() => {}} busy={false} />);
    fireEvent.click(screen.getByText('Intermédiaire'));
    expect(onSelect).toHaveBeenCalledWith(4);
  });

  it('« Passer » appelle onSkip', () => {
    const onSkip = jest.fn();
    render(<LevelCalibration onSelect={() => {}} onSkip={onSkip} busy={false} />);
    fireEvent.click(screen.getByText('Passer'));
    expect(onSkip).toHaveBeenCalled();
  });
});
