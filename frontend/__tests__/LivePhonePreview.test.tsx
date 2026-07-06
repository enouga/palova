import { render, screen } from '@testing-library/react';
import { LivePhonePreview } from '@/components/onboarding/LivePhonePreview';
import { PreviewState } from '@/lib/onboarding';

const base: PreviewState = {
  name: 'Padel Riviera', slug: 'padel-riviera',
  logoUrl: null, accentColor: '#d6ff3f', sports: [],
};

describe('LivePhonePreview', () => {
  it('affiche nom, URL du club et les placeholders quand rien n’est configuré', () => {
    render(<LivePhonePreview preview={base} />);
    expect(screen.getByText('Padel Riviera')).toBeInTheDocument();
    expect(screen.getByText('padel-riviera.palova.fr')).toBeInTheDocument();
    expect(screen.getByText(/apparaîtront à l’étape 2/)).toBeInTheDocument();
    expect(screen.getByText(/étape 3…/)).toBeInTheDocument();
    // monogramme (pas de logo) : première lettre du nom
    expect(screen.getByText('P')).toBeInTheDocument();
  });

  it('affiche les chips sports et la ligne terrains quand configurés', () => {
    render(<LivePhonePreview preview={{
      ...base,
      logoUrl: '/uploads/logo.png',
      sports: [
        { key: 'padel', name: 'Padel', icon: '🎾', noun: 'piste', courtCount: 4, minPrice: 25 },
        { key: 'tennis', name: 'Tennis', icon: null, noun: 'court', courtCount: 0, minPrice: null },
      ],
    }} />);
    expect(screen.getByText(/Padel/)).toBeInTheDocument();
    expect(screen.getByText(/4 pistes · dès 25 €/)).toBeInTheDocument();
    // le sport sans terrain n'apparaît pas dans la section terrains
    expect(screen.queryByText(/0 court/)).not.toBeInTheDocument();
    // logo affiché → une balise img est rendue à la place du monogramme
    expect(document.querySelector('img')).toBeTruthy();
  });
});
