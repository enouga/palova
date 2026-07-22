'use client';
import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { api, MyRating, PlayerMembership } from '@/lib/api';
import { clubUrl } from '@/lib/clubUrl';
import { inkOn } from '@/lib/theme';
import { ratingToLevel } from '@/lib/monPalova';
import { SectionHeader } from '@/components/platform/home/SectionHeader';

// « Mon niveau » (padel, global) : médaillon + palier + volume de matchs + lien vers la
// courbe du profil. Section absente tant qu'aucun niveau n'existe. Le lien pointe vers le
// PREMIER club actif (pas la plateforme) : /me/profile?tab=niveau y affiche en plus les
// résultats club-scopés (ClubMatchStats), silencieusement absents sans contexte de club.
export function LevelCard({ token, memberships }: { token: string; memberships: PlayerMembership[] }) {
  const { th } = useTheme();
  const [rating, setRating] = useState<MyRating | null>(null);
  useEffect(() => {
    api.getMyRating(token, 'padel').then(setRating).catch(() => setRating(null));
  }, [token]);
  const level = ratingToLevel(rating);
  if (!level) return null;
  const n = rating!.matchesPlayed;
  const firstClubSlug = memberships.find((m) => m.status === 'ACTIVE')?.slug ?? null;
  const progressHref = firstClubSlug ? clubUrl(firstClubSlug, '/me/profile?tab=niveau') : '/me/profile?tab=niveau';
  return (
    <section>
      <SectionHeader kicker="Mon niveau" />
      <div style={{ background: th.surface, borderRadius: 16, padding: 14, boxShadow: th.shadow, display: 'flex', alignItems: 'center', gap: 13 }}>
        <span style={{ flexShrink: 0, width: 54, height: 54, borderRadius: '50%', background: th.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, fontWeight: 800, fontSize: 19, color: inkOn(th.accent) }}>
          {level.level.toFixed(1)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>
            {level.tier}{level.isProvisional && <span style={{ color: th.textMute, fontWeight: 600 }}> · en calibrage</span>}
          </div>
          <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 2 }}>{n} match{n > 1 ? 's' : ''} joué{n > 1 ? 's' : ''}</div>
        </div>
        <a href={progressHref} style={{ flexShrink: 0, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.textMute, textDecoration: 'underline', textUnderlineOffset: 3 }}>Ma progression →</a>
      </div>
    </section>
  );
}
