'use client';
import { CSSProperties, ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { shade, Theme } from '@/lib/theme';

/**
 * Langage commun des cartes du cockpit fiche membre : une teinte par carte (vocabulaire
 * des sections de la sidebar admin), kicker « tiret + petites capitales » à la place des
 * gros titres, surface à ombre douce. Chaque carte du cockpit importe d'ici pour rester
 * visuellement alignée avec ses sœurs.
 */
export const MEMBER_CARD_TINTS = {
  blue: '#5e93da',
  amber: '#e6a93c',
  teal: '#2bb6a3',
  green: '#5bbd6e',
  violet: '#9b8cf0',
  coral: '#e05252',
} as const;

/** Surface commune des cartes (miroir de la recette éditoriale du site : surface + ombre douce). */
export function memberCardStyle(th: Theme): CSSProperties {
  return { background: th.surface, borderRadius: 18, padding: 18, boxShadow: th.shadow };
}

/**
 * Kicker de carte : tiret teinté + libellé en petites capitales, texte assombri en mode
 * clair pour rester lisible (même astuce que les titres de section de la sidebar).
 * `right` pose une action alignée à droite (« Tout l'historique → »…).
 */
export function Kicker({ color, children, right }: { color: string; children: ReactNode; right?: ReactNode }) {
  const { th } = useTheme();
  const ink = th.mode === 'daylight' ? shade(color, 0.62) : color;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <span aria-hidden style={{ width: 14, height: 4, borderRadius: 3, background: color, flexShrink: 0 }} />
      <span style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 800, letterSpacing: 0.7, textTransform: 'uppercase', color: ink }}>
        {children}
      </span>
      {right != null && <span style={{ marginLeft: 'auto' }}>{right}</span>}
    </div>
  );
}
