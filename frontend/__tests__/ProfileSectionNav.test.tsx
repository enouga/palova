import { render, screen, fireEvent, act } from '@testing-library/react';
import { ProfileSectionNav, ProfileNavItem } from '../components/profile/ProfileSectionNav';
import { ThemeProvider } from '../lib/ThemeProvider';

const items: ProfileNavItem[] = [
  { id: 'identite', icon: 'user', label: 'Identité' },
  { id: 'sport', icon: 'ball', label: 'Sport' },
  { id: 'niveau', icon: 'chart', label: 'Niveau' },
];

// IO mock local capturant le callback pour simuler l'intersection
let ioCb: ((entries: unknown[]) => void) | null = null;
beforeEach(() => {
  ioCb = null;
  // @ts-expect-error - mock local
  global.IntersectionObserver = class {
    constructor(cb: (e: unknown[]) => void) { ioCb = cb; }
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
  // jsdom n'implémente pas scrollIntoView
  Element.prototype.scrollIntoView = jest.fn();
});

afterEach(() => {
  // @ts-expect-error - retire le mock global
  delete Element.prototype.scrollIntoView;
});

function renderNav() {
  return render(
    <ThemeProvider>
      <ProfileSectionNav items={items} topOffset={0} />
      <section id="identite">A</section>
      <section id="sport">B</section>
      <section id="niveau">C</section>
    </ThemeProvider>,
  );
}

describe('ProfileSectionNav', () => {
  it('rend tous les items dans une nav nommée', () => {
    renderNav();
    const nav = screen.getByRole('navigation', { name: /sections du profil/i });
    expect(nav).toBeInTheDocument();
    expect(screen.getByText('Identité')).toBeInTheDocument();
    expect(screen.getByText('Sport')).toBeInTheDocument();
    expect(screen.getByText('Niveau')).toBeInTheDocument();
  });

  it('le premier item est actif par défaut', () => {
    renderNav();
    expect(screen.getByText('Identité').closest('button')).toHaveAttribute('aria-current', 'location');
  });

  it('cliquer un item défile vers sa section et l\'active', () => {
    renderNav();
    fireEvent.click(screen.getByText('Niveau'));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.getByText('Niveau').closest('button')).toHaveAttribute('aria-current', 'location');
  });

  it('scroll-spy : la section visible devient active', () => {
    renderNav();
    act(() => {
      ioCb?.([{ isIntersecting: true, target: { id: 'sport' }, boundingClientRect: { top: 10 } }]);
    });
    expect(screen.getByText('Sport').closest('button')).toHaveAttribute('aria-current', 'location');
  });
});
