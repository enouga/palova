'use client';
import { TopMonthEntry } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { colorForSeed } from '@/lib/playerColors';
import { Avatar } from '@/components/ui/Avatar';
import { SectionHeader, cardStyle } from '@/components/clubhouse/SectionHeader';

const MEDALS = ['🥇', '🥈', '🥉'];
// Or / argent / bronze — teintes translucides pour les marches du podium.
const STEP_TINT = ['#d4a53f', '#9aa3ad', '#b3805a'];
const STEP_HEIGHT = [64, 46, 38];
const AVATAR_SIZE = [56, 44, 44];
const VISUAL_ORDER = [1, 0, 2]; // 2e à gauche, 1er au centre, 3e à droite

// Podium des 3 joueurs du mois (victoires sur matchs confirmés) — masqué sous 3 joueurs.
export function TopOfMonth({ entries }: { entries: TopMonthEntry[] }) {
  const { th } = useTheme();
  if (entries.length < 3) return null;
  return (
    <section>
      <SectionHeader title="Le top du mois" />
      <div style={{ ...cardStyle(th), padding: '22px 16px 0', display: 'flex', alignItems: 'flex-end', gap: 10, overflow: 'hidden' }}>
        {entries.slice(0, 3).map((e, rank) => (
          <div key={e.userId} style={{ order: VISUAL_ORDER.indexOf(rank), flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <Avatar firstName={e.firstName} lastName={e.lastName} avatarUrl={e.avatarUrl} size={AVATAR_SIZE[rank]} color={colorForSeed(e.userId)} />
            <span style={{ maxWidth: '100%', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {e.firstName} {e.lastName}
            </span>
            <span aria-label={`${e.wins} victoire${e.wins > 1 ? 's' : ''}`} style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: rank === 0 ? 24 : 19, lineHeight: 1, color: th.text }}>
              {e.wins}
              <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 600, color: th.textMute }}> victoire{e.wins > 1 ? 's' : ''}</span>
            </span>
            <div aria-hidden="true" style={{
              width: '100%', height: STEP_HEIGHT[rank], borderRadius: '10px 10px 0 0',
              background: th.mode === 'floodlit' ? `${STEP_TINT[rank]}38` : `${STEP_TINT[rank]}55`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: rank === 0 ? 22 : 18,
            }}>
              {MEDALS[rank]}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
