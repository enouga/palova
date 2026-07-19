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

  it('le libellé peint est masqué à l’accessibilité — seul le champ porte le nom', () => {
    wrap(<ProfileInput label="Téléphone" value="" onChange={() => {}} />);
    // Le libellé est peint dans le bloc mais retiré de l'arbre d'accessibilité :
    // sans ça, un lecteur d'écran annoncerait « Téléphone » deux fois.
    expect(screen.getByText('Téléphone')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByLabelText('Téléphone').tagName).toBe('INPUT');
  });

  it('le focus se reflète sur la boîte du champ (anneau d’accent)', () => {
    wrap(<ProfileInput label="Téléphone" value="" onChange={() => {}} />);
    const box = screen.getByTestId('field-box');
    const atRest = box.style.boxShadow;
    fireEvent.focus(screen.getByLabelText('Téléphone'));
    expect(box.style.boxShadow).not.toBe(atRest);
    fireEvent.blur(screen.getByLabelText('Téléphone'));
    expect(box.style.boxShadow).toBe(atRest);
  });

  it('le libellé est rendu AVANT la boîte du champ dans le DOM (au-dessus, pas dedans)', () => {
    const { container } = wrap(<ProfileInput label="Téléphone" value="" onChange={() => {}} />);
    const label = screen.getByText('Téléphone');
    const box = screen.getByTestId('field-box');
    // compareDocumentPosition bit 4 (DOCUMENT_POSITION_FOLLOWING) = label vient avant box.
    // eslint-disable-next-line no-bitwise
    expect(label.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('[data-testid="field-box"] [aria-hidden]')).toBeNull();
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

  it('les pills ne sont pas posées dans une boîte de champ (pas de field-box)', () => {
    const { container } = wrap(<PillChoice label="Sexe" value="MALE" onChange={() => {}}
      options={[{ value: 'MALE', label: 'Homme' }, { value: 'FEMALE', label: 'Femme' }]} />);
    expect(container.querySelector('[data-testid="field-box"]')).toBeNull();
    expect(screen.getByText('Sexe')).toBeInTheDocument();
  });

  it('hideLabel omet le libellé (carte dont le titre le porte déjà)', () => {
    wrap(<PillChoice label="Sport préféré" hideLabel value="MALE" onChange={() => {}}
      options={[{ value: 'MALE', label: 'Padel' }]} />);
    expect(screen.queryByText('Sport préféré')).not.toBeInTheDocument();
    // Le groupe garde son nom accessible même sans libellé peint.
    expect(screen.getByRole('group', { name: 'Sport préféré' })).toBeInTheDocument();
  });
});
