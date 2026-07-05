'use client';
import Link from 'next/link';
import { OpenMatch } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { formatDateShortTimeRange } from '@/lib/tournament';
import { rangeLabel } from '@/lib/levelMatch';
import { colorForSeed } from '@/lib/playerColors';
import { Avatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';

// Rail « Parties ouvertes » du Club-house : les 3 prochaines, clic → page de la partie.
export function OpenMatchesRail({ matches, timezone }: { matches: OpenMatch[]; timezone: string }) {
  const { th } = useTheme();
  if (matches.length === 0) return null;
  return (
    <section style={{ background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <Icon name="users" size={15} color={th.accent} />
        <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 12.5, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute }}>Parties ouvertes</span>
        <Link href="/parties" style={{ marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.accent, textDecoration: 'none' }}>
          Toutes les parties →
        </Link>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {matches.map((m) => (
          <Link key={m.id} href={`/parties/${m.id}`} aria-label={`${m.resourceName} — voir la partie`} style={{
            textDecoration: 'none', background: th.surface2, borderRadius: 10, padding: '10px 12px',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ display: 'flex' }}>
              {m.players.slice(0, 4).map((p, i) => (
                <span key={p.userId} style={{ marginLeft: i === 0 ? 0 : -8 }}>
                  <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl} size={26} color={colorForSeed(p.userId)} />
                </span>
              ))}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: th.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {m.resourceName} · {formatDateShortTimeRange(m.startTime, m.endTime, timezone)}
              </span>
              {(m.targetLevelMin != null || m.targetLevelMax != null) && (
                <span style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textMute }}>{rangeLabel(m.targetLevelMin ?? null, m.targetLevelMax ?? null)}</span>
              )}
            </span>
            <Chip tone={m.full ? 'mute' : 'accent'}>{m.full ? 'Complet' : `${m.spotsLeft} place${m.spotsLeft > 1 ? 's' : ''}`}</Chip>
          </Link>
        ))}
      </div>
    </section>
  );
}
