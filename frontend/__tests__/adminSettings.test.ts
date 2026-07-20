import {
  SETTINGS_TABS, parseTab, buildUpdateBody, isDirty, offPeakChipLabel,
  DAY_PRESETS_PUBLIC, DAY_PRESETS_MEMBER, BOOKING_RELEASE_MODE_HELP,
  toSportsDraft, addSportDraft, toggleDurationDraft, sportsDirty, buildSportsBatchBody,
} from '@/lib/adminSettings';
import type { ClubAdminDetail, AdminClubSport } from '@/lib/api';

const CLUB: ClubAdminDetail = {
  id: 'c1', slug: 'demo', name: 'Démo', description: '', address: 'a', city: '', country: '',
  timezone: 'Europe/Paris', logoUrl: '', logoWideUrl: null, logoWideDarkUrl: null, coverImageUrl: null, accentColor: '#5e93da', defaultThemeMode: 'daylight',
  status: 'ACTIVE', listedInDirectory: true, listTournamentsNationally: false, showOffersPublicly: false,
  publicBookingDays: 7, memberBookingDays: 14, bookingReleaseMode: 'DAY_AT_HOUR', publicReleaseHour: 8, memberReleaseHour: 8,
  offPeakHours: null, bookingQuotas: null, playerChangeCutoffHours: 2, cancellationCutoffHours: 2,
  showOtherClubsReservations: false, refundOnCancelWithinCutoff: false, levelSystemEnabled: true,
  stripeAccountId: null, stripeAccountStatus: 'ACTIVE', requireOnlinePayment: true, requireCardFingerprint: true,
  quickPaymentMethods: ['CARD'], payAtClubOnly: false,
  legalEntityName: '', legalForm: '', siret: '', vatNumber: '', legalRepresentative: '', legalEmail: '', legalPhone: '',
  mediatorName: '', mediatorUrl: '',
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

  it('BOOKING_RELEASE_MODE_HELP has one distinct explanation per mode', () => {
    const modes: (keyof typeof BOOKING_RELEASE_MODE_HELP)[] = ['DAY_AT_HOUR', 'ROLLING_SLOT', 'WINDOW_SHIFT'];
    for (const m of modes) expect(BOOKING_RELEASE_MODE_HELP[m].length).toBeGreaterThan(0);
    expect(new Set(modes.map((m) => BOOKING_RELEASE_MODE_HELP[m])).size).toBe(3);
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

const PADEL_CS: AdminClubSport = {
  id: 'cs-padel', slotStepMin: null, durationsMin: [90],
  sport: { id: 'padel', key: 'padel', name: 'Padel', resourceNoun: 'Court', defaultDurationsMin: [90], surfaces: [], hasLighting: false },
};

describe('adminSettings — brouillon Sports', () => {
  it('toSportsDraft convertit la liste serveur en brouillon éditable', () => {
    expect(toSportsDraft([PADEL_CS])).toEqual([{ sportId: 'padel', clubSportId: 'cs-padel', durationsMin: [90] }]);
  });

  it('addSportDraft ajoute un sport absent, idempotent si déjà présent', () => {
    const draft = toSportsDraft([PADEL_CS]);
    const withTennis = addSportDraft(draft, 'tennis');
    expect(withTennis).toEqual([...draft, { sportId: 'tennis', clubSportId: null, durationsMin: [] }]);
    expect(addSportDraft(withTennis, 'tennis')).toBe(withTennis); // idempotent, pas de doublon
  });

  it('toggleDurationDraft bascule une durée et refuse de tout décocher', () => {
    const draft = toSportsDraft([PADEL_CS]); // durationsMin: [90]
    const toggled = toggleDurationDraft(draft, 'padel', [90], 60); // ajoute 60
    expect(toggled[0].durationsMin).toEqual([60, 90]);

    const oneLeft = toggleDurationDraft(toggled, 'padel', [90], 60); // retire 60
    expect(oneLeft[0].durationsMin).toEqual([90]);

    const refused = toggleDurationDraft(oneLeft, 'padel', [90], 90); // tenter de retirer la dernière
    expect(refused[0].durationsMin).toEqual([90]); // refusé : au moins une durée
  });

  it('sportsDirty est faux pour un brouillon identique, vrai après ajout ou changement de durées', () => {
    const server = [PADEL_CS];
    expect(sportsDirty(server, toSportsDraft(server))).toBe(false);
    expect(sportsDirty(server, addSportDraft(toSportsDraft(server), 'tennis'))).toBe(true);
    expect(sportsDirty(server, toggleDurationDraft(toSportsDraft(server), 'padel', [90], 60))).toBe(true);
  });

  it('buildSportsBatchBody ne renvoie que les lignes modifiées', () => {
    const server = [PADEL_CS];
    expect(buildSportsBatchBody(server, toSportsDraft(server))).toEqual([]); // rien de modifié

    const withTennis = addSportDraft(toSportsDraft(server), 'tennis');
    expect(buildSportsBatchBody(server, withTennis)).toEqual([{ sportId: 'tennis', durationsMin: [] }]);

    const toggled = toggleDurationDraft(toSportsDraft(server), 'padel', [90], 60);
    expect(buildSportsBatchBody(server, toggled)).toEqual([{ sportId: 'padel', durationsMin: [60, 90] }]);
  });
});
