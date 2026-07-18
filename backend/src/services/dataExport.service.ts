import { prisma } from '../db/prisma';

/** Export RGPD (portabilité, art. 20) : JSON des données du demandeur, et de lui seul.
 *  Jamais les messages/identités de tiers ; l'avatar est une URL (pas de fichiers). */
export class DataExportService {
  async buildExport(userId: string) {
    const [
      profile, memberships, reservations, participations, tournamentRegs, eventRegs,
      payments, packages, subscriptions, ratings, follows, friendships, alerts,
      dmSent, matchMessages, prefs, acceptances,
    ] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: {
        id: true, email: true, firstName: true, lastName: true, phone: true, sex: true,
        birthDate: true, avatarUrl: true, locale: true, createdAt: true,
        showInLeaderboard: true, autoMatchProposals: true, acceptsFriendRequests: true, acceptsDirectMessages: true,
      } }),
      prisma.clubMembership.findMany({ where: { userId }, select: { clubId: true, status: true, membershipNo: true, createdAt: true } }),
      prisma.reservation.findMany({ where: { userId }, select: { id: true, startTime: true, endTime: true, status: true, totalPrice: true, resource: { select: { name: true } } } }),
      prisma.reservationParticipant.findMany({ where: { userId }, select: { reservationId: true, joinedAt: true, team: true, slot: true } }),
      prisma.tournamentRegistration.findMany({ where: { OR: [{ captainUserId: userId }, { partnerUserId: userId }] }, select: { tournamentId: true, status: true, paymentStatus: true, createdAt: true } }),
      prisma.eventRegistration.findMany({ where: { userId }, select: { eventId: true, status: true, paymentStatus: true, createdAt: true } }),
      prisma.payment.findMany({
        where: { OR: [
          { reservation: { userId } }, { participant: { userId } }, { memberPackage: { userId } },
          { subscriptionSale: { userId } }, { eventRegistration: { userId } },
          { tournamentRegistration: { OR: [{ captainUserId: userId }, { partnerUserId: userId }] } },
        ] },
        select: { id: true, amount: true, method: true, status: true, createdAt: true, receiptNo: true },
      }),
      prisma.memberPackage.findMany({ where: { userId }, select: { clubId: true, kind: true, creditsRemaining: true, amountRemaining: true, expiresAt: true } }),
      prisma.subscription.findMany({ where: { userId }, select: { clubId: true, status: true, expiresAt: true, monthlyPriceSnapshot: true } }),
      prisma.playerRating.findMany({ where: { userId } }),
      prisma.follow.findMany({ where: { followerId: userId }, select: { followingId: true, createdAt: true } }),
      prisma.friendship.findMany({ where: { OR: [{ userAId: userId }, { userBId: userId }] }, select: { status: true, requestedById: true, respondedAt: true } }),
      prisma.matchAlert.findMany({ where: { userId }, select: { clubId: true, windowStart: true, windowEnd: true } }),
      prisma.directMessage.findMany({ where: { authorId: userId }, select: { conversationId: true, body: true, createdAt: true } }),
      prisma.openMatchMessage.findMany({ where: { userId }, select: { reservationId: true, body: true, createdAt: true } }),
      prisma.notificationPreference.findMany({ where: { userId }, select: { category: true, channel: true, enabled: true } }),
      prisma.legalAcceptance.findMany({ where: { userId }, select: { document: true, version: true, context: true, acceptedAt: true } }),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      profile, memberships, reservations, participations,
      tournamentRegistrations: tournamentRegs, eventRegistrations: eventRegs,
      payments, packages, subscriptions, ratings,
      follows, friendships, matchAlerts: alerts,
      messagesSent: { direct: dmSent, openMatch: matchMessages },
      notificationPreferences: prefs, legalAcceptances: acceptances,
    };
  }
}
