'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Le Club-house est devenu la page d'accueil du club (/) — redirection pour les liens existants.
export default function ClubHouseRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/'); }, [router]);
  return null;
}
