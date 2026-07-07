'use client';
import { ContentShell } from '@/components/content/ContentShell';
import { ClubPageView } from '@/components/content/ClubPageView';
import { PricingContent } from '@/components/platform/PricingContent';
import { useClub } from '@/lib/ClubProvider';

// Sur un club : page « Nos offres » du club (éditée dans /admin/pages).
// Sur la plateforme : tarifs Palova — même contenu riche que /tarifs (une seule source).
export default function OffresPage() {
  const { slug } = useClub();
  return (
    <ContentShell>
      {slug ? <ClubPageView pageKind="OFFRES" platformBody="" /> : <PricingContent />}
    </ContentShell>
  );
}
