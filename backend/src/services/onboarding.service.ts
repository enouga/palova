import { prisma } from '../db/prisma';

/**
 * Statut d'avancement du paramétrage d'un club, dérivé de l'état réel.
 * Rien n'est stocké : la checklist du dashboard se coche toute seule.
 */
export class OnboardingService {
  async getStatus(clubId: string) {
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: {
        logoUrl: true, presentationText: true, stripeAccountStatus: true,
        legalEntityName: true, siret: true, legalEmail: true, mediatorName: true,
      },
    });
    if (!club) throw new Error('CLUB_NOT_FOUND');

    const [sportsCount, resourcesCount, photosCount, templatesCount, plansCount, tournamentsCount, clubEventsCount] = await Promise.all([
      prisma.clubSport.count({ where: { clubId } }),
      prisma.resource.count({ where: { clubId, isActive: true } }),
      prisma.clubPhoto.count({ where: { clubId } }),
      prisma.packageTemplate.count({ where: { clubId, isActive: true } }),
      prisma.subscriptionPlan.count({ where: { clubId, isActive: true } }),
      prisma.tournament.count({ where: { clubId } }),
      prisma.clubEvent.count({ where: { clubId } }),
    ]);

    return {
      hasLogo: !!club.logoUrl,
      sportsCount,
      resourcesCount,
      hasPresentation: (club.presentationText ?? '').trim().length > 0 || photosCount > 0,
      stripeStatus: club.stripeAccountStatus,
      offersCount: templatesCount + plansCount,
      eventsCount: tournamentsCount + clubEventsCount,
      hasLegalInfo: [club.legalEntityName, club.siret, club.legalEmail, club.mediatorName]
        .every((v) => (v ?? '').trim().length > 0),
    };
  }
}
