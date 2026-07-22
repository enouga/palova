'use client';
import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { api, MyRating } from '@/lib/api';
import { LevelChip } from '@/components/player/LevelChip';
import { ratingToLevel } from '@/lib/monPalova';
import { SectionHeader } from '@/components/platform/home/SectionHeader';

// « Mon niveau » (padel, global) : pastille + volume de matchs + lien vers la courbe du profil.
// Section absente tant qu'aucun niveau n'existe.
export function LevelCard({ token }: { token: string }) {
  const { th } = useTheme();
  const [rating, setRating] = useState<MyRating | null>(null);
  useEffect(() => {
    api.getMyRating(token, 'padel').then(setRating).catch(() => setRating(null));
  }, [token]);
  const level = ratingToLevel(rating);
  if (!level) return null;
  return (
    <section>
      <SectionHeader kicker="Mon niveau" />
      <div style={{ background: th.surface, borderRadius: 14, padding: '11px 13px', boxShadow: `inset 0 0 0 1px ${th.line}`, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <LevelChip level={level} />
        <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>{rating!.matchesPlayed} matchs joués</span>
        <a href="/me/profile?tab=niveau" style={{ marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.textMute, textDecoration: 'underline', textUnderlineOffset: 3 }}>Ma progression →</a>
      </div>
    </section>
  );
}
