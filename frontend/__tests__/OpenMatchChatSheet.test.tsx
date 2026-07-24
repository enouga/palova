import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { OpenMatchChatSheet } from '@/components/openmatch/OpenMatchChatSheet';
import { ThemeProvider } from '@/lib/ThemeProvider';

let lastES: FakeES | null = null;
class FakeES {
  url: string; onmessage: ((e: { data: string }) => void) | null = null; onerror: (() => void) | null = null;
  constructor(url: string) { this.url = url; lastES = this; }
  close() {}
  emit(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}
(global as unknown as { EventSource: unknown }).EventSource = FakeES;

jest.mock('@/lib/api', () => ({
  assetUrl: (p: string | null) => p,
  chatStreamUrl: (_s: string, _i: string, _t: string) => 'http://x/stream',
  api: {
    getChatMessages: jest.fn().mockResolvedValue([
      { id: 'm1', author: { userId: 'u2', firstName: 'Bob', lastName: 'Y', avatarUrl: null }, body: 'salut', createdAt: '2026-06-28T10:00:00Z', deleted: false },
    ]),
    postChatMessage: jest.fn().mockResolvedValue({ id: 'm2', author: { userId: 'u1', firstName: 'Moi', lastName: 'X', avatarUrl: null }, body: 'yo', createdAt: '2026-06-28T10:01:00Z', deleted: false }),
    editChatMessage: jest.fn().mockResolvedValue({ id: 'm2', author: { userId: 'u1', firstName: 'Moi', lastName: 'X', avatarUrl: null }, body: 'corrigé', createdAt: '2026-06-28T10:01:00Z', deleted: false, edited: true }),
    deleteChatMessage: jest.fn().mockResolvedValue({}),
    reportChatMessage: jest.fn().mockResolvedValue({ id: 'rep-1' }),
  },
}));

const baseProps = {
  slug: 'demo', token: 't', reservationId: 'resa1', viewerUserId: 'u1',
  viewerIsOrganizer: false, title: 'Court 1 · sam. 28', timezone: 'Europe/Paris',
  onClose: jest.fn(),
};
const renderSheet = (over = {}) => render(<ThemeProvider><OpenMatchChatSheet {...baseProps} {...over} /></ThemeProvider>);

it('charge et affiche le fil', async () => {
  renderSheet();
  expect(await screen.findByText('salut')).toBeInTheDocument();
});

it('envoie un message (optimiste) et appelle l API', async () => {
  renderSheet();
  await screen.findByText('salut');
  fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: 'yo' } });
  fireEvent.click(screen.getByRole('button', { name: /envoyer/i }));
  await waitFor(() => expect(require('@/lib/api').api.postChatMessage).toHaveBeenCalledWith('demo', 'resa1', 'yo', 't'));
});

it('reçoit un message en SSE et l ajoute au fil', async () => {
  renderSheet();
  await screen.findByText('salut');
  act(() => lastES!.emit({ type: 'chat_message', message: { id: 'm9', author: { userId: 'u3', firstName: 'Zoe', lastName: 'W', avatarUrl: null }, body: 'coucou', createdAt: '2026-06-28T10:02:00Z', deleted: false } }));
  expect(await screen.findByText('coucou')).toBeInTheDocument();
});

it('rend une pierre tombale pour un message supprimé reçu en SSE', async () => {
  renderSheet();
  await screen.findByText('salut');
  act(() => lastES!.emit({ type: 'chat_deleted', message: { id: 'm1', author: { userId: 'u2', firstName: 'Bob', lastName: 'Y', avatarUrl: null }, body: '', createdAt: '2026-06-28T10:00:00Z', deleted: true } }));
  expect(await screen.findByText(/message supprimé/i)).toBeInTheDocument();
});

it('insère un emoji dans le champ via le sélecteur', async () => {
  renderSheet();
  await screen.findByText('salut');
  const input = screen.getByPlaceholderText(/message/i) as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'bravo ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Emojis' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Emoji 🎾' }));
  expect(input.value).toBe('bravo 🎾');
});

it('affiche « Signaler » sur le message d un autre, pas sur le sien', async () => {
  renderSheet();
  await screen.findByText('salut'); // message de u2 (Bob)
  expect(screen.getByRole('button', { name: /signaler/i })).toBeInTheDocument();
});

