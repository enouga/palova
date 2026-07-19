'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// L'annuaire de clubs a été replié dans /decouvrir (onglet « Clubs »).
// On redirige les anciens liens / favoris vers le bon onglet.
export default function ClubsDirectoryRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/decouvrir#clubs'); }, [router]);
  return null;
}
