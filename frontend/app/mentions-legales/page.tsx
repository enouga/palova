import { ContentShell } from '@/components/content/ContentShell';
import { ClubPageView } from '@/components/content/ClubPageView';
import { PLATFORM_MENTIONS } from '@/lib/platformContent';

export default function MentionsLegalesPage() {
  return (
    <ContentShell>
      <ClubPageView pageKind="MENTIONS_LEGALES" platformBody={PLATFORM_MENTIONS} />
    </ContentShell>
  );
}
