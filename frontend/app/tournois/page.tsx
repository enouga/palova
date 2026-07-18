'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useClub } from '@/lib/ClubProvider';
import { Screen } from '@/components/ui/Screen';
import { Logotype, ThemeToggle, BackButton } from '@/components/ui/atoms';
import { TournamentFinder } from '@/components/calendar/TournamentFinder';

// L'hôte est décidé par `slug` (posé par le layout depuis x-club-slug) : null = plateforme.
// Hôte plateforme → calendrier national public. Hôte club → /tournois est devenu /events.
export default function TournoisPage() {
  const { slug } = useClub();
  const router = useRouter();

  useEffect(() => {
    if (slug) router.replace('/events?filtre=competitions');
  }, [slug, router]);

  if (slug) return null;            // hôte club : redirection en cours vers /events
  return (
    <Screen>
      {/* Même chrome que /tarifs (logo + retour Accueil), sans le plafond 800px de ContentShell
          — le Finder (facettes + grille) a besoin de la largeur 1080 de Screen. */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 4px' }}>
        <Logotype size={22} />
        <ThemeToggle />
      </header>
      <div style={{ padding: '6px 20px 0' }}>
        <BackButton href="/" label="Accueil" />
      </div>
      <TournamentFinder />
    </Screen>
  );
}
