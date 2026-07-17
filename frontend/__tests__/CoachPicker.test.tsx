import { render, screen, fireEvent, createEvent } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { CoachPicker } from '../components/admin/planning/CoachPicker';
import type { Coach } from '../lib/api';

const coaches: Coach[] = [
  { id: 'c-1', clubId: 'club-1', name: 'Lucas Moreau', photoUrl: null, isActive: true, sortOrder: 0 },
  { id: 'c-2', clubId: 'club-1', name: 'Jean Hub', photoUrl: null, isActive: true, sortOrder: 1 },
];

function setup(over: Partial<React.ComponentProps<typeof CoachPicker>> = {}) {
  const onSelect = jest.fn();
  const onClear = jest.fn();
  render(
    <ThemeProvider>
      <CoachPicker coaches={coaches} value={null} onSelect={onSelect} onClear={onClear} {...over} />
    </ThemeProvider>,
  );
  return { onSelect, onClear };
}

describe('CoachPicker', () => {
  it('affiche une loupe dans le champ de recherche', () => {
    setup();
    expect(screen.getByTestId('coach-search-loupe').querySelector('svg')).toBeInTheDocument();
  });

  it('filtre les coachs et sélectionne au clic', () => {
    const { onSelect } = setup();
    fireEvent.change(screen.getByPlaceholderText('Rechercher un coach…'), { target: { value: 'jean' } });
    fireEvent.click(screen.getByText('Jean Hub'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-2' }));
  });

  it('empêche le mousedown sur une ligne de faire perdre le focus (sinon le blur ferme la liste avant le clic)', () => {
    setup();
    fireEvent.focus(screen.getByPlaceholderText('Rechercher un coach…'));
    const row = screen.getByText('Jean Hub').closest('button')!;
    const mouseDown = createEvent.mouseDown(row);
    fireEvent(row, mouseDown);
    expect(mouseDown.defaultPrevented).toBe(true);
  });

  it('affiche le coach sélectionné en chip et « Changer » appelle onClear', () => {
    const { onClear } = setup({ value: coaches[0] });
    expect(screen.getByText('Lucas Moreau')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Changer'));
    expect(onClear).toHaveBeenCalled();
  });

  it('liste vide : message invitant à nommer un coach depuis les membres', () => {
    setup({ coaches: [] });
    fireEvent.focus(screen.getByPlaceholderText('Rechercher un coach…'));
    expect(screen.getByText(/Aucun coach actif/)).toBeInTheDocument();
  });
});
