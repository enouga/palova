import { clubHasPadel, PADEL_KEY } from '../lib/sport';

describe('clubHasPadel', () => {
  it('vrai si un sport du club a la clé padel', () => {
    expect(clubHasPadel({ clubSports: [{ sport: { key: 'padel' } }] })).toBe(true);
  });

  it('vrai sur un club multi-sport contenant le padel', () => {
    expect(clubHasPadel({ clubSports: [{ sport: { key: 'tennis' } }, { sport: { key: 'padel' } }] })).toBe(true);
  });

  it('faux si aucun sport padel', () => {
    expect(clubHasPadel({ clubSports: [{ sport: { key: 'tennis' } }, { sport: { key: 'squash' } }] })).toBe(false);
  });

  it('faux si clubSports absent ou vide', () => {
    expect(clubHasPadel({})).toBe(false);
    expect(clubHasPadel({ clubSports: [] })).toBe(false);
  });

  it('expose la constante PADEL_KEY', () => {
    expect(PADEL_KEY).toBe('padel');
  });
});
