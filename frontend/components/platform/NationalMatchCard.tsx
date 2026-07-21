'use client';
import { NationalOpenMatch } from '@/lib/api';
import { clubUrl } from '@/lib/clubUrl';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { matchSeats } from '@/lib/clubhouse';
import { rangeLabel } from '@/lib/levelMatch';
import { formatDateShortTimeRange } from '@/lib/tournament';
import { colorForSeed } from '@/lib/playerColors';
import { distanceLabel } from '@/lib/discover';
import { Avatar } from '@/components/ui/Avatar';

// Carte présentationnelle d'une partie ouverte nationale, partagée entre le rail vedette de
// la vitrine (NationalOpenMatches, snap-scroll) et la grille de la future page /decouvrir
// (distanceKm calculée côté client). Pure : pas de fetch, pas de state.
export function NationalMatchCard({
  match: m,
  distanceKm,
  style,
}: {
  match: NationalOpenMatch;
  distanceKm?: number | null;
  style?: React.CSSProperties;
}) {
  const { th } = useTheme();
  const empty = matchSeats(m);
  const urgent = m.spotsLeft === 1;
  const level = (m.targetLevelMin != null || m.targetLevelMax != null)
    ? rangeLabel(m.targetLevelMin, m.targetLevelMax) : null;
  const genderLabel = m.gender === 'WOMEN' ? 'Féminine' : m.gender === 'MIXED' ? 'Mixte' : null;
  const when = formatDateShortTimeRange(m.startTime, m.endTime, m.club.timezone);
  return (
    <a
      href={clubUrl(m.club.slug, `/parties/${m.id}`)}
      aria-label={`Rejoindre la partie du ${when} à ${m.club.name}`}
      className="pl-lift"
      style={{
        textDecoration: 'none',
        background: th.surface, borderRadius: 20, padding: '16px 16px 15px',
        boxShadow: `${th.shadowSoft}, inset 0 0 0 1px ${th.line}`,
        display: 'flex', flexDirection: 'column', gap: 12, position: 'relative', overflow: 'hidden',
        ...style,
      }}
    >
      {/* liseré identitaire du club */}
      <span aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: m.club.accentColor }} />

      {/* club · ville · distance */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: '50%', background: m.club.accentColor, flexShrink: 0 }} />
        <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {m.club.name}
        </span>
        {m.club.city && (
          <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, whiteSpace: 'nowrap', flexShrink: 0 }}>· {m.club.city}</span>
        )}
        {distanceKm != null && (
          <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, whiteSpace: 'nowrap', flexShrink: 0 }}>· {distanceLabel(distanceKm)}</span>
        )}
      </div>

      <div>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, letterSpacing: -0.2, color: th.text }}>{when}</div>
        <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 3 }}>
          {m.resourceName} · {level ?? 'Tous niveaux'}{genderLabel ? ` · ${genderLabel}` : ''}
        </div>
      </div>

      {/* joueurs + sièges à prendre */}
      <div style={{ display: 'flex', alignItems: 'center' }} aria-label={`${m.spotsLeft} place${m.spotsLeft > 1 ? 's' : ''} à prendre`}>
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
          background: urgent ? (th.mode === 'floodlit' ? `${ACCENTS.coral}26` : `${ACCENTS.coral}33`) : (th.mode === 'floodlit' ? `${th.accent}26` : `${th.accent}33`),
          color: urgent ? (th.mode === 'floodlit' ? ACCENTS.coral : th.ink) : (th.mode === 'floodlit' ? th.accent : th.ink),
        }}>
          {m.spotsLeft} place{m.spotsLeft > 1 ? 's' : ''}
        </span>
      </div>

      <span style={{
        textAlign: 'center', borderRadius: 11, padding: '10px 12px',
        fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700,
        background: th.accent, color: th.onAccent,
      }}>
        Rejoindre →
      </span>
    </a>
  );
}
