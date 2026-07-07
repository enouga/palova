import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const stripeMock = { invoices: { list: jest.fn() } };
jest.mock('../../db/stripe', () => ({ stripe: stripeMock }));

import {
  invoiceFields, invoiceSubscriptionId, upsertInvoice, syncAllInvoices, StripeInvoiceLike,
} from '../platformBilling/platformInvoices';

beforeEach(() => { jest.clearAllMocks(); });

describe('invoiceSubscriptionId', () => {
  it('lit invoice.subscription (API pré-Basil)', () => {
    expect(invoiceSubscriptionId({ id: 'in', subscription: 'sub_1' } as StripeInvoiceLike)).toBe('sub_1');
  });
  it('lit parent.subscription_details.subscription (API Basil)', () => {
    expect(invoiceSubscriptionId({
      id: 'in', parent: { subscription_details: { subscription: 'sub_2' } },
    } as StripeInvoiceLike)).toBe('sub_2');
  });
  it('null si aucun des deux', () => {
    expect(invoiceSubscriptionId({ id: 'in' } as StripeInvoiceLike)).toBeNull();
  });
});

describe('invoiceFields', () => {
  it('forme pré-Basil : tier/interval/période depuis le lookup_key de la ligne', () => {
    const f = invoiceFields({
      id: 'in_1', status: 'paid', currency: 'eur',
      amount_paid: 5900, amount_due: 5900, created: 1790000000,
      status_transitions: { paid_at: 1790001000 },
      hosted_invoice_url: 'https://stripe/i',
      lines: { data: [{ price: { lookup_key: 'palova_t2_month' }, period: { start: 1789000000, end: 1791000000 } }] },
    });
    expect(f).toMatchObject({
      stripeInvoiceId: 'in_1', amountCents: 5900, currency: 'eur', status: 'paid',
      tier: 2, interval: 'month',
      periodStart: new Date(1789000000 * 1000), periodEnd: new Date(1791000000 * 1000),
      paidAt: new Date(1790001000 * 1000), hostedInvoiceUrl: 'https://stripe/i',
      createdAt: new Date(1790000000 * 1000),
    });
  });

  it('forme Basil : pas de lookup_key sur la ligne → tier/interval null', () => {
    const f = invoiceFields({
      id: 'in_2', status: 'paid', amount_paid: 9900, amount_due: 9900, created: 1790000000,
      lines: { data: [{ period: { start: 1789000000, end: 1791000000 } }] },
    });
    expect(f.tier).toBeNull();
    expect(f.interval).toBeNull();
    expect(f.amountCents).toBe(9900);
  });

  it('override failed : statut forcé, amount_due, pas de paidAt', () => {
    const f = invoiceFields({ id: 'in_3', status: 'open', amount_due: 5900, amount_paid: 0, created: 1 }, 'failed');
    expect(f.status).toBe('failed');
    expect(f.amountCents).toBe(5900);
    expect(f.paidAt).toBeNull();
  });

  it('non payée sans override : montant = amount_due, statut brut', () => {
    const f = invoiceFields({ id: 'in_4', status: 'open', amount_due: 2900, amount_paid: 0, created: 1 });
    expect(f.status).toBe('open');
    expect(f.amountCents).toBe(2900);
  });
});

describe('upsertInvoice', () => {
  const inv = {
    id: 'in_1', status: 'paid', customer: 'cus_1', amount_paid: 5900, created: 1790000000,
    lines: { data: [{ price: { lookup_key: 'palova_t2_month' } }] },
  } as StripeInvoiceLike;

  it('résout le club par customer et upsert par stripeInvoiceId', async () => {
    prismaMock.club.findFirst.mockResolvedValue({ id: 'club-1' } as any);
    prismaMock.platformInvoice.upsert.mockResolvedValue({} as any);
    await upsertInvoice(inv, 'paid');
    expect(prismaMock.platformInvoice.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { stripeInvoiceId: 'in_1' },
    }));
    const arg = prismaMock.platformInvoice.upsert.mock.calls[0][0] as any;
    expect(arg.create).toMatchObject({ clubId: 'club-1', amountCents: 5900, tier: 2, status: 'paid' });
  });

  it('skip silencieux si le customer est inconnu', async () => {
    prismaMock.club.findFirst.mockResolvedValue(null as any);
    await upsertInvoice(inv, 'paid');
    expect(prismaMock.platformInvoice.upsert).not.toHaveBeenCalled();
  });

  it('skip si pas de customer sur la facture', async () => {
    await upsertInvoice({ id: 'in_x', status: 'paid', created: 1 } as StripeInvoiceLike);
    expect(prismaMock.club.findFirst).not.toHaveBeenCalled();
  });

  it('repli tier/interval via PlatformSubscription quand le lookup_key manque (Basil)', async () => {
    prismaMock.club.findFirst.mockResolvedValue({ id: 'club-1' } as any);
    prismaMock.platformSubscription.findUnique.mockResolvedValue({ tier: 3, interval: 'year' } as any);
    prismaMock.platformInvoice.upsert.mockResolvedValue({} as any);
    await upsertInvoice({
      id: 'in_5', status: 'paid', customer: 'cus_1', amount_paid: 9900, created: 1,
      lines: { data: [{ period: { start: 1, end: 2 } }] },
    } as StripeInvoiceLike, 'paid');
    const arg = prismaMock.platformInvoice.upsert.mock.calls[0][0] as any;
    expect(arg.create).toMatchObject({ tier: 3, interval: 'year' });
  });
});

describe('syncAllInvoices', () => {
  it('pagine has_more et compte les factures importées', async () => {
    prismaMock.club.findMany.mockResolvedValue([
      { id: 'club-1', platformCustomerId: 'cus_1', slug: 'c1' },
    ] as any);
    prismaMock.platformInvoice.upsert.mockResolvedValue({} as any);
    stripeMock.invoices.list
      .mockResolvedValueOnce({ data: [{ id: 'in_1', created: 1 }, { id: 'in_2', created: 2 }], has_more: true })
      .mockResolvedValueOnce({ data: [{ id: 'in_3', created: 3 }], has_more: false });

    const out = await syncAllInvoices();
    expect(out).toEqual({ clubs: 1, imported: 3 });
    expect(stripeMock.invoices.list).toHaveBeenNthCalledWith(2, expect.objectContaining({ starting_after: 'in_2' }));
  });

  it('un club en échec n arrête pas la boucle', async () => {
    prismaMock.club.findMany.mockResolvedValue([
      { id: 'club-1', platformCustomerId: 'cus_1', slug: 'c1' },
      { id: 'club-2', platformCustomerId: 'cus_2', slug: 'c2' },
    ] as any);
    prismaMock.platformInvoice.upsert.mockResolvedValue({} as any);
    stripeMock.invoices.list
      .mockRejectedValueOnce(new Error('stripe down'))
      .mockResolvedValueOnce({ data: [{ id: 'in_1', created: 1 }], has_more: false });
    const out = await syncAllInvoices();
    expect(out).toEqual({ clubs: 2, imported: 1 });
  });
});
