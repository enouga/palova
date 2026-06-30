import { hasAcceptedCgv, rememberCgvAccepted } from '../lib/cgv';

describe('lib/cgv — mémoire locale de l\'acceptation des CGV (par club)', () => {
  beforeEach(() => localStorage.clear());

  it('aucune mémoire → false', () => {
    expect(hasAcceptedCgv('club-demo')).toBe(false);
  });

  it('après remember → true pour le même club', () => {
    rememberCgvAccepted('club-demo');
    expect(hasAcceptedCgv('club-demo')).toBe(true);
  });

  it('mémoire par club : accepter chez A ne pré-coche pas B', () => {
    rememberCgvAccepted('club-a');
    expect(hasAcceptedCgv('club-a')).toBe(true);
    expect(hasAcceptedCgv('club-b')).toBe(false);
  });

  it('sans slug → no-op (lecture false, écriture silencieuse)', () => {
    expect(hasAcceptedCgv(undefined)).toBe(false);
    expect(hasAcceptedCgv(null)).toBe(false);
    expect(hasAcceptedCgv('')).toBe(false);
    expect(() => rememberCgvAccepted(undefined)).not.toThrow();
    expect(() => rememberCgvAccepted(null)).not.toThrow();
    // rememberCgvAccepted(undefined) ne crée aucune clé parasite.
    expect(localStorage.length).toBe(0);
  });
});
