// roots.ts lit process.env au chargement du module → on isole chaque cas avec
// jest.resetModules() + require pour réévaluer la liste de racines.
type RootsModule = typeof import('../lib/roots');

function loadRoots(domains?: string): RootsModule {
  jest.resetModules();
  if (domains === undefined) delete process.env.NEXT_PUBLIC_ROOT_DOMAINS;
  else process.env.NEXT_PUBLIC_ROOT_DOMAINS = domains;
  delete process.env.NEXT_PUBLIC_ROOT_DOMAIN; // pas de repli singulier dans ces cas
  return require('../lib/roots') as RootsModule;
}

describe('lib/roots', () => {
  const OLD_DOMAINS = process.env.NEXT_PUBLIC_ROOT_DOMAINS;
  const OLD_SINGLE = process.env.NEXT_PUBLIC_ROOT_DOMAIN;
  afterAll(() => {
    process.env.NEXT_PUBLIC_ROOT_DOMAINS = OLD_DOMAINS;
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = OLD_SINGLE;
    jest.resetModules();
  });

  it('repli localhost si aucune variable (dev)', () => {
    const { ROOT_DOMAINS, CANONICAL_ROOT, rootForHost } = loadRoots(undefined);
    expect(ROOT_DOMAINS).toEqual(['localhost']);
    expect(CANONICAL_ROOT).toBe('localhost');
    expect(rootForHost('demo.localhost:3000')).toBe('localhost');
    expect(rootForHost('localhost')).toBe('localhost');
    expect(rootForHost('autresite.com')).toBeNull();
  });

  describe('multi-domaines "palova.fr,palova.app"', () => {
    it('parse la liste, 1re = canonique', () => {
      const { ROOT_DOMAINS, CANONICAL_ROOT } = loadRoots('palova.fr, palova.app');
      expect(ROOT_DOMAINS).toEqual(['palova.fr', 'palova.app']);
      expect(CANONICAL_ROOT).toBe('palova.fr');
    });

    it.each([
      ['palova.fr', 'palova.fr'],
      ['palova.app', 'palova.app'],
      ['demo.palova.fr', 'palova.fr'],
      ['demo.palova.app:443', 'palova.app'],
      ['www.palova.app', 'palova.app'],
      ['autresite.com', null],
      ['palova.fr.evil.com', null],
    ] as Array<[string, string | null]>)('rootForHost(%s) → %s', (host, expected) => {
      const { rootForHost } = loadRoots('palova.fr,palova.app');
      expect(rootForHost(host)).toBe(expected);
    });
  });
});
