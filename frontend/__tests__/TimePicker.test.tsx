import { render, screen, fireEvent } from '@testing-library/react';
import { TimePicker } from '../components/ui/TimePicker';
import { ThemeProvider } from '../lib/ThemeProvider';

function renderTP(props: Partial<React.ComponentProps<typeof TimePicker>> = {}) {
  const onChange = jest.fn();
  render(
    <ThemeProvider>
      <TimePicker value="14:30" onChange={onChange} {...props} />
    </ThemeProvider>,
  );
  return { onChange };
}

describe('TimePicker', () => {
  it('affiche l’heure et les minutes courantes', () => {
    renderTP();
    expect(screen.getByRole('spinbutton', { name: 'Heures' })).toHaveTextContent('14');
    expect(screen.getByRole('spinbutton', { name: 'Minutes' })).toHaveTextContent('30');
  });

  it('affiche le placeholder quand la valeur est vide', () => {
    renderTP({ value: '' });
    expect(screen.getByRole('spinbutton', { name: 'Heures' })).toHaveTextContent('--');
    expect(screen.getByRole('spinbutton', { name: 'Minutes' })).toHaveTextContent('--');
  });

  it('incrémente / décrémente l’heure (avec bouclage)', () => {
    const { onChange } = renderTP({ value: '23:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Heures +' }));
    expect(onChange).toHaveBeenLastCalledWith('00:00');
    fireEvent.click(screen.getByRole('button', { name: 'Heures -' }));
    expect(onChange).toHaveBeenLastCalledWith('22:00');
  });

  it('incrémente les minutes par pas (défaut 5)', () => {
    const { onChange } = renderTP({ value: '14:30' });
    fireEvent.click(screen.getByRole('button', { name: 'Minutes +' }));
    expect(onChange).toHaveBeenLastCalledWith('14:35');
  });

  it('reporte les minutes sur l’heure (retenue)', () => {
    const { onChange } = renderTP({ value: '14:55' });
    fireEvent.click(screen.getByRole('button', { name: 'Minutes +' }));
    expect(onChange).toHaveBeenLastCalledWith('15:00');
  });

  it('respecte un pas de minutes personnalisé', () => {
    const { onChange } = renderTP({ value: '14:30', minuteStep: 30 });
    fireEvent.click(screen.getByRole('button', { name: 'Minutes +' }));
    expect(onChange).toHaveBeenLastCalledWith('15:00');
  });

  it('une puce de minutes fixe les minutes en gardant l’heure', () => {
    const { onChange } = renderTP({ value: '14:30' });
    fireEvent.click(screen.getByText(':15'));
    expect(onChange).toHaveBeenLastCalledWith('14:15');
  });

  it('un preset pose l’heure complète', () => {
    const { onChange } = renderTP({ value: '14:30', presets: ['08:00', '20:00'] });
    fireEvent.click(screen.getByText('08h00'));
    expect(onChange).toHaveBeenLastCalledWith('08:00');
  });

  it('les flèches clavier ajustent la tuile focalisée', () => {
    const { onChange } = renderTP({ value: '14:30' });
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Heures' }), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith('15:30');
  });
});
