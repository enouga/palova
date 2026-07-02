import { matchShareText, matchShareUrl } from '../lib/matchShare';
import type { OpenMatch } from '../lib/api';

const match = (over: Partial<OpenMatch> = {}): OpenMatch => ({
  id: 'm1', resourceName: 'Court 2',
  startTime: '2026-07-04T16:00:00.000Z', endTime: '2026-07-04T17:30:00.000Z',
  maxPlayers: 4, spotsLeft: 2, full: false,
  viewerIsParticipant: false, viewerIsOrganizer: false,
  players: [], targetLevelMin: 6, targetLevelMax: 7,
  lastMessageAt: null, unreadCount: 0, cardVersion: 'abc123def456',
  ...over,
});

describe('matchShareUrl', () => {
  it("versionne l'URL par l'état (?s=cardVersion)", () => {
    expect(matchShareUrl('https://demo.palova.fr', match()))
      .toBe('https://demo.palova.fr/parties/m1?s=abc123def456');
  });
  it('sans cardVersion (vieux backend) → URL nue', () => {
    expect(matchShareUrl('https://demo.palova.fr', match({ cardVersion: undefined })))
      .toBe('https://demo.palova.fr/parties/m1');
  });
});

describe('matchShareText', () => {
  it('compose date · places · niveau · club (fuseau du club)', () => {
    const text = matchShareText(match(), 'Padel Arena', 'Europe/Paris');
    expect(text).toContain('sam.');       // 2026-07-04 = samedi
    expect(text).toContain('juil.');
    expect(text).toContain('18:00');      // 16:00 UTC = 18h00 à Paris
    expect(text).toContain('2 places');
    expect(text).toContain('Niveau 6 à 7');
    expect(text).toContain('Padel Arena');
  });
  it('singulier, complet, sans niveau, sans club', () => {
    expect(matchShareText(match({ spotsLeft: 1 }), null, 'Europe/Paris')).toContain('1 place');
    expect(matchShareText(match({ full: true, spotsLeft: 0 }), null, 'Europe/Paris')).toContain('Complet');
    const noLevel = matchShareText(match({ targetLevelMin: null, targetLevelMax: null }), null, 'Europe/Paris');
    expect(noLevel).not.toContain('Niveau');
    expect(noLevel).not.toContain('null');
  });
});
