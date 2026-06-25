import { notificationVisual, relativeTime } from '@/lib/notifications';
import { ACCENTS } from '@/lib/theme';

describe('notificationVisual', () => {
  it('mappe chaque catégorie sur une icône + accent', () => {
    expect(notificationVisual('REMINDERS', 'reminder.upcoming_game').icon).toBe('clock');
    expect(notificationVisual('MY_GAMES', 'open_match.joined').icon).toBe('users');
    expect(notificationVisual('MY_REGISTRATIONS', 'registration.confirmed').icon).toBe('trophy');
    expect(notificationVisual('ORGANIZER', 'organizer.registration').icon).toBe('trophy');
    expect(notificationVisual('PAYMENTS', 'payment.refunded').icon).toBe('euro');
    expect(notificationVisual('MY_MATCHES', 'match.comment').icon).toBe('ball');
  });

  it('retombe sur la cloche pour une catégorie inconnue', () => {
    expect(notificationVisual('WAT', 'nope').icon).toBe('bell');
    expect(notificationVisual('WAT', 'nope').accent).toBe(ACCENTS.blue);
  });

  it('le type prime : annulation = croix coral, report = calendrier abricot', () => {
    const cancelled = notificationVisual('MY_GAMES', 'reservation.cancelled');
    expect(cancelled.icon).toBe('x');
    expect(cancelled.accent).toBe(ACCENTS.coral);

    const moved = notificationVisual('MY_GAMES', 'reservation.rescheduled');
    expect(moved.icon).toBe('calendar');
    expect(moved.accent).toBe(ACCENTS.apricot);
  });

  it('annulation par le club aussi en coral', () => {
    expect(notificationVisual('MY_REGISTRATIONS', 'activity.cancelled_by_club').accent).toBe(ACCENTS.coral);
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-06-25T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;

  it('moins d\'une minute → à l\'instant', () => {
    expect(relativeTime(ago(30 * SEC), now)).toBe("à l'instant");
  });
  it('une date future est ramenée à « à l\'instant »', () => {
    expect(relativeTime(new Date(now.getTime() + 5 * MIN).toISOString(), now)).toBe("à l'instant");
  });
  it('minutes', () => {
    expect(relativeTime(ago(5 * MIN), now)).toBe('il y a 5 min');
  });
  it('heures', () => {
    expect(relativeTime(ago(2 * HOUR), now)).toBe('il y a 2 h');
  });
  it('hier', () => {
    expect(relativeTime(ago(28 * HOUR), now)).toBe('hier');
  });
  it('quelques jours', () => {
    expect(relativeTime(ago(3 * DAY), now)).toBe('il y a 3 j');
  });
  it('au-delà d\'une semaine → date en clair', () => {
    expect(relativeTime(ago(20 * DAY), now)).toBe('5 juin');
  });
  it('année différente → date avec année', () => {
    expect(relativeTime('2025-12-01T12:00:00Z', now)).toBe('1 décembre 2025');
  });
});
