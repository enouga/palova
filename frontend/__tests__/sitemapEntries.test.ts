import { clubStaticEntries, clubDynamicEntries, platformEntries } from '../lib/sitemapEntries';
import type { Tournament, ClubEvent } from '../lib/api';

describe('clubStaticEntries', () => {
  it('liste les pages statiques du club sur le bon hôte', () => {
    const urls = clubStaticEntries('demo.palova.fr').map((e) => e.url);
    expect(urls).toEqual([
      'https://demo.palova.fr/',
      'https://demo.palova.fr/club',
      'https://demo.palova.fr/events',
      'https://demo.palova.fr/parties',
    ]);
  });
});

describe('clubDynamicEntries', () => {
  it('ne garde que les tournois/events PUBLISHED', () => {
    const tournaments = [
      { id: 't1', status: 'PUBLISHED' } as Tournament,
      { id: 't2', status: 'DRAFT' } as Tournament,
    ];
    const events = [
      { id: 'e1', status: 'PUBLISHED' } as ClubEvent,
      { id: 'e2', status: 'CANCELLED' } as ClubEvent,
    ];
    const urls = clubDynamicEntries('demo.palova.fr', tournaments, events).map((e) => e.url);
    expect(urls).toEqual(['https://demo.palova.fr/tournois/t1', 'https://demo.palova.fr/events/e1']);
  });

  it('listes vides → tableau vide', () => {
    expect(clubDynamicEntries('demo.palova.fr', [], [])).toEqual([]);
  });
});

describe('platformEntries', () => {
  it('liste les pages statiques plateforme, sans /aide (redirection)', () => {
    const urls = platformEntries('palova.fr').map((e) => e.url);
    expect(urls).toEqual(expect.arrayContaining([
      'https://palova.fr/', 'https://palova.fr/tarifs',
      'https://palova.fr/offres', 'https://palova.fr/faq', 'https://palova.fr/cgu',
      'https://palova.fr/cgv', 'https://palova.fr/mentions-legales', 'https://palova.fr/confidentialite',
    ]));
    expect(urls).not.toContain('https://palova.fr/aide');
  });

  it('n’expose plus /decouvrir : la découverte vit dans `/`, qui la remplace', () => {
    expect(platformEntries('palova.fr').map((e) => e.url)).not.toContain('https://palova.fr/decouvrir');
  });
});
