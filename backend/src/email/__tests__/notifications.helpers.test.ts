import '../../__mocks__/prisma';
import { placesPhrase, refActivite, typeActivite } from '../notifications';

describe('placesPhrase', () => {
  it('partie complète (0 place)', () => {
    expect(placesPhrase(0)).toBe('La partie est désormais complète.');
  });
  it('singularise « 1 place »', () => {
    expect(placesPhrase(1)).toContain('1 place');
    expect(placesPhrase(1)).not.toContain('places');
  });
  it('pluralise « 2 places »', () => {
    expect(placesPhrase(2)).toContain('2 places');
  });
});

describe('refActivite', () => {
  it('tournoi / événement / cours', () => {
    expect(refActivite('tournament')).toBe('le tournoi');
    expect(refActivite('event')).toBe("l'événement");
    expect(refActivite('lesson')).toBe('le cours');
  });
});

describe('typeActivite', () => {
  it('tournoi / événement / cours', () => {
    expect(typeActivite('tournament')).toBe('tournoi');
    expect(typeActivite('event')).toBe('événement');
    expect(typeActivite('lesson')).toBe('cours');
  });
});
