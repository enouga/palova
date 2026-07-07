import { ContentShell } from '@/components/content/ContentShell';
import { PricingContent } from '@/components/platform/PricingContent';

// Tarifs Palova (B2B) — toujours le contenu plateforme, y compris depuis un club.
// (/offres rend le même PricingContent sur l'hôte plateforme ; sur un club, sa page « Nos offres ».)
export default function TarifsPage() {
  return (
    <ContentShell>
      <PricingContent />
    </ContentShell>
  );
}
