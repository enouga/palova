'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { winRate } from '@/lib/memberStats';

// Rangée de stats de résultat (V/D · taux · série). Présentation pure, réutilisée par
// le classement (tone 'onAccent', sur fond accent) et le profil (tone 'onSurface').
export function ResultStats({ wins, losses, streak, tone }: { wins: number; losses: number; streak: number; tone: 'onAccent' | 'onSurface' }) {
  const { th } = useTheme();
  const decided = wins + losses;
  if (decided === 0) return null;
  const rate = winRate(wins, losses) ?? 0;
  const streakN = Math.abs(streak);
  const streakWin = streak > 0;
  const onAccent = tone === 'onAccent';
  const pillBg = streakWin ? (onAccent ? th.onAccent : th.accent) : ACCENTS.coral;
  const pillFg = streakWin ? (onAccent ? th.accent : th.onAccent) : '#fff';
  return (
    <div style={{
      ...(onAccent ? { borderTop: `1px solid ${th.onAccent}33`, paddingTop: 10 } : {}),
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px',
      fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: onAccent ? th.onAccent : th.text,
    }}>
      <span>{decided} match{decided > 1 ? 's' : ''}</span>
      <span>{rate}% de victoires</span>
      <span>{wins} V · {losses} D</span>
      {streakN > 0 && (
        <span style={{ borderRadius: 999, padding: '2px 9px', fontSize: 12.5, fontWeight: 700, background: pillBg, color: pillFg }}>
          {streakN} {streakWin ? 'victoire' : 'défaite'}{streakN > 1 ? 's' : ''} d&apos;affilée
        </span>
      )}
    </div>
  );
}
