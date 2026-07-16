import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsSports } from '@/components/admin/settings/SettingsSports';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: new Proxy({}, { get: () => '' }) }) }));

const CATALOG = [
  { id: 'padel', name: 'Padel', icon: null, defaultDurationsMin: [90] },
  { id: 'tennis', name: 'Tennis', icon: '🎾', defaultDurationsMin: [60] },
];
const ITEMS = [{ sportId: 'padel', clubSportId: 'cs1', durationsMin: [90] }];

describe('SettingsSports (composant contrôlé)', () => {
  it('liste les sports activés avec leurs durées et propose les sports du catalogue à ajouter', () => {
    render(<SettingsSports catalog={CATALOG} items={ITEMS} onAdd={jest.fn()} onToggleDuration={jest.fn()} />);
    expect(screen.getByText('Padel')).toBeInTheDocument();
    expect(screen.getByText('Proposés par le club')).toBeInTheDocument();
    // Durées cochables du padel : 30 min, 1 h, 1 h 30, 2 h.
    expect(screen.getByRole('button', { name: '1 h 30' })).toBeInTheDocument();
    // Tennis (non activé) est proposé à l'ajout.
    expect(screen.getByRole('button', { name: /Tennis/ })).toBeInTheDocument();
  });

  it('appelle onAdd au clic sur un sport du catalogue, sans appel réseau', () => {
    const onAdd = jest.fn();
    render(<SettingsSports catalog={CATALOG} items={ITEMS} onAdd={onAdd} onToggleDuration={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Tennis/ }));
    expect(onAdd).toHaveBeenCalledWith('tennis');
  });

  it('appelle onToggleDuration au clic sur une durée', () => {
    const onToggleDuration = jest.fn();
    render(<SettingsSports catalog={CATALOG} items={ITEMS} onAdd={jest.fn()} onToggleDuration={onToggleDuration} />);
    fireEvent.click(screen.getByRole('button', { name: '1 h' }));
    expect(onToggleDuration).toHaveBeenCalledWith('padel', 60);
  });

  it('brouillon vide : message dédié + tout le catalogue proposé à l\'ajout', () => {
    render(<SettingsSports catalog={CATALOG} items={[]} onAdd={jest.fn()} onToggleDuration={jest.fn()} />);
    expect(screen.getByText(/Aucun sport activé/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Padel/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tennis/ })).toBeInTheDocument();
  });
});
