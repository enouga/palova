import { api, ClubDetail } from '@/lib/api';
import { CourtsView, ResourceCard } from './CourtsView';

// Lot 1 : club unique en dur (slug). L'annuaire multi-clubs arrive au Lot 3.
const CLUB_SLUG = 'padel-arena-paris';

export default async function CourtsPage() {
  let club: ClubDetail;
  try {
    club = await api.getClub(CLUB_SLUG);
  } catch {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <p style={{ fontFamily: 'var(--font-ui), sans-serif', color: '#ff7a4d' }}>
          Impossible de charger le club.
        </p>
      </main>
    );
  }

  const resources: ResourceCard[] = club.clubSports.flatMap((cs) =>
    cs.resources.map((r) => ({
      id: r.id,
      name: r.name,
      surface: typeof r.attributes?.surface === 'string' ? r.attributes.surface : undefined,
      pricePerHour: r.pricePerHour,
      openHour: r.openHour,
      closeHour: r.closeHour,
      sportName: cs.sport.name,
    })),
  );

  return <CourtsView resources={resources} clubName={club.name} />;
}
