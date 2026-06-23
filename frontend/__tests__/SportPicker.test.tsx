import { render, screen, fireEvent } from '@testing-library/react';
import { SportPicker, SportOption } from '../components/reserve/SportPicker';
import { ThemeProvider } from '../lib/ThemeProvider';

const sports: SportOption[] = [
  { id: 'p', name: 'Padel', icon: null },
  { id: 't', name: 'Tennis', icon: null },
  { id: 's', name: 'Squash', icon: null },
];

function setup(selectedIds: string[]) {
  const onChange = jest.fn();
  render(<ThemeProvider><SportPicker sports={sports} selectedIds={selectedIds} onChange={onChange} /></ThemeProvider>);
  return onChange;
}

describe('SportPicker', () => {
  it('libellé : 1 sport', () => {
    setup(['p']);
    expect(screen.getByRole('button', { name: /Padel · changer/ })).toBeInTheDocument();
  });

  it('libellé : 2 sports (noms listés)', () => {
    setup(['p', 't']);
    expect(screen.getByRole('button', { name: /Padel, Tennis · changer/ })).toBeInTheDocument();
  });

  it('libellé : 3+ sports (+N)', () => {
    setup(['p', 't', 's']);
    expect(screen.getByRole('button', { name: /Padel \+2 · changer/ })).toBeInTheDocument();
  });

  it('ouvre le panneau et coche un sport → onChange dans l\'ordre du club', () => {
    const onChange = setup(['p']);
    fireEvent.click(screen.getByRole('button', { name: /· changer/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tennis' }));
    expect(onChange).toHaveBeenCalledWith(['p', 't']);
  });

  it('décoche un sport quand il en reste au moins un', () => {
    const onChange = setup(['p', 't']);
    fireEvent.click(screen.getByRole('button', { name: /· changer/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tennis' }));
    expect(onChange).toHaveBeenCalledWith(['p']);
  });

  it('empêche de décocher le dernier sport', () => {
    const onChange = setup(['p']);
    fireEvent.click(screen.getByRole('button', { name: /· changer/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Padel' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ferme le panneau au clic extérieur', () => {
    setup(['p']);
    fireEvent.click(screen.getByRole('button', { name: /· changer/ }));
    expect(screen.getByRole('group')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });
});
