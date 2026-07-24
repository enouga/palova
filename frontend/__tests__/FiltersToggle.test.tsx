import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { FiltersToggle } from '@/components/ui/FiltersToggle';

function setup(over: Partial<React.ComponentProps<typeof FiltersToggle>> = {}) {
  const props = {
    count: 0, open: false, onToggle: jest.fn(), onClear: jest.fn(), controlsId: 'test-facets',
    ...over,
  };
  render(<ThemeProvider><FiltersToggle {...props} /></ThemeProvider>);
  return props;
}

describe('FiltersToggle', () => {
  it('rend le bouton « Filtres » sans badge ni lien Effacer à 0', () => {
    setup();
    expect(screen.getByRole('button', { name: /^Filtres/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Effacer' })).not.toBeInTheDocument();
  });

  it('badge affiche le compteur et le lien Effacer apparaît', () => {
    setup({ count: 2 });
    expect(screen.getByRole('button', { name: /^Filtres/ }).textContent).toContain('2');
    expect(screen.getByRole('button', { name: 'Effacer' })).toBeInTheDocument();
  });

  it('clic sur Filtres appelle onToggle, clic sur Effacer appelle onClear', () => {
    const p = setup({ count: 1 });
    fireEvent.click(screen.getByRole('button', { name: /^Filtres/ }));
    expect(p.onToggle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Effacer' }));
    expect(p.onClear).toHaveBeenCalledTimes(1);
  });

  it('aria-expanded et aria-controls reflètent open/controlsId', () => {
    setup({ open: true, controlsId: 'my-panel' });
    const btn = screen.getByRole('button', { name: /^Filtres/ });
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(btn).toHaveAttribute('aria-controls', 'my-panel');
  });
});
