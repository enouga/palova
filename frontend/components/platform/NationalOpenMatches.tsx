'use client';
import { NationalOpenMatch } from '@/lib/api';
import { OpenMatchRailCard } from '@/components/match/OpenMatchRailCard';
import { clubUrl } from '@/lib/clubUrl';
import { AgendaRail } from '@/components/agenda/AgendaRail';

// Rail vedette de la vitrine palova.fr : les parties ouvertes publiques de tous les clubs,
// en grandes cartes (pattern OpenMatchesShowcase du club-house) enrichies de l'identité du
// club, sur le rail d'agenda partagé (mobile : une carte pleine + liseré, points de
// pagination ; desktop : étagère + flèches). Clic → la page partageable /parties/[id] sur le
// sous-domaine du club (le visiteur y retrouve le parcours rejoindre + invite de connexion).
// Vide → rien rendu. Pas d'en-tête propre — ses 2 appelants (HomeMatchesRail, AnonymousView)
// ont chacun le leur, différent — donc le compteur de résultats est porté par `AgendaRail`.
export function NationalOpenMatches({ matches }: { matches: NationalOpenMatch[] }) {
  if (matches.length === 0) return null;
  const count = `${matches.length} partie${matches.length > 1 ? 's' : ''}`;
  return (
    <AgendaRail countLabel={count} desktopColumns="272px" mobileColumns="272px" desktopRows={1}
      prevLabel="Parties précédentes" nextLabel="Parties suivantes">
      {matches.map((m) => (
        <OpenMatchRailCard key={m.id} match={m} club={m.club} timezone={m.club.timezone}
          href={clubUrl(m.club.slug, `/parties/${m.id}`)} />
      ))}
    </AgendaRail>
  );
}
