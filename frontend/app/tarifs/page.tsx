import { ContentShell } from '@/components/content/ContentShell';
import { Markdown } from '@/components/ui/Markdown';
import { PLATFORM_TARIFS } from '@/lib/platformContent';

// Tarifs Palova (B2B) — toujours le contenu plateforme, y compris depuis un club.
export default function TarifsPage() {
  return (
    <ContentShell>
      <Markdown>{PLATFORM_TARIFS}</Markdown>
    </ContentShell>
  );
}
