'use client';
import { UserLevel } from '@/lib/api';
import { useLevelSystemEnabled } from '@/lib/useLevelSystem';
import { useTheme } from '@/lib/ThemeProvider';

// Pastille niveau compacte : « 4.2 » + point orange si provisoire. null → rien.
export function LevelChip({ level, size = 'sm' }: { level: UserLevel | null | undefined; size?: 'xs' | 'sm' }) {
  const enabled = useLevelSystemEnabled();
  // Hooks toujours appelés avant le return conditionnel (le niveau peut arriver en
  // asynchrone sur une même instance — l'ordre des hooks ne doit pas en dépendre).
  const { th } = useTheme();
  if (!enabled || !level) return null;
  const pad = size === 'xs' ? '1px 5px' : '2px 7px';
  const fs = size === 'xs' ? 10 : 11;
  return (
    <span title={`${level.tier} · Fiabilité ${Math.round(level.reliability)} %${level.isProvisional ? ' · en calibrage' : ''}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, borderRadius: 999, padding: pad, fontSize: fs, fontWeight: 700, background: th.surface2, lineHeight: 1.2 }}>
      {level.level.toFixed(1)}
      {level.isProvisional && <span style={{ width: 5, height: 5, borderRadius: 999, background: th.warning }} />}
    </span>
  );
}
