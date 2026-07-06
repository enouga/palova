import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { OnboardingService } from '../onboarding.service';

describe('OnboardingService.getStatus', () => {
  let service: OnboardingService;
  beforeEach(() => { service = new OnboardingService(); });

  const mockCounts = (c: {
    sports?: number; resources?: number; photos?: number;
    templates?: number; plans?: number; tournaments?: number; events?: number;
  }) => {
    prismaMock.clubSport.count.mockResolvedValue(c.sports ?? 0);
    prismaMock.resource.count.mockResolvedValue(c.resources ?? 0);
    prismaMock.clubPhoto.count.mockResolvedValue(c.photos ?? 0);
    prismaMock.packageTemplate.count.mockResolvedValue(c.templates ?? 0);
    prismaMock.subscriptionPlan.count.mockResolvedValue(c.plans ?? 0);
    prismaMock.tournament.count.mockResolvedValue(c.tournaments ?? 0);
    prismaMock.clubEvent.count.mockResolvedValue(c.events ?? 0);
  };

  it('club nu : tout à faux/zéro', async () => {
    prismaMock.club.findUnique.mockResolvedValue({
      logoUrl: null, presentationText: null, stripeAccountStatus: 'NONE',
    } as any);
    mockCounts({});
    const s = await service.getStatus('c1');
    expect(s).toEqual({
      hasLogo: false, sportsCount: 0, resourcesCount: 0,
      hasPresentation: false, stripeStatus: 'NONE', offersCount: 0, eventsCount: 0,
    });
  });

  it('club configuré : dérive logo, présentation (texte OU photos), offres et events cumulés', async () => {
    prismaMock.club.findUnique.mockResolvedValue({
      logoUrl: '/uploads/logo.png', presentationText: '  ', stripeAccountStatus: 'ACTIVE',
    } as any);
    mockCounts({ sports: 2, resources: 4, photos: 3, templates: 1, plans: 2, tournaments: 1, events: 1 });
    const s = await service.getStatus('c1');
    expect(s.hasLogo).toBe(true);
    // presentationText blanc mais 3 photos → présentation considérée faite
    expect(s.hasPresentation).toBe(true);
    expect(s.sportsCount).toBe(2);
    expect(s.resourcesCount).toBe(4);
    expect(s.stripeStatus).toBe('ACTIVE');
    expect(s.offersCount).toBe(3);   // templates + plans
    expect(s.eventsCount).toBe(2);   // tournois + events
    // seules les ressources actives et les offres actives comptent
    expect(prismaMock.resource.count).toHaveBeenCalledWith({ where: { clubId: 'c1', isActive: true } });
    expect(prismaMock.packageTemplate.count).toHaveBeenCalledWith({ where: { clubId: 'c1', isActive: true } });
    expect(prismaMock.subscriptionPlan.count).toHaveBeenCalledWith({ where: { clubId: 'c1', isActive: true } });
  });

  it('presentationText non vide suffit sans photo', async () => {
    prismaMock.club.findUnique.mockResolvedValue({
      logoUrl: null, presentationText: 'Bienvenue', stripeAccountStatus: 'PENDING',
    } as any);
    mockCounts({});
    const s = await service.getStatus('c1');
    expect(s.hasPresentation).toBe(true);
    expect(s.stripeStatus).toBe('PENDING');
  });

  it('club inconnu → CLUB_NOT_FOUND', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(service.getStatus('nope')).rejects.toThrow('CLUB_NOT_FOUND');
  });
});
