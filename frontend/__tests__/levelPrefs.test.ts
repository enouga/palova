import { loadLevelPref, saveLevelPref, LevelPref } from '@/lib/levelPrefs';

describe('levelPrefs', () => {
  beforeEach(() => window.localStorage.clear());

  it('rien de mémorisé → null', () => {
    expect(loadLevelPref()).toBeNull();
  });

  it('round-trip save/load', () => {
    const pref: LevelPref = { enabled: true, min: 3.2, max: 5.4 };
    saveLevelPref(pref);
    expect(loadLevelPref()).toEqual(pref);
  });

  it('JSON corrompu → null (pas d’exception)', () => {
    window.localStorage.setItem('palova:open-match-level', '{not json');
    expect(loadLevelPref()).toBeNull();
  });

  it('forme invalide (min > max) → null', () => {
    window.localStorage.setItem('palova:open-match-level', JSON.stringify({ enabled: true, min: 6, max: 3 }));
    expect(loadLevelPref()).toBeNull();
  });

  it('champs manquants → null', () => {
    window.localStorage.setItem('palova:open-match-level', JSON.stringify({ min: 3 }));
    expect(loadLevelPref()).toBeNull();
  });
});