it('signale un message : ouvre ReportDialog, envoie le motif, confirme', async () => {
  renderSheet();
  await screen.findByText('salut');
  fireEvent.click(screen.getByRole('button', { name: /signaler/i }));
  fireEvent.click(screen.getByRole('button', { name: /envoyer le signalement/i }));
  await waitFor(() => expect(require('@/lib/api').api.reportChatMessage).toHaveBeenCalledWith('demo', 'resa1', 'm1', 'HARASSMENT', null, 't'));
  expect(await screen.findByText(/signalement envoyé/i)).toBeInTheDocument();
});

it('cliquer dans ReportDialog ne ferme PAS la feuille de discussion (pas de bubbling vers onClose)', async () => {
  const onClose = jest.fn();
  renderSheet({ onClose });
  await screen.findByText('salut');
  fireEvent.click(screen.getByRole('button', { name: /signaler/i }));
  fireEvent.click(screen.getByRole('radio', { name: /spam/i }));
  fireEvent.click(screen.getByRole('button', { name: /envoyer le signalement/i }));
  await screen.findByText(/signalement envoyé/i);
  expect(onClose).not.toHaveBeenCalled();
});

it('affiche « Modifier » sur son propre message envoyé, pas sur celui d un autre', async () => {
  renderSheet();
  await screen.findByText('salut');
  fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: 'yo' } });
  fireEvent.click(screen.getByRole('button', { name: /envoyer/i }));
  await screen.findByText('yo'); // mon message (u1)
  expect(screen.getAllByRole('button', { name: /^modifier$/i })).toHaveLength(1);
});

it('modifie son message : bascule en édition, enregistre, met à jour le fil (« modifié »)', async () => {
  const { api } = require('@/lib/api');
  renderSheet();
  await screen.findByText('salut');
  fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: 'yo' } });
  fireEvent.click(screen.getByRole('button', { name: /envoyer/i }));
  await screen.findByText('yo');

  fireEvent.click(screen.getByRole('button', { name: /^modifier$/i }));
  const editBox = screen.getByDisplayValue('yo');
  fireEvent.change(editBox, { target: { value: 'corrigé' } });
  fireEvent.click(screen.getByRole('button', { name: /enregistrer/i }));

  await waitFor(() => expect(api.editChatMessage).toHaveBeenCalledWith('demo', 'resa1', 'm2', 'corrigé', 't'));
  expect(await screen.findByText('corrigé')).toBeInTheDocument();
  expect(screen.getByText(/modifié/i)).toBeInTheDocument();
});

it('échec de la modification : reste en édition avec un message d erreur', async () => {
  const { api } = require('@/lib/api');
  api.editChatMessage.mockRejectedValueOnce(new Error('boom'));
  renderSheet();
  await screen.findByText('salut');
  fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: 'yo' } });
  fireEvent.click(screen.getByRole('button', { name: /envoyer/i }));
  await screen.findByText('yo');

  fireEvent.click(screen.getByRole('button', { name: /^modifier$/i }));
  fireEvent.click(screen.getByRole('button', { name: /enregistrer/i }));
  expect(await screen.findByText(/échec de la modification/i)).toBeInTheDocument();
  expect(screen.getByDisplayValue('yo')).toBeInTheDocument(); // toujours en édition
});

it('RATE_LIMITED à l envoi affiche un message inline', async () => {
  const { api } = require('@/lib/api');
  api.postChatMessage.mockRejectedValueOnce(new Error('RATE_LIMITED'));
  renderSheet();
  await screen.findByText('salut');
  fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: 'trop vite' } });
  fireEvent.click(screen.getByRole('button', { name: /envoyer/i }));
  expect(await screen.findByText(/trop de messages/i)).toBeInTheDocument();
});

it('affiche le pseudo de l’auteur dans l’en-tête du message quand renseigné', async () => {
  const { api } = require('@/lib/api');
  api.getChatMessages.mockResolvedValueOnce([
    { id: 'm1', author: { userId: 'u2', firstName: 'Bob', lastName: 'Y', avatarUrl: null, pseudo: 'SmashMaster' }, body: 'salut', createdAt: '2026-06-28T10:00:00Z', deleted: false },
  ]);
  renderSheet();
  expect(await screen.findByText(/SmashMaster ·/)).toBeInTheDocument();
  expect(screen.queryByText(/^Bob ·/)).not.toBeInTheDocument();
});
