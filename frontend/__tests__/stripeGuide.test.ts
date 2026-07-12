import { GUIDE_STEPS, stripeGuideStates, STRIPE_DOC_LINKS } from '../lib/stripeGuide';

describe('GUIDE_STEPS', () => {
  it('contient 4 étapes avec clé, titre et corps', () => {
    expect(GUIDE_STEPS).toHaveLength(4);
    for (const step of GUIDE_STEPS) {
      expect(step.key).toEqual(expect.any(String));
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
    }
  });
});

describe('stripeGuideStates', () => {
  it('NONE : étape 1 en cours, le reste à faire', () => {
    expect(stripeGuideStates('NONE')).toEqual(['current', 'todo', 'todo', 'todo']);
  });

  it('PENDING : étape 1 faite, étape 2 en cours', () => {
    expect(stripeGuideStates('PENDING')).toEqual(['done', 'current', 'todo', 'todo']);
  });

  it('RESTRICTED : étapes 1-2 faites, étape 3 en cours', () => {
    expect(stripeGuideStates('RESTRICTED')).toEqual(['done', 'done', 'current', 'todo']);
  });

  it('ACTIVE : étapes 1-3 faites, étape 4 en cours', () => {
    expect(stripeGuideStates('ACTIVE')).toEqual(['done', 'done', 'done', 'current']);
  });
});

describe('STRIPE_DOC_LINKS', () => {
  it('pointe vers la documentation Stripe en français', () => {
    expect(STRIPE_DOC_LINKS.length).toBeGreaterThan(0);
    for (const link of STRIPE_DOC_LINKS) {
      expect(link.label.length).toBeGreaterThan(0);
      expect(link.url).toMatch(/^https:\/\/(docs|support)\.stripe\.com\//);
      expect(link.url).toContain('locale=fr-FR');
    }
  });
});
