'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, shade, gaugeTrack } from '@/lib/theme';
import { Icon, IconName } from '@/components/ui/Icon';
import { deadlineCountdown } from '@/lib/tournament';

export interface AgendaCardHeaderProps {
  icon: IconName;              // trophy (compétition) / bolt (animation) / whistle-user (cours)
  accent: string;              // teinte du type : liseré (posé par la coquille), icône, tag
  tag: string;                 // « P500 · Messieurs » / « Mêlée »
  title: string;
  dateLabel: string;           // « jeudi 9 juillet · 14h01 »
  /** ISO — compte à rebours. Absent/null = pas de chip (échéance passée ou sans objet). */
  deadline?: string | null;
  now: Date | null;            // null avant le mount (hydration-safe)
  ratio: number | null;        // remplissage 0..1, null = pas de jauge
  places: { text: string; urgent: boolean };
  /** « 40 € » — chiffre vedette display à droite de la ligne de date. */
  price?: string | null;
  extra?: string | null;       // « Membres » / « Coach : … » — suffixe de la ligne de date
  subtitle?: string | null;    // « Club · Ville · 8 km » — ligne secondaire (calendrier national)
  sportLabel?: string | null;  // « Tennis » — chip sport (vue multi-sport / multi-club) ; null = masqué
}

/**
 * Corps visuel commun des cartes d'agenda « liseré éditorial » (spec 2026-07-24) :
 * icône + tag teintés type, titre display, date + prix vedette, jauge de remplissage
 * épinglée en pied (pieds alignés quand la carte est étirée dans un rail).
 *
 * Rendu en UNE colonne flex (`flex:1; minWidth:0`) — le parent pose
 * `display:flex; gap:13` et le liseré (CardStripe) dans sa coquille.
 *
 * Tout est en `<span>` : valide dans le `<button>` d'AgendaCard (contenu phrasé) COMME dans
 * les cartes `<div>` dépliables (J/A, coach), qui ne peuvent pas être un bouton puisqu'elles
 * contiennent elles-mêmes des boutons et des liens `tel:`.
 */
export function AgendaCardHeader({
  icon, accent, tag, title, dateLabel, deadline, now, ratio, places, price, extra, subtitle, sportLabel,
}: AgendaCardHeaderProps) {
  const { th } = useTheme();
  const countdown = deadline && now ? deadlineCountdown(deadline, now) : null;
  // Accent lisible en texte : assombri sur fond clair, plein en floodlit (spec §1).
  const tagColor = th.mode === 'floodlit' ? accent : shade(accent, 0.58);

  return (
    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Icon name={icon} size={13} color={tagColor} style={{ flexShrink: 0 }} />
        {sportLabel && (
          <span data-testid="sport-badge" style={{
            fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.3, whiteSpace: 'nowrap', flexShrink: 0,
            borderRadius: 999, padding: '2px 8px', background: th.surface2, color: th.textMute, boxShadow: `inset 0 0 0 1px ${th.line}`,
          }}>{sportLabel}</span>
        )}
        <span style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: tagColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
        <span style={{ flex: 1 }} />
        {countdown && (
          <span style={{
            fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap', borderRadius: 999, padding: '3px 9px',
            background: countdown.urgent ? (th.mode === 'floodlit' ? `${ACCENTS.coral}26` : `${ACCENTS.coral}40`) : th.surface2,
            color: countdown.urgent ? (th.mode === 'floodlit' ? ACCENTS.coral : th.ink) : th.textMute,
          }}>
            {countdown.text}
          </span>
        )}
      </span>

      <span style={{ fontFamily: th.fontDisplay, fontSize: 17.5, fontWeight: 600, letterSpacing: -0.2, color: th.text }}>{title}</span>
      {subtitle && (
        <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</span>
      )}
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, minWidth: 0 }}>
          {dateLabel}{extra ? ` · ${extra}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        {price && (
          <span style={{ fontFamily: th.fontDisplay, fontSize: 16.5, fontWeight: 700, color: th.text, whiteSpace: 'nowrap' }}>{price}</span>
        )}
      </span>

      {/* marginTop:auto = pied épinglé en bas quand la carte est étirée par le rail (hauteurs égales) */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 'auto', paddingTop: 6 }}>
        {ratio != null && (
          <span style={{ flex: '0 1 120px', ...gaugeTrack(th, 5) }}>
            <span data-testid="card-fill" style={{ display: 'block', height: '100%', borderRadius: 999, background: places.urgent ? ACCENTS.coral : th.accent, width: now ? `${Math.round(ratio * 100)}%` : 0, transition: 'width .8s ease' }} />
          </span>
        )}
        <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: places.urgent ? 700 : 600, color: places.urgent ? ACCENTS.coral : th.textMute }}>{places.text}</span>
      </span>
    </span>
  );
}
