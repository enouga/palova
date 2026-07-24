'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// L'annuaire de clubs a été replié dans l'accueil (section « Clubs près de chez vous »).
// On redirige les anciens liens / favoris vers la bonne ancre.
export default function ClubsDirectoryRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/#clubs'); }, [router]);
  return null;
}
