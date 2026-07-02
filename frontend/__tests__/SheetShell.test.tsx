import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { SheetShell } from '@/components/ui/SheetShell';

describe('SheetShell', () => {
  it('rend un dialogue avec son contenu', () => {
    render(
      <ThemeProvider>
        <SheetShell onClose={jest.fn()} label="Ma feuille">
          <p>Contenu</p>
        </SheetShell>
      </ThemeProvider>
    );
    expect(screen.getByRole('dialog', { name: 'Ma feuille' })).toBeInTheDocument();
    expect(screen.getByText('Contenu')).toBeInTheDocument();
  });

  it('ferme sur Échap et sur clic overlay', () => {
    const onClose = jest.fn();
    const { container } = render(
      <ThemeProvider>
        <SheetShell onClose={onClose} label="Ma feuille">
          <p>Contenu</p>
        </SheetShell>
      </ThemeProvider>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('[data-overlay]')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
