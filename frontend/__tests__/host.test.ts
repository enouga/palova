import { clubSlugFromHost } from '../lib/host';

describe('clubSlugFromHost', () => {
  it.each([
    ['localhost:3000', 'localhost', null],
    ['palova.fr', 'palova.fr', null],
    ['www.palova.fr', 'palova.fr', null],
    ['app.palova.fr', 'palova.fr', null],
    ['demo.palova.fr', 'palova.fr', 'demo'],
    ['demo.palova.fr:443', 'palova.fr', 'demo'],
    // 1er label seulement, et www/app filtrés — comportement actuel du proxy conservé.
    ['www.demo.palova.fr', 'palova.fr', null],
    ['autresite.com', 'palova.fr', null],
    ['', 'palova.fr', null],
  ] as Array<[string, string, string | null]>)('host %s (root %s) → %s', (host, root, expected) => {
    expect(clubSlugFromHost(host, root)).toBe(expected);
  });

  it('demo.localhost:3000 → demo (dev local)', () => {
    expect(clubSlugFromHost('demo.localhost:3000', 'localhost')).toBe('demo');
  });

  // Multi-domaines : une liste de racines (palova.fr + palova.app) — chaque racine
  // garde la même sémantique (apex/www/app → plateforme, sous-domaine → slug).
  describe('liste de racines (palova.fr + palova.app)', () => {
    const ROOTS = ['palova.fr', 'palova.app'];
    it.each([
      ['demo.palova.fr', 'demo'],
      ['demo.palova.app', 'demo'],
      ['demo.palova.app:443', 'demo'],
      ['palova.fr', null],
      ['palova.app', null],
      ['www.palova.app', null],
      ['app.palova.app', null],
      ['www.demo.palova.app', null],
      ['autresite.com', null],
    ] as Array<[string, string | null]>)('host %s → %s', (host, expected) => {
      expect(clubSlugFromHost(host, ROOTS)).toBe(expected);
    });
  });
});
