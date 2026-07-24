'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useClub } from '@/lib/ClubProvider';

// L'hôte est décidé par `slug` (posé par le layout depuis x-club-slug) : null = plateforme.
// Hôte plateforme → calendrier national repris dans l'accueil (section « Prochains tournois »).
// Hôte club → /tournois est devenu /events.
export default function TournoisPage() {
  const { slug } = useClub();
  const router = useRouter();

  useEffect(() => {
    router.replace(slug ? '/events?filtre=competitions' : '/#tournois');
  }, [slug, router]);

  return null;
}
