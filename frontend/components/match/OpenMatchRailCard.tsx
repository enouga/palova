'use client';
import { OpenMatchGender, OpenMatchPlayer } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { matchSeats } from '@/lib/clubhouse';
import { rangeLabel } from '@/lib/levelMatch';
import { formatDateShort, formatDateShortTimeRange, formatHourRange } from '@/lib/tournament';
import { colorForSeed } from '@/lib/playerColors';
import { distanceLabel } from '@/lib/discover';
import { Avatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/atoms';

/** Forme structurelle commune à `OpenMatch` (club) et `NationalOpenMatch` (plateforme). */
export interface RailMatch {
  id: string;
  resourceName: string;
  startTime: string;
  endTime: string;
  maxPlayers: number;
  spotsLeft: number;
  full?: boolean;
  players: OpenMatchPlayer[];
  targetLevelMin?: number | null;
  targetLevelMax?: number | null;
  competitive?: boolean;
  gender?: OpenMatchGender | null;
}

// LA carte de partie ouverte des rails (spec 2026-07-24 carte-partie-unifiée) : partagée
// entre les surfaces cross-club (/decouvrir, vitrine, Mon Palova — prop `club` fournie →
// liseré identitaire + « club · ville · distance ») et le Club-house (« Ça joue bientôt » —
// `club` omis, contexte mono-club). Pure : pas de fetch, pas de state ; l'appelant fournit
// `href` (cross-sous-domaine ou relatif) et `timezone` (celle du club de la partie).
export function OpenMatchRailCard({ match: m, club, distanceKm, href, timezone }: {
  match: RailMatch;
  club?: { name: string; city: string | null; accentColor: string } | null;
  distanceKm?: number | null;
  href: string;
  timezone: string;
}) {
  const { th } = useTheme();
  const empty = matchSeats(m);
  const full = m.full === true;
  const urgent = !full && m.spotsLeft === 1;
  const level = (m.targetLevelMin != null || m.targetLevelMax != null)
    ? rangeLabel(m.targetLevelMin ?? null, m.targetLevelMax ?? null) : null;
  const genderLabel = m.gender === 'WOMEN' ? 'Féminine' : m.gender === 'MIXED' ? 'Mixte' : null;
  const when = formatDateShortTimeRange(m.startTime, m.endTime, timezone);
  // Date et heure sur 2 lignes distinctes (nowrap chacune) → hauteur de carte CONSTANTE,
  // que le libellé soit court ou long (un seul champ laissait l'heure sauter à la ligne).
  const dateLabel = formatDateShort(m.startTime, timezone);
  const timeLabel = formatHourRange(m.startTime, m.endTime, timezone);
  return (
    <a
      href={href}
      aria-label={`${full ? 'Voir' : 'Rejoindre'} la partie du ${when}${club ? ` à ${club.name}` : ''}`}
      className="pl-lift"
      style={{
        textDecoration: 'none',
        background: th.surface, borderRadius: 20, padding: '16px 16px 15px',
        boxShadow: `${th.shadowSoft}, inset 0 0 0 1px ${th.line}`,
        display: 'flex', flexDirection: 'column', gap: 12, position: 'relative', overflow: 'hidden',
      }}
    >
      {club && (
        <>
          {/* liseré identitaire du club (surfaces cross-club uniquement) */}
          <span aria-hidden="true" data-club-band style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: club.accentColor }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: '50%', background: club.accentColor, flexShrink: 0 }} />
            <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {club.name}
            </span>
            {club.city && (
              <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, whiteSpace: 'nowrap', flexShrink: 0 }}>· {club.city}</span>
            )}
            {distanceKm != null && (
              <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, whiteSpace: 'nowrap', flexShrink: 0 }}>· {distanceLabel(distanceKm)}</span>
            )}
          </div>
        </>
      )}

      <div>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, letterSpacing: -0.2, color: th.text, whiteSpace: 'nowrap' }}>{dateLabel}</div>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, letterSpacing: -0.2, color: th.text, whiteSpace: 'nowrap' }}>{timeLabel}</div>
        <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 3 }}>
          {m.resourceName} · {level ?? 'Tous niveaux'}
        </div>
        {/* Type (toujours) + genre (si féminine/mixte) en chips — mêmes libellés que /parties. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {m.competitive === false
            ? <Chip tone="line">Pour le fun</Chip>
            : <Chip tone="accent">Pour de vrai</Chip>}
          {genderLabel && <Chip tone="line">{genderLabel}</Chip>}
        </div>
      </div>

      {/* joueurs + sièges à prendre */}
      <div style={{ display: 'flex', alignItems: 'center' }} aria-label={full ? 'Complet' : `${m.spotsLeft} place${m.spotsLeft > 1 ? 's' : ''} à prendre`}>
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
          background: full ? th.surface2 : urgent ? (th.mode === 'floodlit' ? `${ACCENTS.coral}26` : `${ACCENTS.coral}33`) : (th.mode === 'floodlit' ? `${th.accent}26` : `${th.accent}33`),
          color: full ? th.textMute : urgent ? (th.mode === 'floodlit' ? ACCENTS.coral : th.ink) : (th.mode === 'floodlit' ? th.accent : th.ink),
        }}>
          {full ? 'Complet' : `${m.spotsLeft} place${m.spotsLeft > 1 ? 's' : ''}`}
        </span>
      </div>

      {/* marginTop:auto → le CTA descend en bas quand la carte est étirée par le rail :
          les boutons d'une même rangée s'alignent même si une carte est plus haute. */}
      <span style={{
        marginTop: 'auto',
        textAlign: 'center', borderRadius: 11, padding: '10px 12px',
        fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700,
        background: full ? th.surface2 : th.accent, color: full ? th.text : th.onAccent,
      }}>
        {full ? 'Voir la partie' : 'Rejoindre →'}
      </span>
    </a>
  );
}
