import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReportDialog } from '@/components/moderation/ReportDialog';
import { ThemeProvider } from '@/lib/ThemeProvider';

function renderDialog(onSubmit = jest.fn().mockResolvedValue(undefined), onCancel = jest.fn()) {
  render(<ThemeProvider><ReportDialog onSubmit={onSubmit} onCancel={onCancel} /></ThemeProvider>);
  return { onSubmit, onCancel };
}

it('affiche les 4 motifs, Harcèlement pré-sélectionné', () => {
  renderDialog();
  expect(screen.getByRole('radio', { name: /harcèlement/i })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('radio', { name: /contenu illicite/i })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /spam/i })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /autre/i })).toBeInTheDocument();
});

it('envoie le motif choisi + détail, affiche la confirmation', async () => {
  const { onSubmit } = renderDialog();
  fireEvent.click(screen.getByRole('radio', { name: /spam/i }));
  fireEvent.change(screen.getByPlaceholderText(/précisions/i), { target: { value: 'répétitif' } });
  fireEvent.click(screen.getByRole('button', { name: /envoyer le signalement/i }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('SPAM', 'répétitif'));
  expect(await screen.findByText(/signalement envoyé/i)).toBeInTheDocument();
});

it('re-signaler (idempotent côté serveur) affiche quand même la confirmation', async () => {
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  renderDialog(onSubmit);
  fireEvent.click(screen.getByRole('button', { name: /envoyer le signalement/i }));
  expect(await screen.findByText(/signalement envoyé/i)).toBeInTheDocument();
});

it('échec réseau → message d erreur, reste sur le formulaire', async () => {
  const onSubmit = jest.fn().mockRejectedValue(new Error('RATE_LIMITED'));
  renderDialog(onSubmit);
  fireEvent.click(screen.getByRole('button', { name: /envoyer le signalement/i }));
  expect(await screen.findByText(/trop de signalements|réessayez/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /envoyer le signalement/i })).toBeInTheDocument();
});

it('Annuler appelle onCancel', () => {
  const { onCancel } = renderDialog();
  fireEvent.click(screen.getByRole('button', { name: /annuler/i }));
  expect(onCancel).toHaveBeenCalled();
});
