import { ContentShell } from '@/components/content/ContentShell';
import { Markdown } from '@/components/ui/Markdown';
import { PLATFORM_CGU } from '@/lib/platformContent';

// CGU de la plateforme : identiques sur l'hôte plateforme et les sous-domaines club
// (le joueur d'un club est aussi utilisateur de Palova).
export default function CguPage() {
  return (
    <ContentShell>
      <Markdown>{PLATFORM_CGU}</Markdown>
    </ContentShell>
  );
}
