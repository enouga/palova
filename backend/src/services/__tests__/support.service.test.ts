import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

jest.mock('../../email/mailer', () => ({ sendMail: jest.fn().mockResolvedValue(undefined) }));
const { sendMail } = require('../../email/mailer');

import { SupportService, buildIssuePayload } from '../support.service';

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const CTX = { clubName: 'Padel Arena Paris', clubSlug: 'padel-arena-paris', senderName: 'Jean Dupont', senderEmail: 'jean@x.fr', senderRole: 'STAFF', activeMemberCount: 87 as number | null };
const INPUT = { category: 'BUG' as const, subject: 'Planning cassé', description: 'Le planning ne charge plus\nsur mobile.' };

describe('buildIssuePayload (pur)', () => {
  it('construit titre, label et body avec description citée', () => {
    const p = buildIssuePayload(CTX, INPUT, '2026-07-19T10:00:00.000Z');
    expect(p.title).toBe('[Bug] Planning cassé — Padel Arena Paris');
    expect(p.labels).toEqual(['bug']);
    expect(p.body).toContain('**Club** : Padel Arena Paris (padel-arena-paris.palova.fr)');
    expect(p.body).toContain('**Expéditeur** : Jean Dupont (jean@x.fr) — STAFF');
    expect(p.body).toContain('**Membres actifs** : 87');
    expect(p.body).toContain('> Le planning ne charge plus');
    expect(p.body).toContain('> sur mobile.');
  });

  it('membres actifs inconnus → « ? » (jamais bloquant)', () => {
    const p = buildIssuePayload({ ...CTX, activeMemberCount: null }, INPUT, '2026-07-19T10:00:00.000Z');
    expect(p.body).toContain('**Membres actifs** : ?');
  });
});

describe('SupportService.createTicket', () => {
  let service: SupportService;

  beforeEach(() => {
    service = new SupportService();
    fetchMock.mockReset();
    (sendMail as jest.Mock).mockClear().mockResolvedValue(undefined);
    process.env.GITHUB_SUPPORT_TOKEN = 'ghp_test';
    process.env.GITHUB_SUPPORT_REPO = 'enouga/palova-support';
    prismaMock.club.findUnique.mockResolvedValue({ name: 'Padel Arena Paris', slug: 'padel-arena-paris', activeMemberCount: 87 } as any);
    prismaMock.user.findUnique.mockResolvedValue({ deletedAt: null, firstName: 'Jean', lastName: 'Dupont', email: 'jean@x.fr' } as any);
    prismaMock.clubMember.findUnique.mockResolvedValue({ role: 'STAFF' } as any);
  });

  afterEach(() => {
    delete process.env.GITHUB_SUPPORT_TOKEN;
    delete process.env.GITHUB_SUPPORT_REPO;
  });

  it('succès GitHub : appelle l API avec token + payload, renvoie le numéro, accuse réception', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ number: 42 }) });
    const r = await service.createTicket('club-demo', 'user-1', INPUT);
    expect(r).toEqual({ number: 42 });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/enouga/palova-support/issues');
    expect(opts.headers.Authorization).toBe('Bearer ghp_test');
    const body = JSON.parse(opts.body);
    expect(body.title).toBe('[Bug] Planning cassé — Padel Arena Paris');
    expect(body.labels).toEqual(['bug']);
    await new Promise((r2) => setImmediate(r2)); // accusé best-effort
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'jean@x.fr', subject: expect.stringContaining('#42') }));
  });

  it('GitHub en échec : repli email au support, renvoie number null', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const r = await service.createTicket('club-demo', 'user-1', INPUT);
    expect(r).toEqual({ number: null });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'contact@palova.fr', subject: '[Bug] Planning cassé — Padel Arena Paris' }));
  });

  it('GitHub ET repli email en échec : SUPPORT_UNAVAILABLE', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    (sendMail as jest.Mock).mockRejectedValue(new Error('smtp down'));
    await expect(service.createTicket('club-demo', 'user-1', INPUT)).rejects.toThrow('SUPPORT_UNAVAILABLE');
  });

  it('sans token (dev) : pas de fetch, pas de repli, number null', async () => {
    delete process.env.GITHUB_SUPPORT_TOKEN;
    const r = await service.createTicket('club-demo', 'user-1', INPUT);
    expect(r).toEqual({ number: null });
    expect(fetchMock).not.toHaveBeenCalled();
    await new Promise((r2) => setImmediate(r2));
    // seul l'accusé part (pas le repli contact@)
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect((sendMail as jest.Mock).mock.calls[0][0].to).toBe('jean@x.fr');
  });

  it('échec de l accusé de réception : le ticket réussit quand même', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ number: 7 }) });
    (sendMail as jest.Mock).mockRejectedValue(new Error('smtp down'));
    await expect(service.createTicket('club-demo', 'user-1', INPUT)).resolves.toEqual({ number: 7 });
  });

  it.each([
    [{ ...INPUT, category: 'NOPE' as never }],
    [{ ...INPUT, subject: 'ab' }],
    [{ ...INPUT, subject: 'x'.repeat(121) }],
    [{ ...INPUT, description: 'court' }],
    [{ ...INPUT, description: 'x'.repeat(5001) }],
  ])('validation refusée → VALIDATION_ERROR (%#)', async (bad) => {
    await expect(service.createTicket('club-demo', 'user-1', bad)).rejects.toThrow('VALIDATION_ERROR');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
