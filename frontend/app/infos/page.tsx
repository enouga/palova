'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Screen } from '@/components/ui/Screen';
import { ClubNav } from '@/components/ClubNav';
import { ClubInfo } from '@/components/ClubInfo';

// Page « Infos club » (annonces, prochaines réservations, partenaires).
// Réservée au contexte club : sur l'hôte plateforme (pas de slug) → retour à l'annuaire.
export default function InfosPage() {
  const { slug, club, loading } = useClub();
  const { th } = useTheme();
  const router = useRouter();

  useEffect(() => { if (!slug) router.replace('/clubs'); }, [slug, router]);

  if (!slug || loading) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>;
  if (!club) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textMute }}>Club introuvable.</div>;

  return (
    <Screen style={{ maxWidth: 760 }}>
      <div style={{ paddingBottom: 40 }}>
        <ClubNav club={club} />
        <ClubInfo club={club} />
      </div>
    </Screen>
  );
}
