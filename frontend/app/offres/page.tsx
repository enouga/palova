import { ContentShell } from '@/components/content/ContentShell';
import { ClubPageView } from '@/components/content/ClubPageView';
import { PLATFORM_TARIFS } from '@/lib/platformContent';

// Sur un club : page « Nos offres » du club. Sur la plateforme : repli sur les tarifs Palova.
export default function OffresPage() {
  return (
    <ContentShell>
      <ClubPageView pageKind="OFFRES" platformBody={PLATFORM_TARIFS} />
    </ContentShell>
  );
}
