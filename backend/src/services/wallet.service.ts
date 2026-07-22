import { prisma } from '../db/prisma';

const WALLET_CLUB_SELECT = { slug: true, name: true, accentColor: true } as const;
type WalletClub = { slug: string; name: string; accentColor: string };

/**
 * Portefeuille cross-club du joueur pour « Mon Palova » : abonnements ACTIFS non expirés
 * + carnets/porte-monnaie utilisables, groupés par club ACTIVE. Miroir cross-club des
 * lectures club-scopées (`listMySubscriptionsBySlug` / `listMyPackagesBySlug`) — mêmes
 * filtres d'utilisabilité, clubs sans rien omis. Lecture seule, aucune migration.
 */
export class WalletService {
  async listMyWallet(userId: string) {
    const now = new Date();
    const [subs, packs] = await Promise.all([
      prisma.subscription.findMany({
        where: { userId, status: 'ACTIVE', expiresAt: { gt: now }, club: { status: 'ACTIVE' } },
        orderBy: { startedAt: 'desc' },
        include: { plan: { select: { name: true } }, club: { select: WALLET_CLUB_SELECT } },
      }),
      prisma.memberPackage.findMany({
        where: {
          userId,
          club: { status: 'ACTIVE' },
          AND: [
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            { OR: [{ creditsRemaining: { gte: 1 } }, { amountRemaining: { gt: 0 } }] },
          ],
        },
        orderBy: { purchasedAt: 'asc' },
        include: { template: { select: { name: true, sportKeys: true } }, club: { select: WALLET_CLUB_SELECT } },
      }),
    ]);

    const byClub = new Map<string, { club: WalletClub; subscriptions: unknown[]; packages: unknown[] }>();
    const bucket = (club: WalletClub) => {
      let b = byClub.get(club.slug);
      if (!b) { b = { club, subscriptions: [], packages: [] }; byClub.set(club.slug, b); }
      return b;
    };
    for (const { club, ...s } of subs) bucket(club).subscriptions.push(s);
    for (const { club, ...p } of packs) bucket(club).packages.push(p);
    return [...byClub.values()];
  }
}

export const walletService = new WalletService();
