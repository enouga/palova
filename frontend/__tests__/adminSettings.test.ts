import {
  SETTINGS_TABS, parseTab, buildUpdateBody, isDirty, offPeakChipLabel,
  DAY_PRESETS_PUBLIC, DAY_PRESETS_MEMBER,
} from '@/lib/adminSettings';
import type { ClubAdminDetail } from '@/lib/api';

const CLUB: ClubAdminDetail = {
  id: 'c1', slug: 'demo', name: 'Démo', description: '', address: 'a', city: '', country: '',
  timezone: 'Europe/Paris', logoUrl: '', coverImageUrl: null, accentColor: '#5e93da', defaultThemeMode: 'daylight',
  status: 'ACTIVE', listedInDirectory: true, listTournamentsNationally: false, showOffersPublicly: false,
  publicBookingDays: 7, memberBookingDays: 14, bookingReleaseMode: 'DAY_AT_HOUR', publicReleaseHour: 8, memberReleaseHour: 8,
  offPeakHours: null, bookingQuotas: null, playerChangeCutoffHours: 2, cancellationCutoffHours: 2,
  showOtherClubsReservations: false, refundOnCancelWithinCutoff: false, levelSystemEnabled: true,
  stripeAccountId: null, stripeAccountStatus: 'ACTIVE', requireOnlinePayment: true, requireCardFingerprint: true,
  quickPaymentMethods: ['CARD'], payAtClubOnly: false,
  legalEntityName: '', legalForm: '', siret: '', vatNumber: '', legalRepresentative: '', legalEmail: '', legalPhone: '',
};

describe('adminSettings helpers', () => {
  it('exposes 6 tabs in order (Sports second)', () => {
    expect(SETTINGS_TABS.map((t) => t.key)).toEqual(['identite', 'sports', 'reservation', 'tarifs', 'caisse', 'visibilite']);
  });

  it('parseTab reads ?tab= and defaults/sanitizes to identite', () => {
    expect(parseTab('?tab=caisse')).toBe('caisse');
    expect(parseTab('?foo=1')).toBe('identite');
    expect(parseTab('?tab=bogus')).toBe('identite');
    expect(parseTab('')).toBe('identite');
  });

  it('buildUpdateBody includes showOtherClubsReservations (fixes the persisted-toggle bug)', () => {
    const body = buildUpdateBody({ ...CLUB, showOtherClubsReservations: true });
    expect(body.showOtherClubsReservations).toBe(true);
  });

  it('buildUpdateBody sends offPeakHours=null when the map is empty', () => {
    expect(buildUpdateBody({ ...CLUB, offPeakHours: {} }).offPeakHours).toBeNull();
    expect(buildUpdateBody({ ...CLUB, offPeakHours: { 1: [{ start: 9, end: 12 }] } }).offPeakHours)
      .toEqual({ 1: [{ start: 9, end: 12 }] });
  });

  it('isDirty is false for identical draft and true after any saved-field change', () => {
    expect(isDirty(CLUB, { ...CLUB })).toBe(false);
    expect(isDirty(CLUB, { ...CLUB, name: 'Autre' })).toBe(true);
    expect(isDirty(CLUB, { ...CLUB, bookingQuotas: { model: 'WEEKLY', subscriber: { peak: null, offPeak: null }, nonSubscriber: { peak: null, offPeak: null } } })).toBe(true);
  });

  it('offPeakChipLabel formats a range as "9h00 → 12h30"', () => {
    expect(offPeakChipLabel({ start: 9, end: 12 })).toBe('9h00 → 12h00');
    expect(offPeakChipLabel({ start: 9, startMin: 30, end: 12, endMin: 15 })).toBe('9h30 → 12h15');
  });

  it('exposes independent day presets for public and members', () => {
    expect(DAY_PRESETS_PUBLIC).toEqual([7, 14, 30]);
    expect(DAY_PRESETS_MEMBER).toEqual([14, 28, 60]);
  });
});
