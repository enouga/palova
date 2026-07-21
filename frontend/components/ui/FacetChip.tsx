'use client';
import { ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, inkOn } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';

// Chips de filtres partagées (Parties · Events · Tournois national · Découvrir) —
// remplace les 3 copies locales qui avaient dérivé (EventsFilterBar, MatchesFilterBar,
// calendar/FacetPanel). Chaque GROUPE de filtres porte une teinte fixe de la palette
// (FILTER_TINTS, même libellé ⇒ même teinte sur toutes les pages) : pastille sur le
// libellé du groupe, chip active = pill pleine de la teinte (encre via inkOn),
// inactive = contour neutre. `lime` jamais utilisé (illisible en clair).

export const FILTER_TINTS = {
  quand: ACCENTS.emerald,        // « Quand » (Events, calendrier national, Découvrir)
  categorie: ACCENTS.violet,     // « Catégorie » (Events, calendrier national)
  genre: '#9aa8c2',              // « Genre » (Events, calendrier national) — ardoise, choisie par Eric parmi 6 pistes comparées (cyan trop flashy, rose trop proche du violet, or mat trop sombre, miel/terracotta écartés)
  niveau: ACCENTS.blue,          // « Niveau » (Parties, Découvrir)
  typePartie: ACCENTS.coral,     // « Type de partie » (Parties)
  source: ACCENTS.apricot,       // « Source » (Events)
  typeAnimation: ACCENTS.blue,   // « Type » (Events, animations)
  acces: ACCENTS.coral,          // « Accès » (Events, Réservé membres)
  ou: ACCENTS.blue,              // « Où » (calendrier national, « Autour de moi » compris)
} as const;

// Compteur en suffixe aria-hidden : le nom accessible reste « P100 », pas « P100 2 »
// (contrat des tests des 4 surfaces).
export function FacetChip({ label, count, active, onClick, tint, ariaExpanded }: {
  label: string; count?: number; active: boolean; onClick: () => void;
  tint: string; ariaExpanded?: boolean;
}) {
  const { th } = useTheme();
  const fg = active ? inkOn(tint) : th.text;
  return (
    <button type="button" onClick={onClick} aria-pressed={active} aria-expanded={ariaExpanded} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      border: 'none', cursor: 'pointer', borderRadius: 999, padding: '5px 11px',
      fontFamily: th.fontUI, fontSize: 13, fontWeight: active ? 700 : 600,
      background: active ? tint : 'transparent', color: fg,
      boxShadow: active ? 'none' : `inset 0 0 0 1px ${th.line}`,
      opacity: !active && count === 0 ? 0.45 : 1,
      transition: 'all .15s', WebkitTapHighlightColor: 'transparent',
    }}>
      {active && <Icon name="check" size={12} color={fg} />}
      {label}
      {count != null && (
        <span aria-hidden style={{
          fontSize: 11.5, fontWeight: 700, color: active ? fg : th.textFaint,
          opacity: active ? 0.75 : 1, fontVariantNumeric: 'tabular-nums',
        }}>{count}</span>
      )}
    </button>
  );
}

export function FacetGroup({ label, tint, children }: {
  label: string; tint: string; children: ReactNode;
}) {
  const { th } = useTheme();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <span style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6,
        textTransform: 'uppercase', color: th.textFaint,
      }}>
        <span aria-hidden style={{ width: 7, height: 7, borderRadius: 99, background: tint, display: 'inline-block' }} />
        {label}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>{children}</div>
    </div>
  );
}
