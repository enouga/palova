'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// « Infos » est devenu « Club-house » — redirection pour les liens existants.
export default function InfosRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/club-house'); }, [router]);
  return null;
}
