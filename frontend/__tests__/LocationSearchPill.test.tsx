import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { LocationSearchPill } from '@/components/discover/LocationSearchPill';

const noop = () => {};
const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('LocationSearchPill', () => {
  it('saisie → onChange, Entrée → onSubmit', () => {
    const onChange = jest.fn();
    const onSubmit = jest.fn();
    wrap(<LocationSearchPill value="" onChange={onChange} onSubmit={onSubmit} onNearMe={noop} nearActive={false} locating={false} />);
    const input = screen.getByPlaceholderText('Ville, code postal ou département');
    fireEvent.change(input, { target: { value: 'Lyon' } });
    expect(onChange).toHaveBeenCalledWith('Lyon');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('Entrée sans onSubmit ne plante pas (mode contrôlé /decouvrir)', () => {
    wrap(<LocationSearchPill value="Lyon" onChange={noop} onNearMe={noop} nearActive={false} locating={false} />);
    fireEvent.keyDown(screen.getByPlaceholderText('Ville, code postal ou département'), { key: 'Enter' });
  });

  it('extra rend un élément additionnel dans la pilule ; absent par défaut', () => {
    const { rerender } = wrap(<LocationSearchPill value="" onChange={noop} onNearMe={noop} nearActive={false} locating={false} />);
    expect(screen.queryByTestId('extra-slot')).not.toBeInTheDocument();
    rerender(<ThemeProvider><LocationSearchPill value="" onChange={noop} onNearMe={noop} nearActive={false} locating={false}
      extra={<span data-testid="extra-slot">x</span>} /></ThemeProvider>);
    expect(screen.getByTestId('extra-slot')).toBeInTheDocument();
  });

  it('le ✕ n\'apparaît qu\'avec une valeur/géoloc et réinitialise (onChange vide + onClear)', () => {
    const onChange = jest.fn();
    const onClear = jest.fn();
    const { rerender } = wrap(<LocationSearchPill value="" onChange={onChange} onClear={onClear} onNearMe={noop} nearActive={false} locating={false} />);
    expect(screen.queryByRole('button', { name: 'Effacer la localisation' })).not.toBeInTheDocument();

    rerender(<ThemeProvider><LocationSearchPill value="Lyon" onChange={onChange} onClear={onClear} onNearMe={noop} nearActive={false} locating={false} /></ThemeProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Effacer la localisation' }));
    expect(onChange).toHaveBeenCalledWith('');
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('le ✕ apparaît aussi quand « autour de moi » est actif, valeur vide', () => {
    wrap(<LocationSearchPill value="" onChange={noop} onClear={noop} onNearMe={noop} nearActive={true} locating={false} />);
    expect(screen.getByRole('button', { name: 'Effacer la localisation' })).toBeInTheDocument();
  });

  it('« Autour de moi » → onNearMe, libellés selon l\'état', () => {
    const onNearMe = jest.fn();
    const { unmount } = wrap(<LocationSearchPill value="" onChange={noop} onNearMe={onNearMe} nearActive={false} locating={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Autour de moi/ }));
    expect(onNearMe).toHaveBeenCalledTimes(1);
    unmount();
    const r2 = wrap(<LocationSearchPill value="" onChange={noop} onNearMe={noop} nearActive={false} locating={true} />);
    expect(screen.getByRole('button', { name: /Localisation…/ })).toBeInTheDocument();
    r2.unmount();
    wrap(<LocationSearchPill value="" onChange={noop} onNearMe={noop} nearActive={true} locating={false} />);
    expect(screen.getByRole('button', { name: /Autour de moi ✓/ })).toBeInTheDocument();
  });
});
