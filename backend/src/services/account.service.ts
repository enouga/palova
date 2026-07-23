import bcrypt from 'bcrypt';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { prisma } from '../db/prisma';
import { ReservationService } from './reservation.service';
import { invalidateAuthIdentity } from '../middleware/authCache';
import { AVATARS_DIR } from '../utils/uploads';

export interface AccountDeletionSummary {
  blockingClubs: string[];      // clubs où je suis l'unique OWNER → suppression bloquée
  futureReservations: number;
  activeSubscriptions: number;
  balances: string[];           // libellés des soldes non nuls (avertissement « perdu »)
}

export class AccountService {
  private reservations = new ReservationService();

  /** Clubs où l'utilisateur est l'unique OWNER (suppression interdite tant qu'il reste). */
  private async soleOwnerClubs(userId: string): Promise<string[]> {
    const ownerRoles = await prisma.clubMember.findMany({
      where: { userId, role: 'OWNER' },
      select: { clubId: true, club: { select: { name: true } } },
    });
    const blocking: string[] = [];
    for (const r of ownerRoles) {
      const owners = await prisma.clubMember.count({ where: { clubId: r.clubId, role: 'OWNER' } });
      if (owners <= 1) blocking.push(r.club.name);
    }
    return blocking;
  }

  async getDeletionSummary(userId: string): Promise<AccountDeletionSummary> {
    const [blockingClubs, futureReservations, activeSubscriptions, packages] = await Promise.all([
      this.soleOwnerClubs(userId),
      prisma.reservation.count({ where: { userId, status: { in: ['CONFIRMED', 'PENDING'] }, startTime: { gt: new Date() } } }),
      prisma.subscription.count({ where: { userId, status: 'ACTIVE', expiresAt: { gt: new Date() } } }),
      prisma.memberPackage.findMany({
        where: { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        select: { kind: true, creditsRemaining: true, amountRemaining: true, template: { select: { name: true } } },
      }),
    ]);
    const balances = packages
      .filter((p) => (p.creditsRemaining ?? 0) > 0 || Number(p.amountRemaining ?? 0) > 0)
      .map((p) => p.kind === 'ENTRIES'
        ? `${p.template.name} — ${p.creditsRemaining} entrée(s)`
        : `${p.template.name} — ${Number(p.amountRemaining ?? 0).toFixed(2).replace('.', ',')} €`);
    return { blockingClubs, futureReservations, activeSubscriptions, balances };
  }

  /** Anonymise le compte. Vérifie le mot de passe, bloque si unique OWNER, annule les résas futures. */
  async deleteAccount(userId: string, password: string): Promise<{ ok: true }> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, password: true, avatarUrl: true } });
    if (!user || !(await bcrypt.compare(password, user.password))) throw new Error('INVALID_PASSWORD');

    const blocking = await this.soleOwnerClubs(userId);
    if (blocking.length) throw Object.assign(new Error('OWNS_CLUB'), { clubs: blocking });

    // Annulation hors transaction (libère verrous Redis + SSE), avant le scrub atomique.
    await this.reservations.cancelFutureReservationsForUser(userId);

    const randomPassword = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          firstName: 'Joueur', lastName: 'supprimé',
          email: `deleted-${userId}@deleted.palova.invalid`,
          phone: null, avatarUrl: null, birthDate: null, sex: null, locale: null,
          address: null, postalCode: null, city: null,
          password: randomPassword, isSuperAdmin: false, deletedAt: new Date(),
        },
      });
      await tx.pushSubscription.deleteMany({ where: { userId } });
    });

    // Tout token existant doit être refusé immédiatement (deletedAt posé),
    // sans attendre l'expiration du cache d'identité du middleware.
    invalidateAuthIdentity(userId);

    // Nettoyage best-effort du fichier avatar (hors transaction).
    if (user.avatarUrl?.startsWith('/uploads/avatars/')) {
      fs.promises.unlink(path.join(AVATARS_DIR, path.basename(user.avatarUrl))).catch(() => {});
    }
    return { ok: true };
  }
}
