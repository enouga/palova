import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { EventsFilterBar } from '@/components/events/EventsFilterBar';
import { emptyFilterState, EventFilterState, AgendaCounts } from '@/lib/events';

const facets = {
  categories: ['P100', 'P500'],
  genders: ['MEN' as const],
  kinds: ['MELEE' as const],
  hasMemberOnly: true,
};
const counts: AgendaCounts = {
  sources: { tout: 6, competitions: 3, animations: 2, cours: 1 },
  when: { weekend: 1, thisMonth: 4, days30: 6 },
  categories: [{ value: 'P100', count: 1 }, { value: 'P500', count: 2 }],
  genders: [{ value: 'MEN', count: 2 }],
  kinds: [{ value: 'MELEE', count: 1 }],
  memberOnly: 1,
};

const wrap = (state: EventFilterState) => {
  const onChange = jest.fn();
  render(
    <ThemeProvider>
      <EventsFilterBar state={state} onChange={onChange} facets={facets} counts={counts} resultCount={6} />
    </ThemeProvider>,
  );
  return onChange;
};

it('affiche les 4 sources avec leurs compteurs', () => {
  wrap(emptyFilterState());
  const counts: Record<string, string> = { Compétitions: '3', Animations: '2', Cours: '1', Tout: '6' };
  for (const [label, count] of Object.entries(counts)) {
    const btn = screen.getByRole('button', { name: label });
    expect(btn.querySelector('span[aria-hidden]')).toHaveTextContent(count);
  }
});

it('changer de source réinitialise les facettes mais garde « quand »', () => {
  const onChange = wrap({ ...emptyFilterState(), source: 'competitions', categories: new Set(['P100']), when: 'weekend' });
  fireEvent.click(screen.getByRole('button', { name: /Animations/ }));
  const next = onChange.mock.calls[0][0] as EventFilterState;
  expect(next.source).toBe('animations');
  expect(next.when).toBe('weekend');
  expect(next.categories.size).toBe(0);
});

it('toggle d une catégorie (multi-sélection)', () => {
  const onChange = wrap({ ...emptyFilterState(), source: 'competitions', categories: new Set(['P500']) });
  fireEvent.click(screen.getByRole('button', { name: /P100/ }));
  const next = onChange.mock.calls[0][0] as EventFilterState;
  expect([...next.categories].sort()).toEqual(['P100', 'P500']);
});

it('les groupes sont contextuels : Genre absent sur « Tout », présent sur Compétitions', () => {
  wrap(emptyFilterState());
  expect(screen.getByText('Catégorie')).toBeInTheDocument();
  expect(screen.getByText('Type')).toBeInTheDocument();
  expect(screen.queryByText('Genre')).toBeNull();
});

it('« Quand » toggle un preset (re-cliquer désélectionne)', () => {
  const onChange = wrap({ ...emptyFilterState(), when: 'weekend' });
  fireEvent.click(screen.getByRole('button', { name: /Ce week-end/ }));
  expect((onChange.mock.calls[0][0] as EventFilterState).when).toBeNull();
});

it('« Effacer les filtres » remet facettes et quand à zéro, garde la source', () => {
  const onChange = wrap({ ...emptyFilterState(), source: 'competitions', categories: new Set(['P100']), when: 'days30' });
  fireEvent.click(screen.getByRole('button', { name: /Effacer les filtres/ }));
  const next = onChange.mock.calls[0][0] as EventFilterState;
  expect(next.source).toBe('competitions');
  expect(next.when).toBeNull();
  expect(next.categories.size).toBe(0);
});

it('compteur de résultats affiché quand un filtre est actif, masqué sinon', () => {
  wrap({ ...emptyFilterState(), when: 'weekend' });
  expect(screen.getByText(/6 résultats/)).toBeInTheDocument();
});

it('pas de pied « résultats / Effacer » sans filtre actif', () => {
  wrap(emptyFilterState());
  expect(screen.queryByText(/résultats/)).toBeNull();
  expect(screen.queryByRole('button', { name: /Effacer/ })).toBeNull();
});
