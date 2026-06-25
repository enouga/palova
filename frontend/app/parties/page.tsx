'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { clubHasPadel } from '@/lib/sport';
import { OpenMatches } from '@/components/openmatch/OpenMatches';

// /parties = découverte des parties ouvertes du club (réservé aux membres).
// Padel uniquement : un club sans padel n'a pas d'onglet Parties ; un accès direct
// (bookmark / lien profond) est redirigé vers l'accueil du club.
export default function PartiesPage() {
  const { club, loading } = useClub();
  const { th } = useTheme();
  const router = useRouter();

  const noPadel = !!club && !clubHasPadel(club);
  useEffect(() => { if (noPadel) router.replace('/'); }, [noPadel, router]);

  if (loading) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>;
  if (!club) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textMute }}>Club introuvable.</div>;
  if (noPadel) return <div style={{ minHeight: '100vh', background: th.bg }} />;
  return <OpenMatches club={club} />;
}
