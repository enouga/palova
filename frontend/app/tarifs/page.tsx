import { ContentShell } from '@/components/content/ContentShell';
import { PricingContent } from '@/components/platform/PricingContent';

// Tarifs Palova (B2B) — toujours le contenu plateforme, y compris depuis un club.
// (PLATFORM_TARIFS, la version markdown, reste le repli de /offres sur l'hôte plateforme.)
export default function TarifsPage() {
  return (
    <ContentShell>
      <PricingContent />
    </ContentShell>
  );
}
