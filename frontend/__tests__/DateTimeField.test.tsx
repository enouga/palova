import { render, screen, fireEvent } from '@testing-library/react';
import { DateTimeField } from '../components/ui/DateTimeField';
import { ThemeProvider } from '../lib/ThemeProvider';

function renderDTF(props: Partial<React.ComponentProps<typeof DateTimeField>> = {}) {
  const onChange = jest.fn();
  render(
    <ThemeProvider>
      <DateTimeField value="2026-07-09T14:30" onChange={onChange} {...props} />
    </ThemeProvider>,
  );
  return { onChange };
}

describe('DateTimeField', () => {
  it('compose date (calendrier maison) et heure (TimePicker)', () => {
    renderDTF();
    expect(screen.getByText('09/07/2026')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Heures' })).toHaveTextContent('14');
    expect(screen.getByRole('spinbutton', { name: 'Minutes' })).toHaveTextContent('30');
  });

  it('changer la date conserve l’heure', () => {
    const { onChange } = renderDTF();
    fireEvent.click(screen.getByText('09/07/2026')); // ouvre le popup (mois de la valeur)
    fireEvent.click(screen.getByLabelText('15/07/2026'));
    expect(onChange).toHaveBeenLastCalledWith('2026-07-15T14:30');
  });

  it('choisir une date sans heure applique defaultTime', () => {
    const { onChange } = renderDTF({ value: '', defaultTime: '09:00' });
    fireEvent.click(screen.getByText('jj/mm/aaaa')); // ouvre le popup (mois courant)
    fireEvent.click(screen.getByText("Aujourd'hui"));
    expect(onChange).toHaveBeenLastCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T09:00$/));
  });

  it('choisir une heure sans date utilise la date du jour', () => {
    const { onChange } = renderDTF({ value: '' });
    fireEvent.click(screen.getByText(':15'));
    expect(onChange).toHaveBeenLastCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T18:15$/));
  });

  it('clearable : « Effacer » (à côté du champ) remet la valeur à vide', () => {
    const { onChange } = renderDTF({ clearable: true });
    fireEvent.click(screen.getByText('Effacer'));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('sans clearable, pas de bouton Effacer hors popup', () => {
    renderDTF();
    expect(screen.queryByText('Effacer')).toBeNull();
  });
});
