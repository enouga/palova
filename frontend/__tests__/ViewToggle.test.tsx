import { render, screen, fireEvent } from '@testing-library/react';
import { ViewToggle } from '../components/reserve/ViewToggle';
import { ThemeProvider } from '../lib/ThemeProvider';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('ViewToggle', () => {
  it('reflète la vue active via aria-pressed', () => {
    wrap(<ViewToggle value="cards" onChange={() => {}} />);
    expect(screen.getByLabelText('Vue liste')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Vue grille')).toHaveAttribute('aria-pressed', 'false');
  });

  it('émet la nouvelle vue au clic', () => {
    const onChange = jest.fn();
    wrap(<ViewToggle value="cards" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Vue grille'));
    expect(onChange).toHaveBeenCalledWith('grid');
  });
});
