'use client';
import { TopMonthEntry } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { colorForSeed } from '@/lib/playerColors';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';

const MEDALS = ['🥇', '🥈', '🥉'];

// Podium des 3 joueurs du mois (victoires sur matchs confirmés) — masqué sous 3 joueurs.
export function TopOfMonth({ entries }: { entries: TopMonthEntry[] }) {
  const { th } = useTheme();
  if (entries.length < 3) return null;
  return (
    <section style={{ background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <Icon name="trophy" size={15} color={th.accentWarm} />
        <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 12.5, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute }}>Le top du mois</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.slice(0, 3).map((e, i) => (
          <div key={e.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, background: th.surface2, borderRadius: 10, padding: '9px 12px' }}>
            <span aria-hidden="true" style={{ fontSize: 18 }}>{MEDALS[i]}</span>
            <Avatar firstName={e.firstName} lastName={e.lastName} avatarUrl={e.avatarUrl} size={30} color={colorForSeed(e.userId)} />
            <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: th.text }}>{e.firstName} {e.lastName}</span>
            <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.textMute }}>
              {e.wins} victoire{e.wins > 1 ? 's' : ''}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
