import { render, screen, fireEvent, within } from '@testing-library/react';
import DateSelector from '../components/DateSelector';
import { ThemeProvider } from '../lib/ThemeProvider';

const WEEKDAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

function pad(n: number) { return String(n).padStart(2, '0'); }
function iso(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

// Dates calculées par rapport à « aujourd'hui » réel → test indépendant de la date du jour.
const today = new Date();
today.setHours(0, 0, 0, 0);
const todayKey = iso(today);
function plus(n: number) { const d = new Date(today); d.setDate(d.getDate() + n); return d; }
function label(d: Date) { return `${WEEKDAYS[d.getDay()]} ${d.getDate()}`; }

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

// Les boutons-jour sont distincts des flèches « Jours … ».
function dayButtons() {
  return screen.getAllByRole('button').filter((b) => !/^Jours /.test(b.getAttribute('aria-label') || ''));
}

describe('DateSelector', () => {
  it('affiche au moins le nombre de jours demandé', () => {
    wrap(<DateSelector value={todayKey} onChange={() => {}} days={7} />);
    expect(dayButtons()).toHaveLength(7);
  });

  it("marque le jour sélectionné (aria-pressed) et étiquette « AUJ » pour aujourd'hui", () => {
    wrap(<DateSelector value={todayKey} onChange={() => {}} days={7} />);
    const sel = screen.getByRole('button', { pressed: true });
    expect(within(sel).getByText('AUJ')).toBeInTheDocument();
  });

  it('appelle onChange avec la date cliquée', () => {
    const onChange = jest.fn();
    wrap(<DateSelector value={todayKey} onChange={onChange} days={7} />);
    fireEvent.click(screen.getByLabelText(label(plus(2))));
    expect(onChange).toHaveBeenCalledWith(iso(plus(2)));
  });

  it("désactive et n'émet pas pour les jours au-delà de maxKey", () => {
    const onChange = jest.fn();
    wrap(<DateSelector value={todayKey} onChange={onChange} days={7} maxKey={iso(plus(2))} />);
    const far = screen.getByLabelText(label(plus(5)));
    expect(far).toBeDisabled();
    fireEvent.click(far);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("étend la bande jusqu'à maxKey quand la fenêtre dépasse `days`", () => {
    wrap(<DateSelector value={todayKey} onChange={() => {}} days={7} maxKey={iso(plus(11))} />);
    // fenêtre de 12 jours (aujourd'hui + 11) > days(7) → 12 cellules
    expect(dayButtons()).toHaveLength(12);
  });
});
