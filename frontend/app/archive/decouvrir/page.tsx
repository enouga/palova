import type { Metadata } from 'next';
import { DiscoverClient } from '@/components/legacy/DiscoverClient';
import { ArchiveBanner } from '@/components/legacy/ArchiveBanner';

// Copie figée de la page « Où jouer » (/decouvrir) d'avant la fusion des trois surfaces —
// l'URL /decouvrir redirige désormais vers l'accueil. Voir `accueil-visiteur/page.tsx`.
export const metadata: Metadata = {
  title: 'Archive — Où jouer',
  robots: { index: false, follow: false },
};

export default function ArchiveDecouvrirPage() {
  return (
    <>
      <DiscoverClient />
      <ArchiveBanner label="Où jouer /decouvrir (avant fusion)" />
    </>
  );
}
