import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import {
  PlatformBillingService, billingState, ACTIVE_WINDOW_DAYS,
} from '../platformBilling/platformBilling.service';

const service = new PlatformBillingService();
const NOW = new Date('2026-07-07T12:00:00Z');

describe('billingState (pur)', () => {
  it('EXEMPT prime sur tout', () => {
    expect(billingState({ billingExempt: true, observedTier: 3, subscription: null })).toBe('EXEMPT');
  });
  it('FREE si palier 0 sans abonnement', () => {
    expect(billingState({ billingExempt: false, observedTier: 0, subscription: null })).toBe('FREE');
  });
  it('TO_REGULARIZE si palier ≥ 1 sans abonnement vivant', () => {
    expect(billingState({ billingExempt: false, observedTier: 1, subscription: null })).toBe('TO_REGULARIZE');
    expect(billingState({ billingExempt: false, observedTier: 2, subscription: { status: 'canceled' } })).toBe('TO_REGULARIZE');
  });
  it('PAST_DUE si impayé', () => {
    expect(billingState({ billingExempt: false, observedTier: 2, subscription: { status: 'past_due' } })).toBe('PAST_DUE');
    expect(billingState({ billingExempt: false, observedTier: 2, subscription: { status: 'unpaid' } })).toBe('PAST_DUE');
  });
  it('OK si abonnement actif', () => {
    expect(billingState({ billingExempt: false, observedTier: 2, subscription: { status: 'active' } })).toBe('OK');
  });
});

describe('countActiveMembers', () => {
  beforeEach(() => {
    prismaMock.reservation.findMany.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([] as any);
    prismaMock.eventRegistration.findMany.mockResolvedValue([] as any);
    prismaMock.lessonEnrollment.findMany.mockResolvedValue([] as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);
    prismaMock.subscription.findMany.mockResolvedValue([] as any);
  });

  it('déduplique les userIds à travers toutes les sources', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([
      { userId: 'u1', participants: [{ userId: 'u2' }, { userId: 'u3' }] },
      { userId: null, participants: [{ userId: 'u1' }] },
    ] as any);
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([
      { captainUserId: 'u2', partnerUserId: 'u4' },
    ] as any);
    prismaMock.eventRegistration.findMany.mockResolvedValue([{ userId: 'u5' }] as any);
    prismaMock.lessonEnrollment.findMany.mockResolvedValue([{ userId: 'u5' }] as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([{ userId: 'u6' }] as any);
    prismaMock.subscription.findMany.mockResolvedValue([{ userId: 'u1' }] as any);

    // u1..u6 distincts = 6
    expect(await service.countActiveMembers('club-1', NOW)).toBe(6);
  });

  it('filtre sur la fenêtre de 90 jours et le club', async () => {
    await service.countActiveMembers('club-1', NOW);
    const since = new Date(NOW.getTime() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    expect(prismaMock.reservation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { resource: { clubId: 'club-1' }, status: 'CONFIRMED', startTime: { gte: since } },
    }));
    expect(prismaMock.tournamentRegistration.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tournament: { clubId: 'club-1' }, status: { not: 'CANCELLED' }, createdAt: { gte: since } },
    }));
  });
});

describe('refreshActiveMemberCount', () => {
  it('écrit le compteur et la date sur le club', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([{ userId: 'u1', participants: [] }] as any);
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([] as any);
    prismaMock.eventRegistration.findMany.mockResolvedValue([] as any);
    prismaMock.lessonEnrollment.findMany.mockResolvedValue([] as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);
    prismaMock.subscription.findMany.mockResolvedValue([] as any);
    prismaMock.club.update.mockResolvedValue({} as any);

    const count = await service.refreshActiveMemberCount('club-1', NOW);
    expect(count).toBe(1);
    expect(prismaMock.club.update).toHaveBeenCalledWith({
      where: { id: 'club-1' },
      data: { activeMemberCount: 1, activeMemberCountAt: NOW },
    });
  });
});
