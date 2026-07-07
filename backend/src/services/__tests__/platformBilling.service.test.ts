import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

jest.mock('../platformBilling/stripeBilling', () => ({
  changeSubscriptionTier: jest.fn().mockResolvedValue(undefined),
  cancelAtPeriodEnd: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../platformBilling/billingEmails', () => ({
  buildOverFreeTierEmail: jest.fn().mockReturnValue({ subject: 's', html: 'h', text: 't' }),
  buildTierChangeEmail: jest.fn().mockReturnValue({ subject: 's', html: 'h', text: 't' }),
  buildSubscribedEmail: jest.fn().mockReturnValue({ subject: 's', html: 'h', text: 't' }),
  sendToOwners: jest.fn().mockResolvedValue(undefined),
}));

import { changeSubscriptionTier, cancelAtPeriodEnd } from '../platformBilling/stripeBilling';
import { sendToOwners } from '../platformBilling/billingEmails';
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

describe('evaluateClub (règles de palier)', () => {
  const CLUB = { id: 'club-1', name: 'Club', slug: 'club', billingExempt: false };
  // Évaluation du 2026-08-01 → snapshot du mois écoulé '2026-07', mois précédent '2026-06'.
  const EVAL_NOW = new Date('2026-08-01T02:30:00Z');

  function mockCount(n: number) {
    jest.spyOn(service, 'countActiveMembers').mockResolvedValue(n);
  }
  function mockSub(sub: { status: string; tier: number; stripeSubscriptionId?: string; interval?: string } | null) {
    prismaMock.platformSubscription.findUnique.mockResolvedValue(
      sub ? { stripeSubscriptionId: 'sub_1', interval: 'month', cancelAtPeriodEnd: false, ...sub } as any : null,
    );
  }
  function mockPrevSnapshot(observedTier: number | null) {
    prismaMock.clubMemberSnapshot.findUnique.mockResolvedValue(
      observedTier === null ? null : ({ observedTier } as any),
    );
  }

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    prismaMock.clubMemberSnapshot.upsert.mockResolvedValue({} as any);
    prismaMock.platformSubscription.update.mockResolvedValue({} as any);
    prismaMock.club.update.mockResolvedValue({} as any);
  });

  it('écrit le snapshot du mois écoulé (upsert idempotent)', async () => {
    mockCount(60); mockSub(null); mockPrevSnapshot(null);
    await service.evaluateClub(CLUB, EVAL_NOW);
    expect(prismaMock.clubMemberSnapshot.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { clubId_month: { clubId: 'club-1', month: '2026-07' } },
      create: expect.objectContaining({ activeMembers: 60, observedTier: 1 }),
    }));
  });

  it('exempt → snapshot mais aucune action', async () => {
    mockCount(500); mockSub(null); mockPrevSnapshot(4);
    const action = await service.evaluateClub({ ...CLUB, billingExempt: true }, EVAL_NOW);
    expect(action).toBe('none');
    expect(sendToOwners).not.toHaveBeenCalled();
  });

  it('sans abonnement et palier ≥ 1 → relance email', async () => {
    mockCount(60); mockSub(null); mockPrevSnapshot(null);
    const action = await service.evaluateClub(CLUB, EVAL_NOW);
    expect(action).toBe('remind');
    expect(sendToOwners).toHaveBeenCalledWith('club-1', expect.anything());
  });

  it('sans abonnement et palier 0 → rien', async () => {
    mockCount(30); mockSub(null); mockPrevSnapshot(null);
    expect(await service.evaluateClub(CLUB, EVAL_NOW)).toBe('none');
  });

  it('montée : 1er mois au-dessus → pending (pas de swap)', async () => {
    mockCount(200); mockSub({ status: 'active', tier: 1 }); mockPrevSnapshot(1);
    const action = await service.evaluateClub(CLUB, EVAL_NOW);
    expect(action).toBe('pending_upgrade');
    expect(changeSubscriptionTier).not.toHaveBeenCalled();
  });

  it('montée : 2 mois consécutifs au-dessus → swap + email + maj DB', async () => {
    mockCount(200); mockSub({ status: 'active', tier: 1 }); mockPrevSnapshot(2);
    const action = await service.evaluateClub(CLUB, EVAL_NOW);
    expect(action).toBe('upgrade');
    expect(changeSubscriptionTier).toHaveBeenCalledWith('sub_1', 2);
    expect(prismaMock.platformSubscription.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { clubId: 'club-1' }, data: { tier: 2 },
    }));
    expect(sendToOwners).toHaveBeenCalled();
  });

  it('descente : dès 1 évaluation en dessous → swap', async () => {
    mockCount(100); mockSub({ status: 'active', tier: 2 }); mockPrevSnapshot(2);
    const action = await service.evaluateClub(CLUB, EVAL_NOW);
    expect(action).toBe('downgrade');
    expect(changeSubscriptionTier).toHaveBeenCalledWith('sub_1', 1);
  });

  it('descente à 0 → annulation à échéance', async () => {
    mockCount(30); mockSub({ status: 'active', tier: 1 }); mockPrevSnapshot(1);
    const action = await service.evaluateClub(CLUB, EVAL_NOW);
    expect(action).toBe('cancel');
    expect(cancelAtPeriodEnd).toHaveBeenCalledWith('sub_1');
    expect(prismaMock.platformSubscription.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { cancelAtPeriodEnd: true },
    }));
  });

  it('palier stable → aucune action', async () => {
    mockCount(200); mockSub({ status: 'active', tier: 2 }); mockPrevSnapshot(2);
    expect(await service.evaluateClub(CLUB, EVAL_NOW)).toBe('none');
    expect(changeSubscriptionTier).not.toHaveBeenCalled();
  });

  it('abonnement canceled = comme sans abonnement', async () => {
    mockCount(60); mockSub({ status: 'canceled', tier: 1 }); mockPrevSnapshot(null);
    expect(await service.evaluateClub(CLUB, EVAL_NOW)).toBe('remind');
  });
});
