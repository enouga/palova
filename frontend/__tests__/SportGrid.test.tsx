import { render, screen, fireEvent } from '@testing-library/react';
import { SportGrid } from '../components/reserve/SportGrid';
import { ThemeProvider } from '../lib/ThemeProvider';
import type { ClubAvailability } from '../lib/api';

const future = new Date(Date.now() + 3 * 3600e3).toISOString();
const past = new Date(Date.now() - 3 * 3600e3).toISOString();
const fmt = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })
    .format(new Date(iso)).replace(':', 'h');

const items: ClubAvailability[] = [{
  resource: { id: 'r1', name: 'Terrain 1', attributes: {}, price: '25', offPeakPrice: null,
    sport: { key: 'padel', name: 'Padel' }, clubSportId: 'cs1' },
  slots: [
    { startTime: past, endTime: past, available: true, price: '25', offPeak: false },     // exclu (passé)
    { startTime: future, endTime: future, available: true, price: '25', offPeak: false }, // libre
  ],
}];

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('SportGrid', () => {
  it('rend une colonne par heure à venir (le passé est exclu) et ouvre la confirmation au clic d\'une cellule libre', () => {
    const onSlot = jest.fn();
    wrap(<SportGrid items={items} nowMs={Date.now()} timezone="Europe/Paris"
      slotAllowed={() => true} onSlot={onSlot} sportKey="padel" duration={90} />);
    // en-tête : l'heure à venir est présente, le passé absent
    expect(screen.getByText(fmt(future))).toBeInTheDocument();
    expect(screen.queryByText(fmt(past))).toBeNull();
    // clic sur la cellule libre → onSlot
    fireEvent.click(screen.getByLabelText(new RegExp(`Terrain 1 ${fmt(future)}`)));
    expect(onSlot).toHaveBeenCalledWith('r1', '25', items[0].slots[1], 90, undefined, 'padel', 'Terrain 1');
  });

  it('affiche un état vide quand aucun créneau à venir', () => {
    const onlyPast: ClubAvailability[] = [{
      resource: items[0].resource,
      slots: [{ startTime: past, endTime: past, available: true, price: '25', offPeak: false }],
    }];
    wrap(<SportGrid items={onlyPast} nowMs={Date.now()} timezone="Europe/Paris"
      slotAllowed={() => true} onSlot={jest.fn()} sportKey="padel" duration={90} />);
    expect(screen.getByText(/Aucun créneau à venir/)).toBeInTheDocument();
  });
});
