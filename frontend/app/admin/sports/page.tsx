'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// La gestion des sports a été repliée dans Réglages → onglet « Sports ».
// On redirige les anciens liens / favoris vers le bon onglet.
export default function AdminSportsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/admin/settings?tab=sports'); }, [router]);
  return null;
}
