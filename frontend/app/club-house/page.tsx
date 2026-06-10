'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Screen } from '@/components/ui/Screen';
import { ClubNav } from '@/components/ClubNav';
import { ClubHouse } from '@/components/ClubHouse';

// Page « Club-house » (à la une, créneaux à saisir, tournois, annonces, offres partenaires).
// Réservée au contexte club : sur l'hôte plateforme (pas de slug) → retour à l'annuaire.
export default function ClubHousePage() {
  const { slug, club, loading } = useClub();
  const { th } = useTheme();
  const router = useRouter();

  useEffect(() => { if (!slug) router.replace('/clubs'); }, [slug, router]);

  if (!slug || loading) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>;
  if (!club) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textMute }}>Club introuvable.</div>;

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        <ClubNav club={club} />
        <ClubHouse club={club} />
      </div>
    </Screen>
  );
}
