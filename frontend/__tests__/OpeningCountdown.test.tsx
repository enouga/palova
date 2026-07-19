import { render, screen } from '@testing-library/react';
import { OpeningPanel, OpeningBanner } from '@/components/reserve/OpeningCountdown';

jest.mock('@/lib/ThemeProvider', () => ({
  useTheme: () => ({ th: new Proxy({}, { get: (_t, p) => (typeof p === 'string' && p === 'mode' ? 'light' : '#000') }) }),
}));

describe('OpeningCountdown', () => {
  const opensAt = new Date('2026-07-18T22:00:00.000Z').getTime();

  it('OpeningPanel affiche le jour, l\'heure d\'ouverture, le compte à rebours et la promesse d\'apparition auto', () => {
    render(<OpeningPanel dayLabel="samedi 19 juillet" opensAtMs={opensAt} nowMs={opensAt - (3 * 3600_000 + 12 * 60_000 + 45_000)} tz="Europe/Paris" />);
    expect(screen.getByText(/samedi 19 juillet/)).toBeInTheDocument();
    expect(screen.getByText('00h00')).toBeInTheDocument();
    expect(screen.getByText('03:12:45')).toBeInTheDocument();
    expect(screen.getByText(/apparaîtront ici automatiquement/i)).toBeInTheDocument();
  });

  it('OpeningBanner (compte à rebours court) affiche l\'heure d\'ouverture et mm:ss', () => {
    render(<OpeningBanner dayLabel="samedi 19 juillet" opensAtMs={opensAt} nowMs={opensAt - 125_000} tz="Europe/Paris" />);
    expect(screen.getByText('00h00')).toBeInTheDocument();
    expect(screen.getByText(/02:05/)).toBeInTheDocument();
  });

  it('OpeningBanner variante « ouvert » : bouton qui remonte onGoToDay', () => {
    const go = jest.fn();
    render(<OpeningBanner dayLabel="samedi 19 juillet" opensAtMs={opensAt} nowMs={opensAt + 1000} tz="Europe/Paris" onGoToDay={go} />);
    screen.getByRole('button', { name: /sont ouverts/i }).click();
    expect(go).toHaveBeenCalled();
  });
});
