import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

jest.mock('../../email/mailer', () => ({ sendMail: jest.fn().mockResolvedValue(undefined) }));
import { sendMail } from '../../email/mailer';
import { runClubJanitor, REMINDER_DAYS, SUSPEND_DAYS } from '../clubJanitor.job';

const now = new Date('2026-08-01T04:15:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000);

describe('runClubJanitor', () => {
  beforeEach(() => {
    (sendMail as jest.Mock).mockClear();
    prismaMock.club.findMany.mockResolvedValue([]);
    prismaMock.club.update.mockResolvedValue({} as any);
    prismaMock.user.findMany.mockResolvedValue([]);
  });

  it('relance un club sans terrain à J+15 (email + setupReminderSentAt)', async () => {
    prismaMock.club.findMany.mockResolvedValue([
      { id: 'c1', slug: 's1', name: 'Club Un', createdAt: daysAgo(16), setupReminderSentAt: null, autoSuspendedAt: null,
        members: [{ user: { email: 'o@e.fr' } }] },
    ] as any);
    await runClubJanitor(now);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'o@e.fr' }));
    expect(prismaMock.club.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'c1' }, data: expect.objectContaining({ setupReminderSentAt: now }),
    }));
  });

  it('suspend un club relancé il y a plus de 7 j et vieux de 30 j', async () => {
    prismaMock.club.findMany.mockResolvedValue([
      { id: 'c2', slug: 's2', name: 'Club Deux', createdAt: daysAgo(31), setupReminderSentAt: daysAgo(10), autoSuspendedAt: null,
        members: [{ user: { email: 'o2@e.fr' } }] },
    ] as any);
    await runClubJanitor(now);
    expect(prismaMock.club.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'c2' }, data: expect.objectContaining({ status: 'SUSPENDED', autoSuspendedAt: now }),
    }));
  });

  it('ne suspend pas un club relancé il y a moins de 7 j', async () => {
    prismaMock.club.findMany.mockResolvedValue([
      { id: 'c3', slug: 's3', name: 'C3', createdAt: daysAgo(31), setupReminderSentAt: daysAgo(3), autoSuspendedAt: null, members: [] },
    ] as any);
    await runClubJanitor(now);
    expect(prismaMock.club.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SUSPENDED' }) }));
  });

  it('continue si un email échoue (best-effort)', async () => {
    (sendMail as jest.Mock).mockRejectedValue(new Error('smtp'));
    prismaMock.club.findMany.mockResolvedValue([
      { id: 'c4', slug: 's4', name: 'C4', createdAt: daysAgo(16), setupReminderSentAt: null, autoSuspendedAt: null, members: [{ user: { email: 'o@e.fr' } }] },
    ] as any);
    await expect(runClubJanitor(now)).resolves.not.toThrow();
  });
});
