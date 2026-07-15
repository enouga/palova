'use client';
import { CSSProperties, ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { Theme, ACCENTS, gaugeTrack } from '@/lib/theme';
import { Icon, IconName } from '@/components/ui/Icon';
import { deadlineCountdown } from '@/lib/tournament';
import { AgendaGroupKey } from '@/lib/adminAgenda';

// Couleur d'accent (point de section + liseré de carte) d'une section de statut.
export function groupAccentColor(th: Theme, key: AgendaGroupKey): string {
  switch (key) {
    case 'draft': return ACCENTS.apricot;
    case 'upcoming': return ACCENTS.emerald;
    case 'cancelled': return ACCENTS.coral;
    default: return th.textFaint; // past
  }
}

// Coral lisible en petit texte : coral vif en sombre, coral foncé en clair.
function coralInkOf(th: Theme): string {
  return th.mode === 'floodlit' ? ACCENTS.coral : '#b23c17';
}

export interface AgendaAdminCardProps {
  icon: IconName;              // trophy (tournoi) / bolt (event)
  accent: string;             // teinte de la tuile d'icône (apricot / cyan)
  stripe: AgendaGroupKey;     // couleur du liseré latéral
  faded?: boolean;            // passé / annulé → estompé
  tag: string;                // « P500 · MESSIEURS » / « MÊLÉE »
  title: string;
  dateLabel: string;
  deadline?: string | null;   // ISO — compte à rebours (masqué si passé)
  now: Date | null;           // null avant le mount
  ratio: number | null;       // remplissage 0..1, null = pas de jauge
  full?: boolean;
  countLabel: string;         // « 9 / 12 binômes » / « 12 / 20 inscrits »
  waitlist?: number;          // K en liste d'attente
  chips?: (string | null | undefined)[];
  actions: ReactNode;
}

export function AgendaAdminCard(props: AgendaAdminCardProps) {
  const { th } = useTheme();
  const {
    icon, accent, stripe, faded, tag, title, dateLabel, deadline, now,
    ratio, full, countLabel, waitlist, chips, actions,
  } = props;
  const countdown = deadline && now ? deadlineCountdown(deadline, now) : null;
  const coralInk = coralInkOf(th);
  const cleanChips = (chips ?? []).filter(Boolean) as string[];

  const coralPill: CSSProperties = {
    ...PILL,
    background: th.mode === 'floodlit' ? `${ACCENTS.coral}26` : `${ACCENTS.coral}33`,
    color: coralInk,
  };

  return (
    <div style={{
      position: 'relative', overflow: 'hidden', background: th.surface, borderRadius: 16,
      boxShadow: th.shadow, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start',
      gap: 13, padding: '15px 16px 15px 21px', opacity: faded ? 0.72 : 1,
    }}>
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: groupAccentColor(th, stripe) }} />

      <span aria-hidden style={{
        flex: 'none', width: 44, height: 44, marginTop: 2, borderRadius: 13,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: th.mode === 'floodlit' ? `${accent}24` : `${accent}40`,
      }}>
        <Icon name={icon} size={21} color={th.mode === 'floodlit' ? accent : th.ink} />
      </span>

      <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: th.textMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
          <span style={{ flex: 1 }} />
          {countdown && (
            <span style={countdown.urgent ? coralPill : { ...PILL, background: th.surface2, color: th.textMute }}>{countdown.text}</span>
          )}
          {full && !faded && <span style={coralPill}>Complet</span>}
        </div>

        <div style={{ fontFamily: th.fontUI, fontSize: 16.5, fontWeight: 800, letterSpacing: -0.2, color: th.text }}>{title}</div>
        <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>{dateLabel}</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 3, flexWrap: 'wrap' }}>
          {ratio != null && (
            <span style={{ ...gaugeTrack(th, 5), flex: '0 1 120px', minWidth: 70 }}>
              <span style={{ display: 'block', height: '100%', borderRadius: 999, width: `${Math.round(ratio * 100)}%`, background: faded ? th.textFaint : full ? ACCENTS.coral : th.accent }} />
            </span>
          )}
          <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute, whiteSpace: 'nowrap' }}>
            {countLabel}{waitlist ? <> · <span style={{ color: faded ? th.textMute : coralInk, fontWeight: faded ? 600 : 700 }}>{waitlist} en attente</span></> : null}
          </span>
          {cleanChips.map((c, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '2px 8px', fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, background: th.surface2, color: th.textMute, boxShadow: `inset 0 0 0 1px ${th.line}`, whiteSpace: 'nowrap' }}>{c}</span>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, alignSelf: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: 'auto' }}>
        {actions}
      </div>
    </div>
  );
}

const PILL: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '3px 9px',
  fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
};
