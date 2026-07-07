import {
  buildOverFreeTierEmail, buildTierChangeEmail, buildSubscribedEmail, eurosLabel,
} from '../platformBilling/billingEmails';

describe('eurosLabel', () => {
  it('formate les centimes en euros FR', () => {
    expect(eurosLabel(2900)).toBe('29 €');
    expect(eurosLabel(29600)).toBe('296 €');
    expect(eurosLabel(2950)).toBe('29,50 €');
  });
});

describe('buildOverFreeTierEmail', () => {
  it('objet + CTA vers /admin/billing du club, montant du palier observé', () => {
    const mail = buildOverFreeTierEmail({ clubName: 'Padel Arena', slug: 'padel-arena', activeMembers: 180, observedTier: 2 });
    expect(mail.subject).toContain('palier gratuit');
    expect(mail.html).toContain('180');
    expect(mail.html).toContain('59');
    expect(mail.html).toContain('/admin/billing');
    expect(mail.text).toContain('59');
  });
  it('échappe le nom du club', () => {
    const mail = buildOverFreeTierEmail({ clubName: '<b>x</b>', slug: 's', activeMembers: 60, observedTier: 1 });
    expect(mail.html).not.toContain('<b>x</b>');
  });
});

describe('buildTierChangeEmail', () => {
  it('montée : préavis avec nouveau montant', () => {
    const mail = buildTierChangeEmail({ clubName: 'C', slug: 's', fromTier: 1, toTier: 2, interval: 'month' });
    expect(mail.subject).toContain('palier');
    expect(mail.html).toContain('59');
  });
  it('retour au gratuit (toTier 0)', () => {
    const mail = buildTierChangeEmail({ clubName: 'C', slug: 's', fromTier: 1, toTier: 0, interval: 'month' });
    expect(mail.html.toLowerCase()).toContain('gratuit');
  });
});

describe('buildSubscribedEmail', () => {
  it('confirme palier + cadence', () => {
    const mail = buildSubscribedEmail({ clubName: 'C', slug: 's', tier: 3, interval: 'year' });
    expect(mail.html).toContain('1 010');
    expect(mail.subject.toLowerCase()).toContain('abonnement');
  });
});
