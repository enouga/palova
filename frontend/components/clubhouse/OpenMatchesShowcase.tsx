'use client';
import Link from 'next/link';
import { OpenMatch } from '@/lib/api';
import { matchSeats } from '@/lib/clubhouse';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { formatDateShort, formatDateShortTimeRange, formatHourRange } from '@/lib/tournament';
import { rangeLabel } from '@/lib/levelMatch';
import { colorForSeed } from '@/lib/playerColors';
import { Avatar } from '@/components/ui/Avatar';
import { SectionHeader, cardStyle } from '@/components/clubhouse/SectionHeader';
import { AgendaRail } from '@/components/agenda/AgendaRail';

// Section vedette « Ça joue bientôt » : grandes cartes parties ouvertes sur le rail d'agenda
// partagé (mobile : une carte pleine + liseré, points de pagination ; desktop : étagère +
// flèches). On VOIT les places à prendre (sièges vides en pointillés) ; clic → /parties/[id].
export function OpenMatchesShowcase({ matches, timezone }: { matches: OpenMatch[]; timezone: string }) {
  const { th } = useTheme();
  const shown = matches.slice(0, 6);
  if (matches.length === 0) return null;
  const count = `${shown.length} partie${shown.length > 1 ? 's' : ''}`;
  return (
    <section id="ch-matches">
      <SectionHeader title="Ça joue bientôt" count={count} />
      <AgendaRail desktopColumns="272px" desktopRows={1} prevLabel="Parties précédentes" nextLabel="Parties suivantes">
        {shown.map((m) => {
          const empty = matchSeats(m);
          const urgent = !m.full && m.spotsLeft === 1;
          const level = (m.targetLevelMin != null || m.targetLevelMax != null)
            ? rangeLabel(m.targetLevelMin ?? null, m.targetLevelMax ?? null) : null;
          const genderLabel = m.gender === 'WOMEN' ? 'Féminine' : m.gender === 'MIXED' ? 'Mixte' : null;
          const when = formatDateShortTimeRange(m.startTime, m.endTime, timezone);
          const dateLabel = formatDateShort(m.startTime, timezone);
          const timeLabel = formatHourRange(m.startTime, m.endTime, timezone);
          return (
            <article key={m.id} style={{ ...cardStyle(th), padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                {/* date et heure sur 2 lignes distinctes — un saut de ligne au milieu de « → 09h30 »
                    apparaissait selon la longueur du texte (largeur de carte fixe, texte variable) */}
                <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, letterSpacing: -0.2, color: th.text, whiteSpace: 'nowrap' }}>{dateLabel}</div>
                <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, letterSpacing: -0.2, color: th.text, whiteSpace: 'nowrap' }}>{timeLabel}</div>
                <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 3 }}>
                  {m.resourceName}{level ? ` · ${level}` : ''}{genderLabel ? ` · ${genderLabel}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }} aria-label={m.full ? 'Complet' : `${m.spotsLeft} place${m.spotsLeft > 1 ? 's' : ''} à prendre`}>
                {m.players.map((p, i) => (
                  <span key={p.userId} style={{ marginLeft: i === 0 ? 0 : -9, borderRadius: '50%', boxShadow: `0 0 0 2.5px ${th.surface}`, lineHeight: 0 }}>
                    <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl} size={36} color={colorForSeed(p.userId)} />
                  </span>
                ))}
                {Array.from({ length: empty }, (_, i) => (
                  <span key={`e${i}`} data-testid="empty-seat" aria-hidden="true" style={{
                    width: 36, height: 36, borderRadius: '50%', marginLeft: m.players.length + i === 0 ? 0 : -9, boxSizing: 'border-box',
                    border: `2px dashed ${urgent ? ACCENTS.coral : th.lineStrong}`, background: th.surface,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    fontFamily: th.fontUI, fontSize: 15, fontWeight: 700, color: urgent ? ACCENTS.coral : th.textFaint,
                  }}>+</span>
                ))}
                <span style={{
                  marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', borderRadius: 999, padding: '4px 10px',
                  background: m.full ? th.surface2 : urgent ? (th.mode === 'floodlit' ? `${ACCENTS.coral}26` : `${ACCENTS.coral}33`) : (th.mode === 'floodlit' ? `${th.accent}26` : `${th.accent}33`),
                  color: m.full ? th.textMute : urgent ? (th.mode === 'floodlit' ? ACCENTS.coral : th.ink) : (th.mode === 'floodlit' ? th.accent : th.ink),
                }}>
                  {m.full ? 'Complet' : `${m.spotsLeft} place${m.spotsLeft > 1 ? 's' : ''}`}
                </span>
              </div>
              <Link href={`/parties/${m.id}`} aria-label={`${m.full ? 'Voir' : 'Rejoindre'} la partie du ${when}`} style={{
                textAlign: 'center', textDecoration: 'none', borderRadius: 11, padding: '10px 12px',
                fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700,
                background: m.full ? th.surface2 : th.accent, color: m.full ? th.text : th.onAccent,
              }}>
                {m.full ? 'Voir la partie' : 'Rejoindre'}
              </Link>
            </article>
          );
        })}
      </AgendaRail>
    </section>
  );
}
