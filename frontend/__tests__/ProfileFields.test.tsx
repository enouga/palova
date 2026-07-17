import { render, screen, fireEvent, within } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { CardKicker } from '../components/profile/CardKicker';
import { ProfileInput, ProfileSelect, PillChoice } from '../components/profile/ProfileFields';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('CardKicker', () => {
  it('affiche le libellé', () => {
    wrap(<CardKicker>Informations</CardKicker>);
    expect(screen.getByText('Informations')).toBeInTheDocument();
  });
});

describe('ProfileInput', () => {
  it('expose son libellé à l’accessibilité et remonte la saisie', () => {
    const onChange = jest.fn();
    wrap(<ProfileInput label="Téléphone" value="06" onChange={onChange} />);
    const input = screen.getByLabelText('Téléphone');
    expect(input).toHaveValue('06');
    fireEvent.change(input, { target: { value: '0700000000' } });
    expect(onChange).toHaveBeenCalledWith('0700000000');
  });

  it('n’annonce le libellé qu’une fois (le libellé visuel est aria-hidden)', () => {
    wrap(<ProfileInput label="Téléphone" value="" onChange={() => {}} />);
    // Un seul nœud accessible nommé « Téléphone » : l'input. Le libellé peint est masqué.
    expect(screen.getAllByLabelText('Téléphone')).toHaveLength(1);
  });

  it('le focus se reflète sur le bloc (anneau d’accent)', () => {
    const { container } = wrap(<ProfileInput label="Téléphone" value="" onChange={() => {}} />);
    const shell = container.firstElementChild as HTMLElement;
    const atRest = shell.style.boxShadow;
    fireEvent.focus(screen.getByLabelText('Téléphone'));
    expect(shell.style.boxShadow).not.toBe(atRest);
    fireEvent.blur(screen.getByLabelText('Téléphone'));
    expect(shell.style.boxShadow).toBe(atRest);
  });
});

describe('ProfileSelect', () => {
  it('rend ses options et remonte le choix', () => {
    const onChange = jest.fn();
    wrap(<ProfileSelect label="Langue" value="fr" onChange={onChange}
      options={[{ value: 'fr', label: 'Français' }, { value: 'es', label: 'Español' }]} />);
    const select = screen.getByLabelText('Langue');
    expect(select).toHaveValue('fr');
    fireEvent.change(select, { target: { value: 'es' } });
    expect(onChange).toHaveBeenCalledWith('es');
  });
});

describe('PillChoice', () => {
  it('rend un groupe de pills et remonte le choix', () => {
    const onChange = jest.fn();
    wrap(<PillChoice label="Sexe" value="MALE" onChange={onChange}
      options={[{ value: 'MALE', label: 'Homme' }, { value: 'FEMALE', label: 'Femme' }]} />);
    const group = screen.getByRole('group', { name: 'Sexe' });
    fireEvent.click(within(group).getByRole('button', { name: 'Femme' }));
    expect(onChange).toHaveBeenCalledWith('FEMALE');
  });

  it('marque la pill active (aria-pressed)', () => {
    wrap(<PillChoice label="Sexe" value="MALE" onChange={() => {}}
      options={[{ value: 'MALE', label: 'Homme' }, { value: 'FEMALE', label: 'Femme' }]} />);
    expect(screen.getByRole('button', { name: 'Homme' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Femme' })).toHaveAttribute('aria-pressed', 'false');
  });
});
