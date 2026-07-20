import type { Metadata } from 'next';
import { platformTitle } from '@/lib/seo';
import { ContentShell } from '@/components/content/ContentShell';
import { PricingContent } from '@/components/platform/PricingContent';

export const metadata: Metadata = {
  title: platformTitle('Tarifs'),
  description: 'Palova est gratuit jusqu’à 50 membres actifs, puis un tarif simple au palier — sans engagement.',
};

// Tarifs Palova (B2B) — toujours le contenu plateforme, y compris depuis un club.
// (/offres rend le même PricingContent sur l'hôte plateforme ; sur un club, sa page « Nos offres ».)
export default function TarifsPage() {
  return (
    <ContentShell>
      <PricingContent />
    </ContentShell>
  );
}
