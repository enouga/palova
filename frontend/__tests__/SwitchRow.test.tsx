import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { SwitchRow } from '@/components/ui/SwitchRow';

const wrap = (checked: boolean, onChange = jest.fn()) =>
  render(
    <ThemeProvider>
      <SwitchRow checked={checked} onChange={onChange} title="Annuaire public" description="Visible dans la recherche." />
    </ThemeProvider>,
  );

describe('SwitchRow', () => {
  it('renders title + description and reflects checked state', () => {
    wrap(true);
    expect(screen.getByText('Annuaire public')).toBeInTheDocument();
    expect(screen.getByText('Visible dans la recherche.')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onChange with the negated value on click', () => {
    const onChange = jest.fn();
    wrap(false, onChange);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
