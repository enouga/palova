import { render, screen, fireEvent } from '@testing-library/react';
import { Pill, PillTabs } from '../components/ui/atoms';
import { ThemeProvider } from '../lib/ThemeProvider';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('Pill', () => {
  it('rend le libellé et signale l\'état actif', () => {
    wrap(<Pill label="Padel" active onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Padel' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('appelle onClick au clic', () => {
    const fn = jest.fn();
    wrap(<Pill label="Tennis" active={false} onClick={fn} />);
    fireEvent.click(screen.getByText('Tennis'));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('PillTabs', () => {
  const options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];

  it('rend une pastille par option et marque la valeur active', () => {
    wrap(<PillTabs options={options} value="a" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'A' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'B' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('appelle onChange avec la valeur cliquée', () => {
    const fn = jest.fn();
    wrap(<PillTabs options={options} value="a" onChange={fn} />);
    fireEvent.click(screen.getByText('B'));
    expect(fn).toHaveBeenCalledWith('b');
  });
});
