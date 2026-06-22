import { render, screen } from '@testing-library/react';
import { Segmented } from '../components/ui/atoms';
import { ThemeProvider } from '../lib/ThemeProvider';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('Segmented', () => {
  it('rend une icône et le compteur quand ils sont fournis', () => {
    wrap(
      <Segmented
        value="upcoming"
        onChange={() => {}}
        options={[
          { value: 'calendar', label: 'Calendrier', icon: 'calendar' },
          { value: 'upcoming', label: 'À venir', icon: 'clock', count: 3 },
        ]}
      />,
    );
    const upcoming = screen.getByText('À venir').closest('button')!;
    expect(upcoming.querySelector('svg')).toBeInTheDocument();
    expect(upcoming.textContent).toContain('3');
    const calendar = screen.getByText('Calendrier').closest('button')!;
    expect(calendar.querySelector('.sp-seg-badge')).toBeNull();
    expect(calendar.querySelector('.sp-seg-count-inline')).toBeNull();
  });

  it('reste un simple bouton texte quand aucune icône (autres usages inchangés)', () => {
    wrap(
      <Segmented
        value="x"
        onChange={() => {}}
        options={[{ value: 'x', label: 'Privé' }, { value: 'y', label: 'Public' }]}
      />,
    );
    const tab = screen.getByText('Privé').closest('button')!;
    expect(tab.querySelector('svg')).toBeNull();
  });
});
