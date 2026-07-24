import type { Metadata } from 'next';
import AnonymousView from '@/components/legacy/AnonymousView';
import { ArchiveBanner } from '@/components/legacy/ArchiveBanner';

// Copie figée de l'accueil VISITEUR d'avant la fusion des trois surfaces (spec « Accueil
// unifié ») — conservée pour comparaison, jamais indexée, absente de la navigation.
// À supprimer avec `components/legacy/` le jour où la comparaison n'a plus d'utilité.
export const metadata: Metadata = {
  title: 'Archive — accueil visiteur',
  robots: { index: false, follow: false },
};

export default function ArchiveAccueilVisiteurPage() {
  return (
    <>
      <AnonymousView />
      <ArchiveBanner label="accueil visiteur (avant fusion)" />
    </>
  );
}
