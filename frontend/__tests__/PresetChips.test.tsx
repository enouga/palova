import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { PresetChips } from '@/components/admin/settings/PresetChips';

const wrap = (value: number, onChange = jest.fn(), format?: (n: number) => string) =>
  render(
    <ThemeProvider>
      <PresetChips presets={[7, 14, 30]} value={value} onChange={onChange} unit="jours" format={format} />
    </ThemeProvider>,
  );

describe('PresetChips', () => {
  it('marks the matching preset chip active and hides the custom input', () => {
    wrap(14);
    expect(screen.getByRole('button', { name: '14 jours' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('selects "Autre…" and shows the input when value is off-preset', () => {
    wrap(21);
    expect(screen.getByRole('button', { name: 'Autre…' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('spinbutton')).toHaveValue(21);
  });

  it('emits the preset value on chip click', () => {
    const onChange = jest.fn();
    wrap(7, onChange);
    fireEvent.click(screen.getByRole('button', { name: '30 jours' }));
    expect(onChange).toHaveBeenCalledWith(30);
  });

  it('reveals the input when "Autre…" is clicked and emits typed numbers', () => {
    const onChange = jest.fn();
    wrap(7, onChange);
    fireEvent.click(screen.getByRole('button', { name: 'Autre…' }));
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '45' } });
    expect(onChange).toHaveBeenCalledWith(45);
  });

  it('uses format() for chip labels when provided', () => {
    wrap(7, jest.fn(), (n) => (n === 0 ? 'Jusqu’au début' : `${n} h`));
    expect(screen.getByRole('button', { name: '14 h' })).toBeInTheDocument();
  });
});
