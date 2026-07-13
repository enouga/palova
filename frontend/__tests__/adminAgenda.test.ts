import { groupAdminAgenda, agendaItemGroup, AgendaStatus } from '../lib/adminAgenda';

const now = new Date('2026-07-13T12:00:00Z');

interface Item { id: string; status: AgendaStatus; startTime: string; endTime: string | null }
const acc = {
  status: (t: Item) => t.status,
  start: (t: Item) => t.startTime,
  end: (t: Item) => t.endTime,
};

describe('agendaItemGroup', () => {
  it('classe un brouillon en « draft » quelle que soit sa date', () => {
    expect(agendaItemGroup('DRAFT', '2020-01-01T00:00:00Z', null, now)).toBe('draft');
    expect(agendaItemGroup('DRAFT', '2099-01-01T00:00:00Z', null, now)).toBe('draft');
  });
  it('classe un annulé en « cancelled »', () => {
    expect(agendaItemGroup('CANCELLED', '2099-01-01T00:00:00Z', null, now)).toBe('cancelled');
  });
  it('un publié à venir → « upcoming », passé → « past »', () => {
    expect(agendaItemGroup('PUBLISHED', '2026-07-20T09:00:00Z', null, now)).toBe('upcoming');
    expect(agendaItemGroup('PUBLISHED', '2026-07-01T09:00:00Z', null, now)).toBe('past');
  });
  it('utilise endTime plutôt que startTime pour la frontière passé/à venir', () => {
    // débute avant now mais se termine après → encore à venir
    expect(agendaItemGroup('PUBLISHED', '2026-07-13T10:00:00Z', '2026-07-13T14:00:00Z', now)).toBe('upcoming');
    // débute et se termine avant now → passé
    expect(agendaItemGroup('PUBLISHED', '2026-07-13T06:00:00Z', '2026-07-13T10:00:00Z', now)).toBe('past');
  });
});

describe('groupAdminAgenda', () => {
  const items: Item[] = [
    { id: 'past-old', status: 'PUBLISHED', startTime: '2026-06-01T09:00:00Z', endTime: null },
    { id: 'past-recent', status: 'PUBLISHED', startTime: '2026-07-01T09:00:00Z', endTime: null },
    { id: 'up-late', status: 'PUBLISHED', startTime: '2026-08-01T09:00:00Z', endTime: null },
    { id: 'up-soon', status: 'PUBLISHED', startTime: '2026-07-15T09:00:00Z', endTime: null },
    { id: 'draft', status: 'DRAFT', startTime: '2026-07-20T09:00:00Z', endTime: null },
    { id: 'cancel', status: 'CANCELLED', startTime: '2026-07-18T09:00:00Z', endTime: null },
  ];

  it('range les sections dans l’ordre draft → upcoming → past → cancelled', () => {
    const groups = groupAdminAgenda(items, now, acc);
    expect(groups.map((g) => g.key)).toEqual(['draft', 'upcoming', 'past', 'cancelled']);
  });

  it('trie « à venir » par début croissant et « passés » par début décroissant', () => {
    const groups = groupAdminAgenda(items, now, acc);
    const upcoming = groups.find((g) => g.key === 'upcoming')!;
    expect(upcoming.items.map((i) => i.id)).toEqual(['up-soon', 'up-late']);
    const past = groups.find((g) => g.key === 'past')!;
    expect(past.items.map((i) => i.id)).toEqual(['past-recent', 'past-old']);
  });

  it('omet les sections vides', () => {
    const groups = groupAdminAgenda([items[0]], now, acc); // uniquement un passé
    expect(groups.map((g) => g.key)).toEqual(['past']);
  });

  it('renvoie un tableau vide pour une liste vide', () => {
    expect(groupAdminAgenda([], now, acc)).toEqual([]);
  });

  it('expose des libellés lisibles', () => {
    const groups = groupAdminAgenda(items, now, acc);
    expect(groups.find((g) => g.key === 'draft')!.label).toBe('Brouillons');
    expect(groups.find((g) => g.key === 'upcoming')!.label).toBe('Publiés · à venir');
  });
});
