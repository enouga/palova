import { ContentShell } from '@/components/content/ContentShell';
import { ClubPageView } from '@/components/content/ClubPageView';
import { PLATFORM_CGV } from '@/lib/platformContent';

export default function CgvPage() {
  return (
    <ContentShell>
      <ClubPageView pageKind="CGV" platformBody={PLATFORM_CGV} />
    </ContentShell>
  );
}
