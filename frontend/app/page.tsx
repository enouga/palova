'use client';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import PlatformLanding from '@/components/PlatformLanding';
import { ClubReserve } from '@/components/ClubReserve';

export default function HomePage() {
  const { slug, club, loading } = useClub();
  const { th } = useTheme();
  // Plateforme (palova.fr) → accueil adaptatif ; sous-domaine club → réservation directe.
  if (!slug) return <PlatformLanding />;
  if (loading) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>;
  if (!club) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textMute }}>Club introuvable.</div>;
  return <ClubReserve club={club} />;
}
