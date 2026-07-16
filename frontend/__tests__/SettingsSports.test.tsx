import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsSports } from '@/components/admin/settings/SettingsSports';
import type { SportDraftRow } from '@/lib/adminSports';
import type { Sport } from '@/lib/api';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: new Proxy({}, { get: () => '' }) }) }));

const ROWS: SportDraftRow[] = [
  { clubSportId: 'cs1', sportId: 'padel', name: 'Padel', defaultDurationsMin: [90], durationsMin: [90] },
];
const CATALOG = [
  { id: 'padel', name: 'Padel', defaultDurationsMin: [90] },
  { id: 'tennis', name: 'Tennis', icon: '🎾', defaultDurationsMin: [60] },
] as unknown as Sport[];

const setup = (rows: SportDraftRow[] = ROWS) => {
  const onAdd = jest.fn();
  const onToggleDuration = jest.fn();
  render(<SettingsSports rows={rows} catalog={CATALOG} onAdd={onAdd} onToggleDuration={onToggleDuration} />);
  return { onAdd, onToggleDuration };
};

describe('SettingsSports', () => {
  it('lists enabled sports with durations and catalog sports to add', () => {
    setup();
    expect(screen.getByText('Padel')).toBeInTheDocument();
    expect(screen.getByText('Proposés par le club')).toBeInTheDocument();
    // Durées cochables du padel : 30 min, 1 h, 1 h 30, 2 h.
    expect(screen.getByRole('button', { name: '1 h 30' })).toBeInTheDocument();
    // Tennis (non activé) est proposé à l'ajout ; Padel (activé) ne l'est pas.
    expect(screen.getByRole('button', { name: /Tennis/ })).toBeInTheDocument();
  });

  it('marks the active durations as pressed', () => {
    setup();
    expect(screen.getByRole('button', { name: '1 h 30' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '1 h' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports an added sport to the parent instead of saving it', () => {
    const { onAdd } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Tennis/ }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 'tennis' }));
  });

  it('reports a toggled duration to the parent', () => {
    const { onToggleDuration } = setup();
    fireEvent.click(screen.getByRole('button', { name: '1 h' }));
    expect(onToggleDuration).toHaveBeenCalledWith('padel', 60);
  });

  it('flags a sport that is not created yet', () => {
    setup([...ROWS, { clubSportId: null, sportId: 'tennis', name: 'Tennis', defaultDurationsMin: [60], durationsMin: [60] }]);
    expect(screen.getByText('À enregistrer')).toBeInTheDocument();
  });

  it('does not flag already-saved sports', () => {
    setup();
    expect(screen.queryByText('À enregistrer')).not.toBeInTheDocument();
  });
});
