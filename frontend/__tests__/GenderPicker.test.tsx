import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { GenderPicker } from '@/components/reservations/GenderPicker';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

it('rend les 3 options et surligne la valeur active', () => {
  wrap(<GenderPicker value={null} onChange={() => {}} />);
  expect(screen.getByRole('button', { name: 'Ouverte à tous' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Féminine' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mixte' })).toBeInTheDocument();
});

it('émet la valeur choisie', () => {
  const onChange = jest.fn();
  wrap(<GenderPicker value={null} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Féminine' }));
  expect(onChange).toHaveBeenCalledWith('WOMEN');
  fireEvent.click(screen.getByRole('button', { name: 'Mixte' }));
  expect(onChange).toHaveBeenCalledWith('MIXED');
});
