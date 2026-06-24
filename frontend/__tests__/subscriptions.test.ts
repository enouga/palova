import { subscriptionCovers, coverageLabel, coveringSubscription } from '../lib/subscriptions';

const inclPadel = { sportKeys: ['padel'], offPeakOnly: true, benefit: 'INCLUDED' as const, discountPercent: null };
const discPadel = { sportKeys: ['padel'], offPeakOnly: true, benefit: 'DISCOUNT' as const, discountPercent: 50 };
const allHours  = { sportKeys: ['squash'], offPeakOnly: false, benefit: 'INCLUDED' as const, discountPercent: null };

describe('subscriptionCovers', () => {
  it('couvre padel en heures creuses', () => {
    expect(subscriptionCovers(inclPadel, { sportKey: 'padel', isOffPeak: true })).toBe(true);
  });
  it('ne couvre pas un créneau plein si offPeakOnly', () => {
    expect(subscriptionCovers(inclPadel, { sportKey: 'padel', isOffPeak: false })).toBe(false);
  });
  it('ne couvre pas un autre sport', () => {
    expect(subscriptionCovers(inclPadel, { sportKey: 'squash', isOffPeak: true })).toBe(false);
  });
  it('offPeakOnly=false couvre aussi les heures pleines', () => {
    expect(subscriptionCovers(allHours, { sportKey: 'squash', isOffPeak: false })).toBe(true);
  });
});

describe('coverageLabel', () => {
  it('INCLUDED → gratuit', () => { expect(coverageLabel(inclPadel)).toBe('gratuit'); });
  it('DISCOUNT → −50 %', () => { expect(coverageLabel(discPadel)).toBe('−50 %'); });
});

describe('coveringSubscription', () => {
  it('retourne le 1er abo couvrant, sinon null', () => {
    expect(coveringSubscription([inclPadel], { sportKey: 'padel', isOffPeak: true })).toBe(inclPadel);
    expect(coveringSubscription([inclPadel], { sportKey: 'padel', isOffPeak: false })).toBeNull();
  });
});
