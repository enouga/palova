import { buildRobots } from '../lib/robotsRules';

function rule(r: ReturnType<typeof buildRobots>) {
  return Array.isArray(r.rules) ? r.rules[0] : r.rules;
}

describe('buildRobots — hôte club', () => {
  const r = () => rule(buildRobots('demo', 'demo.localhost:3000'));

  it('autorise la vitrine publique', () => {
    expect(r().allow).toEqual(expect.arrayContaining(['/', '/club', '/events', '/events/*', '/tournois/*', '/parties']));
  });

  it('bloque les pages privées', () => {
    expect(r().disallow).toEqual(expect.arrayContaining(['/reserver', '/cours', '/me', '/admin', '/superadmin', '/login', '/forgot-password', '/session-bridge', '/clubs']));
  });

  it('bloque les pages à gabarit de repli dupliqué entre clubs (CGU/CGV/mentions/confidentialité/offres/aide/FAQ)', () => {
    expect(r().disallow).toEqual(expect.arrayContaining(['/cgu', '/cgv', '/mentions-legales', '/confidentialite', '/offres', '/aide', '/faq']));
  });

  it("ne bloque pas /parties/:id (unfurling social) ni /tournois (redirection interne, ignorée)", () => {
    expect(r().disallow).not.toContain('/parties');
    expect(r().disallow).not.toContain('/tournois');
  });
});

describe('buildRobots — hôte plateforme', () => {
  const r = () => rule(buildRobots(null, 'palova.fr'));

  it('autorise les pages légales (copie canonique unique) et le FAQ', () => {
    expect(r().allow).toEqual(expect.arrayContaining(['/', '/tarifs', '/offres', '/faq', '/cgu', '/cgv', '/mentions-legales', '/confidentialite']));
    expect(r().disallow).not.toContain('/faq');
  });

  it('bloque /aide (pure redirection vers /faq ici) et les pages privées', () => {
    expect(r().disallow).toEqual(expect.arrayContaining(['/aide', '/login', '/forgot-password', '/clubs', '/me', '/admin', '/superadmin', '/session-bridge']));
  });

  it('bloque /decouvrir (fusionnée dans l’accueil) et /archive (copies figées) — jamais de doublon indexé', () => {
    expect(r().allow).not.toContain('/decouvrir');
    expect(r().disallow).toEqual(expect.arrayContaining(['/decouvrir', '/archive']));
  });
});

describe('buildRobots — sitemap', () => {
  it('pointe toujours vers le sitemap du même hôte', () => {
    expect(buildRobots('demo', 'demo.palova.fr').sitemap).toBe('https://demo.palova.fr/sitemap.xml');
    expect(buildRobots(null, 'palova.fr').sitemap).toBe('https://palova.fr/sitemap.xml');
  });
});
