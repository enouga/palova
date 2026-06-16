import { ContentShell } from '@/components/content/ContentShell';
import { ClubPageView } from '@/components/content/ClubPageView';
import { PLATFORM_CONFIDENTIALITE } from '@/lib/platformContent';

export default function ConfidentialitePage() {
  return (
    <ContentShell>
      <ClubPageView pageKind="CONFIDENTIALITE" platformBody={PLATFORM_CONFIDENTIALITE} />
    </ContentShell>
  );
}
