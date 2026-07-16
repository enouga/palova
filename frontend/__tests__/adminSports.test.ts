import {
  sportsDraftFrom, addSportToDraft, toggleDurationInDraft, sportsDiff, sportsDirty,
  SportDraftRow,
} from '@/lib/adminSports';
import type { AdminClubSport, Sport } from '@/lib/api';

const clubSport = (id: string, sportId: string, name: string, durationsMin: number[], defaults: number[]): AdminClubSport => ({
  id, slotStepMin: null, durationsMin,
  sport: { id: sportId, key: sportId, name, resourceNoun: 'Terrain', defaultDurationsMin: defaults, surfaces: [], hasLighting: false },
});

const catalogSport = (id: string, name: string, defaults: number[]): Sport => ({
  id, key: id, name, resourceNoun: 'Terrain', defaultSlotStepMin: 30,
  defaultDurationsMin: defaults, icon: null, surfaces: [], published: true, hasLighting: false,
});

const PADEL = clubSport('cs1', 'padel', 'Padel', [90], [90]);
const TENNIS = catalogSport('tennis', 'Tennis', [60]);

describe('sportsDraftFrom', () => {
  it('maps enabled club sports to draft rows with effective durations', () => {
    expect(sportsDraftFrom([PADEL])).toEqual([
      { clubSportId: 'cs1', sportId: 'padel', name: 'Padel', defaultDurationsMin: [90], durationsMin: [90] },
    ]);
  });

  it('falls back to the sport defaults when the club has no override', () => {
    // durationsMin vide = « pas de choix du club » → les défauts du sport font foi.
    expect(sportsDraftFrom([clubSport('cs2', 'tennis', 'Tennis', [], [60, 90])])[0].durationsMin).toEqual([60, 90]);
  });
});

describe('addSportToDraft', () => {
  it('appends a pending row (no clubSportId) seeded with the sport defaults', () => {
    const rows = addSportToDraft(sportsDraftFrom([PADEL]), TENNIS);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ clubSportId: null, sportId: 'tennis', name: 'Tennis', defaultDurationsMin: [60], durationsMin: [60] });
  });

  it('is a no-op for a sport already in the draft', () => {
    const rows = sportsDraftFrom([PADEL]);
    expect(addSportToDraft(rows, catalogSport('padel', 'Padel', [90]))).toEqual(rows);
  });

  it('does not mutate the input rows', () => {
    const rows = sportsDraftFrom([PADEL]);
    addSportToDraft(rows, TENNIS);
    expect(rows).toHaveLength(1);
  });
});

describe('toggleDurationInDraft', () => {
  it('adds a duration, keeping the list sorted', () => {
    const rows = toggleDurationInDraft(sportsDraftFrom([PADEL]), 'padel', 60);
    expect(rows[0].durationsMin).toEqual([60, 90]);
  });

  it('removes a duration that is already on', () => {
    const rows = toggleDurationInDraft(sportsDraftFrom([clubSport('cs1', 'padel', 'Padel', [60, 90], [90])]), 'padel', 60);
    expect(rows[0].durationsMin).toEqual([90]);
  });

  it('refuses to remove the last duration', () => {
    const rows = sportsDraftFrom([PADEL]);
    expect(toggleDurationInDraft(rows, 'padel', 90)).toEqual(rows);
  });

  it('leaves the other sports untouched', () => {
    const rows = toggleDurationInDraft(sportsDraftFrom([PADEL, clubSport('cs2', 'tennis', 'Tennis', [60], [60])]), 'padel', 60);
    expect(rows[1].durationsMin).toEqual([60]);
  });

  it('toggles a pending (not yet created) sport', () => {
    const rows = toggleDurationInDraft(addSportToDraft(sportsDraftFrom([PADEL]), TENNIS), 'tennis', 120);
    expect(rows[1].durationsMin).toEqual([60, 120]);
    expect(rows[1].clubSportId).toBeNull();
  });
});

describe('sportsDiff', () => {
  const server: SportDraftRow[] = sportsDraftFrom([PADEL]);

  it('is empty when the draft matches the baseline', () => {
    expect(sportsDiff(server, sportsDraftFrom([PADEL]))).toEqual({ toAdd: [], toUpdate: [] });
    expect(sportsDirty(server, sportsDraftFrom([PADEL]))).toBe(false);
  });

  it('reports a pending sport to create, with its chosen durations', () => {
    const draft = toggleDurationInDraft(addSportToDraft(server, TENNIS), 'tennis', 120);
    expect(sportsDiff(server, draft)).toEqual({
      toAdd: [{ sportId: 'tennis', durationsMin: [60, 120] }],
      toUpdate: [],
    });
    expect(sportsDirty(server, draft)).toBe(true);
  });

  it('reports a duration change on an existing sport', () => {
    const draft = toggleDurationInDraft(server, 'padel', 60);
    expect(sportsDiff(server, draft)).toEqual({
      toAdd: [],
      toUpdate: [{ clubSportId: 'cs1', durationsMin: [60, 90] }],
    });
    expect(sportsDirty(server, draft)).toBe(true);
  });

  it('ignores an existing sport whose durations came back to the baseline', () => {
    const draft = toggleDurationInDraft(toggleDurationInDraft(server, 'padel', 60), 'padel', 60);
    expect(sportsDiff(server, draft).toUpdate).toEqual([]);
    expect(sportsDirty(server, draft)).toBe(false);
  });

  it('handles both an addition and an update at once', () => {
    const draft = addSportToDraft(toggleDurationInDraft(server, 'padel', 60), TENNIS);
    expect(sportsDiff(server, draft)).toEqual({
      toAdd: [{ sportId: 'tennis', durationsMin: [60] }],
      toUpdate: [{ clubSportId: 'cs1', durationsMin: [60, 90] }],
    });
  });
});
