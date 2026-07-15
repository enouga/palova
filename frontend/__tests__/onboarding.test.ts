import {
  buildChecklist, checklistProgress, resourceNames, pluralNoun,
  BOOKING_PRESETS, CANCEL_PRESETS, STEP_ORDER, ONBOARDING_HIDDEN_KEY,
} from '@/lib/onboarding';
import { OnboardingStatus } from '@/lib/api';

const bare: OnboardingStatus = {
  hasLogo: false, sportsCount: 0, resourcesCount: 0,
  hasPresentation: false, stripeStatus: 'NONE', offersCount: 0, eventsCount: 0,
};

describe('buildChecklist', () => {
  it('club nu : 8 jalons, seul « Créer votre club » est fait', () => {
    const items = buildChecklist(bare);
    expect(items).toHaveLength(8);
    // fige l'ordre d'affichage consommé par la carte StartChecklist
    expect(items.map((i) => i.key)).toEqual(['club', 'logo', 'sports', 'courts', 'page', 'stripe', 'offers', 'event']);
    expect(items[0]).toMatchObject({ key: 'club', done: true, href: null });
    expect(items.filter((i) => i.done)).toHaveLength(1);
    expect(checklistProgress(items)).toEqual({ done: 1, total: 8 });
  });

  it('dérive chaque jalon de son état + href vers la bonne page admin', () => {
    const items = buildChecklist({
      hasLogo: true, sportsCount: 1, resourcesCount: 4,
      hasPresentation: true, stripeStatus: 'ACTIVE', offersCount: 2, eventsCount: 1,
    });
    expect(items.every((i) => i.done)).toBe(true);
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey.logo.href).toBe('/admin/settings?tab=identite');
    expect(byKey.sports.href).toBe('/admin/settings?tab=sports');
    expect(byKey.courts.href).toBe('/admin/courts');
    expect(byKey.page.href).toBe('/admin/club');
    expect(byKey.stripe.href).toBe('/admin/payments');
    expect(byKey.offers.href).toBe('/admin/packages');
    expect(byKey.event.href).toBe('/admin/events');
  });

  it('Stripe PENDING ne suffit pas', () => {
    const items = buildChecklist({ ...bare, stripeStatus: 'PENDING' });
    expect(items.find((i) => i.key === 'stripe')!.done).toBe(false);
  });

  it('deep-links the logo item to the Identité tab of settings', () => {
    const items = buildChecklist({
      hasLogo: false, sportsCount: 0, resourcesCount: 0, hasPresentation: false,
      stripeStatus: 'NONE', offersCount: 0, eventsCount: 0,
    });
    expect(items.find((i) => i.key === 'logo')?.href).toBe('/admin/settings?tab=identite');
  });
});

describe('resourceNames', () => {
  it('capitalise le noun et numérote à partir de l’existant', () => {
    expect(resourceNames('piste', 0, 2)).toEqual(['Piste 1', 'Piste 2']);
    expect(resourceNames('piste', 4, 3)).toEqual(['Piste 5', 'Piste 6', 'Piste 7']);
    expect(resourceNames('terrain', 0, 1)).toEqual(['Terrain 1']);
    expect(resourceNames('piste', 2, 0)).toEqual([]);
  });
});

describe('pluralNoun', () => {
  it('singulier ≤ 1, pluriel naïf en s au-delà', () => {
    expect(pluralNoun('piste', 1)).toBe('piste');
    expect(pluralNoun('piste', 4)).toBe('pistes');
    expect(pluralNoun('terrain', 0)).toBe('terrain');
    expect(pluralNoun('court', 2)).toBe('courts');
  });
});

describe('presets & constantes', () => {
  it('BOOKING_PRESETS : abonnés = 2× public', () => {
    expect(BOOKING_PRESETS.map((p) => p.publicDays)).toEqual([7, 14, 30]);
    BOOKING_PRESETS.forEach((p) => expect(p.memberDays).toBe(p.publicDays * 2));
  });
  it('CANCEL_PRESETS : 0 / 4 / 24 h', () => {
    expect(CANCEL_PRESETS.map((p) => p.hours)).toEqual([0, 4, 24]);
  });
  it('STEP_ORDER : 5 étapes dans l’ordre de la spec', () => {
    expect(STEP_ORDER).toEqual(['identity', 'sports', 'courts', 'rules', 'launch']);
  });
  it('clé localStorage par club', () => {
    expect(ONBOARDING_HIDDEN_KEY('c1')).toBe('palova:onboarding-hidden:c1');
  });
});
