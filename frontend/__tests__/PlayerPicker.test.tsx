import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { PlayerPicker } from '../components/admin/PlayerPicker';
import type { Member } from '../lib/api';

const members: Member[] = [
  { id: 'mb-1', userId: 'u-1', firstName: 'Jean', lastName: 'Dupont', email: 'jean@x.fr', phone: null, isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null, avatarUrl: null, level: { level: 6.2, tier: 'Confirmé', isProvisional: false, reliability: 82 } },
  { id: 'mb-2', userId: 'u-2', firstName: 'Marie', lastName: 'Curie', email: 'marie@x.fr', phone: null, isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null },
];

function setup(over: Partial<React.ComponentProps<typeof PlayerPicker>> = {}) {
  const onSelect = jest.fn();
  const onClear  = jest.fn();
  const onCreate = jest.fn().mockResolvedValue({ tempPassword: 'abc12345', existed: false });
  render(
    <ThemeProvider>
      <PlayerPicker members={members} value={null} onSelect={onSelect} onClear={onClear} onCreate={onCreate} {...over} />
    </ThemeProvider>,
  );
  return { onSelect, onClear, onCreate };
}

describe('PlayerPicker', () => {
  it('affiche une loupe dans le champ de recherche', () => {
    setup();
    expect(screen.getByTestId('player-search-loupe').querySelector('svg')).toBeInTheDocument();
  });

  it('filtre les membres et sélectionne au clic', () => {
    const { onSelect } = setup();
    fireEvent.change(screen.getByPlaceholderText('Rechercher un joueur…'), { target: { value: 'mar' } });
    fireEvent.click(screen.getByText(/Marie Curie/));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-2' }));
  });

  it('affiche la pastille de niveau dans la liste (look annuaire du front)', () => {
    setup();
    fireEvent.focus(screen.getByPlaceholderText('Rechercher un joueur…'));
    expect(screen.getByText('6.2')).toBeInTheDocument();
  });

  it('affiche le joueur sélectionné et « Changer » appelle onClear', () => {
    const { onClear } = setup({ value: { firstName: 'Jean', lastName: 'Dupont' } });
    expect(screen.getByText('Jean Dupont')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Changer'));
    expect(onClear).toHaveBeenCalled();
  });

  it('pré-remplit le formulaire de création depuis la recherche', () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText('Rechercher un joueur…'), { target: { value: 'Paul Martin' } });
    fireEvent.click(screen.getByText('+ Créer un joueur'));
    expect((screen.getByLabelText('Prénom') as HTMLInputElement).value).toBe('Paul');
    expect((screen.getByLabelText('Nom') as HTMLInputElement).value).toBe('Martin');
  });

  it('refuse la création sans email', () => {
    const { onCreate } = setup();
    fireEvent.click(screen.getByText('+ Créer un joueur'));
    fireEvent.change(screen.getByLabelText('Prénom'), { target: { value: 'Paul' } });
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Martin' } });
    fireEvent.click(screen.getByText('Créer le joueur'));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText(/requis/)).toBeInTheDocument();
  });

  it('crée un joueur et affiche le mot de passe temporaire', async () => {
    const { onCreate } = setup();
    fireEvent.click(screen.getByText('+ Créer un joueur'));
    fireEvent.change(screen.getByLabelText('Prénom'), { target: { value: 'Paul' } });
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Martin' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'paul@x.fr' } });
    fireEvent.click(screen.getByText('Créer le joueur'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Paul', lastName: 'Martin', email: 'paul@x.fr' }),
    ));
    expect(await screen.findByText(/mot de passe temporaire à transmettre : abc12345/)).toBeInTheDocument();
  });

  it('message « rattaché » si le compte existait déjà', async () => {
    const onCreate = jest.fn().mockResolvedValue({ tempPassword: null, existed: true });
    setup({ onCreate });
    fireEvent.click(screen.getByText('+ Créer un joueur'));
    fireEvent.change(screen.getByLabelText('Prénom'), { target: { value: 'Paul' } });
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Martin' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'paul@x.fr' } });
    fireEvent.click(screen.getByText('Créer le joueur'));
    expect(await screen.findByText(/rattaché au club/)).toBeInTheDocument();
  });
});
