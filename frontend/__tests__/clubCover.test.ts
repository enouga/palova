import { coverHash, coverBackground, coverInitials, coverPhoto, COVER_PHOTOS } from '../lib/clubCover';

describe('coverHash', () => {
  it('est déterministe', () => {
    expect(coverHash('demo')).toBe(coverHash('demo'));
  });
});

describe('coverBackground', () => {
  it('est déterministe pour un même (slug, accent)', () => {
    expect(coverBackground('demo', '#d6ff3f')).toBe(coverBackground('demo', '#d6ff3f'));
  });

  it('produit un mesh (plusieurs radial-gradient + base linéaire, en hsla)', () => {
    const bg = coverBackground('demo', '#d6ff3f');
    expect((bg.match(/radial-gradient/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(bg).toContain('linear-gradient');
    expect(bg).toContain('hsla(');
  });

  it('distingue des slugs différents (≥2 fonds distincts sur 6 slugs)', () => {
    const set = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((s) => coverBackground(s, '#d6ff3f')));
    expect(set.size).toBeGreaterThanOrEqual(2);
  });

  it('accent invalide → ne jette pas (repli gris)', () => {
    expect(() => coverBackground('demo', 'pas-une-couleur')).not.toThrow();
  });
});

describe('coverPhoto', () => {
  it('est déterministe et renvoie un chemin de la banque', () => {
    expect(coverPhoto('demo')).toBe(coverPhoto('demo'));
    expect(COVER_PHOTOS).toContain(coverPhoto('demo'));
  });

  it('distribue : ≥2 photos distinctes sur 8 slugs variés', () => {
    const seeds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    expect(new Set(seeds.map(coverPhoto)).size).toBeGreaterThanOrEqual(2);
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
