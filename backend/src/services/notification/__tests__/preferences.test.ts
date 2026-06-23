import { channelEnabled, resolveChannels, PrefRow } from '../preferences';

describe('preferences', () => {
  it('défaut ON quand aucune ligne (opt-out)', () => {
    expect(channelEnabled([], 'MY_GAMES', 'EMAIL')).toBe(true);
    expect(channelEnabled([], 'MY_GAMES', 'INAPP')).toBe(true);
  });

  it('une ligne enabled=false désactive le canal', () => {
    const prefs: PrefRow[] = [{ category: 'MY_GAMES', channel: 'EMAIL', enabled: false }];
    expect(channelEnabled(prefs, 'MY_GAMES', 'EMAIL')).toBe(false);
    expect(channelEnabled(prefs, 'MY_GAMES', 'INAPP')).toBe(true);
  });

  it('CLUB_MESSAGES + INAPP est toujours ON, même si une ligne dit false', () => {
    const prefs: PrefRow[] = [{ category: 'CLUB_MESSAGES', channel: 'INAPP', enabled: false }];
    expect(channelEnabled(prefs, 'CLUB_MESSAGES', 'INAPP')).toBe(true);
  });

  it('resolveChannels : push inactif sans abonnement', () => {
    expect(resolveChannels([], 'MY_GAMES', false)).toEqual({ inapp: true, email: true, push: false });
    expect(resolveChannels([], 'MY_GAMES', true)).toEqual({ inapp: true, email: true, push: true });
  });
});
