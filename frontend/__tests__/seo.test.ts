import { clubTitle, platformTitle, canonicalFor, clubOgImage, PLATFORM_OG_IMAGE } from '../lib/seo';

describe('clubTitle', () => {
  it('joint la page et le nom du club avec " · "', () => {
    expect(clubTitle('Le club', 'Padel Arena Paris')).toBe('Le club · Padel Arena Paris');
  });
});

describe('platformTitle', () => {
  it('ajoute le suffixe " | Palova"', () => {
    expect(platformTitle('Tarifs')).toBe('Tarifs | Palova');
  });
});

describe('canonicalFor', () => {
  it("construit l'URL du sous-domaine club pour le chemin donné", () => {
    expect(canonicalFor('demo', '/club')).toBe('https://demo.localhost/club');
  });
  it('undefined sans slug (hôte plateforme)', () => {
    expect(canonicalFor(null, '/tarifs')).toBeUndefined();
  });
});

describe('clubOgImage', () => {
  it("pointe vers la route icône og.png du club", () => {
    expect(clubOgImage('demo')).toBe('http://localhost:3001/api/clubs/demo/icon/og.png');
  });
});

it('PLATFORM_OG_IMAGE est un asset statique local', () => {
  expect(PLATFORM_OG_IMAGE).toBe('/og-default.png');
});
