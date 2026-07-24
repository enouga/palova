import type { Metadata } from 'next';
import { MonPalova } from '@/components/legacy/MonPalova';
import { ArchiveBanner } from '@/components/legacy/ArchiveBanner';

// Copie figée de « Mon Palova », l'accueil CONNECTÉ d'avant la fusion des trois surfaces.
// ⚠️ `MonPalova` ne rend rien sans session (il était gardé par `PlatformLanding`) : cette
// page n'a d'intérêt qu'ouverte connecté. Voir `accueil-visiteur/page.tsx` pour le reste.
export const metadata: Metadata = {
  title: 'Archive — accueil connecté',
  robots: { index: false, follow: false },
};

export default function ArchiveAccueilConnectePage() {
  return (
    <>
      <MonPalova />
      <ArchiveBanner label="accueil connecté (avant fusion)" />
    </>
  );
}
