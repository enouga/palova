'use client';
import { ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Icon, IconName } from '@/components/ui/Icon';

export interface StatPillProps {
  icon: IconName;
  /** Teinte de la tuile-icône. Absent = tuile neutre (compteur calme). */
  accent?: string;
  /** Petit label en capitales ("Porte-monnaie", "Heures pleines"…). */
  label: string;
  /** Mode simple : valeur en gras ("130,00 €", "Padel · h. creuses"). */
  value?: ReactNode;
  /** Mode jauge (quotas) : ratio used/limit + jauge + suffixe. */
  meter?: { used: number; limit: number; suffix: string };
  /** Au plafond (used >= limit) : icône + jauge + liseré coral. */
  warn?: boolean;
  /** Occupe toute la largeur de sa cellule (pastilles à taille égale en grille/flex). */
  fill?: boolean;
  /** Variante serrée (mode jauge) : jauge raccourcie + suffixe masqué, pour faire tenir 2 pastilles sur une ligne dans un conteneur étroit (ex. BookingModal). */
  compact?: boolean;
}

// Pastille « stat » : tuile-icône teintée + label au-dessus d'une valeur (ou d'une jauge).
// Présentation pure, source de vérité du look des soldes/abonnements/quotas sur Réserver.
// Tuile et jauge alignées sur la convention AgendaCard (teintes 24/40 selon le thème).
export function StatPill({ icon, accent, label, value, meter, warn, fill, compact }: StatPillProps) {
  const { th } = useTheme();
  const floodlit = th.mode === 'floodlit';

  // Teinte effective : coral au plafond, sinon l'accent fourni, sinon tuile neutre.
  const tileColor = warn ? ACCENTS.coral : accent;
  const tileBg = tileColor ? (floodlit ? `${tileColor}24` : `${tileColor}40`) : th.surface2;
  const iconColor = tileColor ? (floodlit ? tileColor : th.ink) : th.textMute;

  const fillPct = meter ? Math.min(meter.used / Math.max(meter.limit, 1), 1) * 100 : 0;
  const fillColor = warn ? ACCENTS.coral : th.accent;

  return (
    <span
      data-warn={warn ? '1' : undefined}
      style={{
        // Non-fill : largeur naturelle intouchable — dans une rangée en overflow (Réserver),
        // sans ça la colonne texte (minWidth 0) se compresse et ré-ellipsise la valeur.
        display: fill ? 'flex' : 'inline-flex', width: fill ? '100%' : undefined, minWidth: fill ? 0 : undefined, flexShrink: fill ? undefined : 0,
        // Compact (2 colonnes sur une ligne, conteneur étroit) : tuile + gouttières resserrées
        // pour que le libellé « Heures pleines/creuses » tienne en entier même à ~360px.
        alignItems: 'center', gap: compact ? 9 : 11,
        background: th.surface, borderRadius: 999, padding: compact ? '7px 10px 7px 7px' : '7px 16px 7px 8px', whiteSpace: 'nowrap',
        boxShadow: `inset 0 0 0 1px ${warn ? `${ACCENTS.coral}55` : th.line}, ${th.shadowSoft}`,
      }}
    >
      <span aria-hidden="true" style={{
        width: compact ? 28 : 34, height: compact ? 28 : 34, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', background: tileBg,
      }}>
        <Icon name={icon} size={compact ? 16 : 18} color={iconColor} />
      </span>

      <span style={{ display: 'flex', flexDirection: 'column', gap: meter ? 4 : 1, minWidth: 0 }}>
        <span style={{
          // Compact : police + interlettrage réduits pour que « Heures pleines/creuses » tienne en
          // entier dans une colonne étroite (~360px) ; l'ellipsis reste un filet de sécurité.
          fontFamily: th.fontUI, fontSize: compact ? 9 : 10, fontWeight: 700, letterSpacing: compact ? 0.1 : 0.5,
          textTransform: 'uppercase', color: th.textMute, lineHeight: 1,
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{label}</span>

        {meter ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: compact ? 7 : 8 }}>
            <span style={{ fontFamily: th.fontMono, fontSize: 13.5, fontWeight: 700, color: th.text, fontVariantNumeric: 'tabular-nums' }}>
              {meter.used}/{meter.limit}
            </span>
            <span style={{ width: compact ? 34 : 50, height: 5, borderRadius: 999, background: th.surface2, overflow: 'hidden' }}>
              <span data-testid="statpill-fill" style={{ display: 'block', height: '100%', borderRadius: 999, background: fillColor, width: `${fillPct}%`, transition: 'width .6s ease' }} />
            </span>
            {!compact && <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 500, color: th.textFaint }}>{meter.suffix}</span>}
          </span>
        ) : (
          <span style={{ fontFamily: th.fontUI, fontSize: 15, fontWeight: 750, color: th.text, letterSpacing: -0.1, fontVariantNumeric: 'tabular-nums', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {value}
          </span>
        )}
      </span>
    </span>
  );
}
