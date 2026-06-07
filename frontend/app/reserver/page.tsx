'use client';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { ClubReserve } from '@/components/ClubReserve';

// /reserver = même expérience que la racine du club (cf. components/ClubReserve).
// Conservé comme route pour les liens existants (dont /reserver?tab=courts).
export default function ReserverPage() {
  const { club, loading } = useClub();
  const { th } = useTheme();
  if (loading) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>;
  if (!club) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textMute }}>Club introuvable.</div>;
  return <ClubReserve club={club} />;
}
