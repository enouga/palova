import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ThemeProvider } from '../lib/ThemeProvider';

function renderDialog(overrides: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  render(
    <ThemeProvider>
      <ConfirmDialog
        title="Annuler la réservation ?"
        detail="Terrain 3 · sam. 15h00"
        confirmLabel="Annuler la réservation"
        cancelLabel="Retour"
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...overrides}
      />
    </ThemeProvider>
  );
  return { onConfirm, onCancel };
}

describe('ConfirmDialog', () => {
  it('affiche le titre et le détail', () => {
    renderDialog();
    expect(screen.getByText('Annuler la réservation ?')).toBeInTheDocument();
    expect(screen.getByText('Terrain 3 · sam. 15h00')).toBeInTheDocument();
  });

  it('appelle onConfirm au clic sur le bouton de confirmation', () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Annuler la réservation' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('appelle onCancel au clic sur Retour', () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('désactive les boutons et n\'appelle rien pendant la requête (busy)', () => {
    const { onConfirm, onCancel } = renderDialog({ busy: true });
    fireEvent.click(screen.getByRole('button', { name: '…' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
