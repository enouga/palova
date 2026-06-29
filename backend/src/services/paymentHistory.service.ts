import { DateTime } from 'luxon';
import { prisma } from '../db/prisma';

const cents = (v: unknown): number => Math.round(Number(v ?? 0) * 100);

export interface MyPayment {
  id: string;
  date: string;          // ISO
  amountCents: number;
  refundedCents: number;
  method: string;
  status: string;
  label: string;
}

/** Historique des paiements d'un joueur sur un club. Attribution multi-source (cf. MemberStatsService). */
export class PaymentHistoryService {
  async listMyPaymentsBySlug(slug: string, userId: string): Promise<MyPayment[]> {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true, timezone: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const clubId = club.id;
    const tz = club.timezone;

    const payments = await prisma.payment.findMany({
      where: {
        OR: [
          { reservation: { is: { userId, resource: { clubId } } }, participantId: null },
          { participant: { is: { userId, reservation: { resource: { clubId } } } } },
          { memberPackage: { is: { userId, clubId } } },
          { sourcePackage: { is: { userId, clubId } } },
          { subscriptionSale: { is: { userId, clubId } } },
          { sourceSubscription: { is: { userId, clubId } } },
          { tournamentRegistration: { is: { captainUserId: userId, tournament: { clubId } } } },
          { eventRegistration: { is: { userId, event: { clubId } } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, amount: true, refundedAmount: true, method: true, status: true, createdAt: true,
        reservation: { select: { startTime: true, resource: { select: { name: true } } } },
        memberPackage: { select: { template: { select: { name: true } } } },
        sourcePackage: { select: { template: { select: { name: true } } } },
        subscriptionSale: { select: { plan: { select: { name: true } } } },
        tournamentRegistration: { select: { tournament: { select: { name: true } } } },
        eventRegistration: { select: { event: { select: { name: true } } } },
      },
    });

    const shortDate = (d: Date) => DateTime.fromJSDate(d).setZone(tz).toFormat('dd/MM/yyyy');

    return payments.map((p) => ({
      id: p.id,
      date: p.createdAt.toISOString(),
      amountCents: cents(p.amount),
      refundedCents: cents(p.refundedAmount),
      method: p.method,
      status: p.status,
      label: this.label(p, shortDate),
    }));
  }

  // Priorité de libellé : réservation > vente carnet > vente abo > inscription > consommation carnet.
  private label(p: {
    reservation: { startTime: Date; resource: { name: string } } | null;
    memberPackage: { template: { name: string } } | null;
    sourcePackage: { template: { name: string } } | null;
    subscriptionSale: { plan: { name: string } } | null;
    tournamentRegistration: { tournament: { name: string } } | null;
    eventRegistration: { event: { name: string } } | null;
  }, shortDate: (d: Date) => string): string {
    if (p.reservation) return `Réservation ${p.reservation.resource.name} · ${shortDate(p.reservation.startTime)}`;
    if (p.memberPackage) return `Achat — ${p.memberPackage.template.name}`;
    if (p.subscriptionSale) return `Abonnement — ${p.subscriptionSale.plan.name}`;
    if (p.tournamentRegistration) return `Inscription — ${p.tournamentRegistration.tournament.name}`;
    if (p.eventRegistration) return `Inscription — ${p.eventRegistration.event.name}`;
    if (p.sourcePackage) return `Conso. — ${p.sourcePackage.template.name}`;
    return 'Paiement';
  }
}
