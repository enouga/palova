import type { PrismaClient } from '@prisma/client';

/**
 * Offres prépayées « carte digitale » créées par défaut sur chaque club de test.
 *
 * Modèle = porte-monnaie (WALLET) : le joueur paie `price` € et reçoit
 * `walletAmount` crédits (1 crédit = 1 €), qu'il dépense au prix du créneau
 * lors de la réservation. La remise est implicite (price < walletAmount).
 *
 * Le modèle PackageTemplate ne porte ni sport, ni type de terrain, ni plage
 * d'heures : ces infos restent dans le NOM de l'offre (« Carte Padel… »).
 *
 * Partagé par seed.ts et seed-demo.ts — y ajouter une offre la propage partout.
 */
export const DEFAULT_PACKAGE_OFFERS: Array<{
  name: string; price: number; walletAmount: number; validityDays: number;
}> = [
  // Padel — partie de 1h30, plein tarif ≈ 13 € la partie.
  { name: 'Carte Padel 10 parties',  price: 117, walletAmount: 130, validityDays: 180 }, // -10 %, valable 6 mois
  { name: 'Carte Padel 25 parties',  price: 276, walletAmount: 325, validityDays: 365 }, // -15 %, valable 12 mois
  // Squash — partie de 45 min, plein tarif ≈ 9 € la partie.
  { name: 'Carte Squash 10 parties', price: 80,  walletAmount: 90,  validityDays: 180 }, // -11 %, valable 6 mois
  { name: 'Carte Squash 25 parties', price: 187, walletAmount: 225, validityDays: 365 }, // -17 %, valable 12 mois
];

/**
 * Crée (ou remet à jour) les offres prépayées par défaut d'un club.
 * Idempotent et SANS suppression : un MemberPackage vendu référence son template
 * en `onDelete: Restrict`, donc on n'efface jamais — on retrouve par (clubId, name).
 */
export async function seedDefaultOffers(prisma: PrismaClient, clubId: string): Promise<number> {
  for (const o of DEFAULT_PACKAGE_OFFERS) {
    const existing = await prisma.packageTemplate.findFirst({ where: { clubId, name: o.name } });
    if (existing) {
      await prisma.packageTemplate.update({
        where: { id: existing.id },
        data: { price: o.price, walletAmount: o.walletAmount, validityDays: o.validityDays, isActive: true },
      });
    } else {
      await prisma.packageTemplate.create({
        data: {
          clubId, kind: 'WALLET', name: o.name,
          price: o.price, walletAmount: o.walletAmount, validityDays: o.validityDays,
        },
      });
    }
  }
  return DEFAULT_PACKAGE_OFFERS.length;
}
