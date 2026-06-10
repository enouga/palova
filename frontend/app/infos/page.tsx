'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// « Infos » est devenu « Club-house », désormais page d'accueil du club (/) — redirection pour les liens existants.
export default function InfosRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/'); }, [router]);
  return null;
}
