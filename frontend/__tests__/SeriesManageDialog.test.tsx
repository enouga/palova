import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { SeriesManageDialog } from '../components/admin/events/SeriesManageDialog';

function renderDialog(onExtend = jest.fn(), onCancelSeries = jest.fn(), onClose = jest.fn()) {
  return {
    onExtend, onCancelSeries, onClose,
    ...render(
      <ThemeProvider>
        <SeriesManageDialog onExtend={onExtend} onCancelSeries={onCancelSeries} onClose={onClose} />
      </ThemeProvider>,
    ),
  };
}

it('affiche le titre et les deux actions', () => {
  renderDialog();
  expect(screen.getByText(/Gérer la série/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Prolonger/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Annuler la série/i })).toBeInTheDocument();
});

it('« Annuler la série » ouvre une confirmation explicite avant d\'appeler onCancelSeries', () => {
  const { onCancelSeries } = renderDialog();
  fireEvent.click(screen.getByRole('button', { name: /Annuler la série/i }));
  expect(onCancelSeries).not.toHaveBeenCalled();
  expect(screen.getByText(/inscrits.*notifi/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Confirmer$/i }));
  expect(onCancelSeries).toHaveBeenCalled();
});

it('fermer appelle onClose', () => {
  const { onClose } = renderDialog();
  fireEvent.click(screen.getByRole('button', { name: /Fermer|×/i }));
  expect(onClose).toHaveBeenCalled();
});
