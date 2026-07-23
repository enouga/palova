import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { RailArrows } from '@/components/ui/RailArrows';

const wrap = (edges: { left: boolean; right: boolean }, onPrev = jest.fn(), onNext = jest.fn()) =>
  render(
    <ThemeProvider>
      <div style={{ position: 'relative' }}>
        <RailArrows edges={edges} onPrev={onPrev} onNext={onNext} prevLabel="Précédent" nextLabel="Suivant" />
      </div>
    </ThemeProvider>,
  );

it('aucune flèche si les deux bords sont fermés', () => {
  wrap({ left: false, right: false });
  expect(screen.queryByRole('button')).toBeNull();
});

it('flèche droite seule visible en début de rail', () => {
  wrap({ left: false, right: true });
  expect(screen.queryByRole('button', { name: 'Précédent' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Suivant' })).toBeInTheDocument();
});

it('flèche gauche seule visible en fin de rail', () => {
  wrap({ left: true, right: false });
  expect(screen.getByRole('button', { name: 'Précédent' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Suivant' })).toBeNull();
});

it('clic sur chaque flèche déclenche onPrev/onNext', () => {
  const onPrev = jest.fn();
  const onNext = jest.fn();
  wrap({ left: true, right: true }, onPrev, onNext);
  fireEvent.click(screen.getByRole('button', { name: 'Précédent' }));
  fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
  expect(onPrev).toHaveBeenCalledTimes(1);
  expect(onNext).toHaveBeenCalledTimes(1);
});
