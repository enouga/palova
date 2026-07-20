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
