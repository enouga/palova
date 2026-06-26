'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useClub } from '@/lib/ClubProvider';
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
  return <TournamentFinder />;      // hôte plateforme (slug === null)
}
