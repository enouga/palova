import { coverHash, coverGradient, coverInitials } from '../lib/clubCover';

describe('coverHash', () => {
  it('est déterministe', () => {
    expect(coverHash('demo')).toBe(coverHash('demo'));
  });
});

describe('coverGradient', () => {
  it('est déterministe pour un même (slug, accent)', () => {
    expect(coverGradient('demo', '#d6ff3f')).toEqual(coverGradient('demo', '#d6ff3f'));
  });

  it("from = la couleur d'accent normalisée en hex", () => {
    expect(coverGradient('demo', '#d6ff3f').from.toLowerCase()).toBe('#d6ff3f');
  });

  it('renvoie un angle multiple de 45 dans [0,360)', () => {
    const { angle } = coverGradient('demo', '#d6ff3f');
    expect(angle % 45).toBe(0);
    expect(angle).toBeGreaterThanOrEqual(0);
    expect(angle).toBeLessThan(360);
  });

  it('distingue des slugs différents (≥2 dégradés distincts sur 6 slugs)', () => {
    const css = ['a', 'b', 'c', 'd', 'e', 'f'].map((s) => JSON.stringify(coverGradient(s, '#d6ff3f')));
    expect(new Set(css).size).toBeGreaterThanOrEqual(2);
  });

  it('accent invalide → ne jette pas (repli gris)', () => {
    expect(() => coverGradient('demo', 'pas-une-couleur')).not.toThrow();
  });
});

describe('coverInitials', () => {
  it('deux mots → deux initiales', () => {
    expect(coverInitials('Padel Arena')).toBe('PA');
  });
  it('un mot → deux premières lettres', () => {
    expect(coverInitials('Padelclub')).toBe('PA');
  });
  it('vide → ?', () => {
    expect(coverInitials('   ')).toBe('?');
  });
});
