'use client';
import type { CSSProperties } from 'react';
import { ACCENTS } from '@/lib/theme';

// « La France en pointillés » — geste signature du « Palova de tous les clubs » : une trame de
// points d'encre masquée par la silhouette de l'hexagone (Corse comprise), où quelques points
// « clubs » s'allument aux couleurs de la palette. Vit sur les heros brume bleue (encres fixes,
// identique clair/sombre). Purement décoratif : aria-hidden + pointer-events:none. La taille et
// la position sont posées par le parent via la classe .pl-france-hero (globals.css — la boîte
// reste CARRÉE, ratio de la viewBox 100×100, pour que le masque `contain` la remplisse et que
// les épingles en % tombent sur la forme) + le prop `style` (surcharges locales).

// Silhouette France (path 100×100, hexagone + Corse) encodée en data-URI pour le masque CSS.
const FRANCE_PATH =
  'M58,3 L66,7 L74,9 L83,15 L90,22 L86,30 L91,40 L87,47 L92,55 L86,63 L88,69 L78,71 L68,74 ' +
  'L60,72 L54,77 L47,81 L36,82 L25,79 L21,75 L24,66 L21,58 L26,52 L17,46 L9,43 L2,36 L8,30 ' +
  'L17,31 L24,28 L23,20 L28,19 L30,26 L38,23 L46,15 L52,8 Z M92,74 L95,78 L93,87 L89,84 L90,77 Z';
const FRANCE_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><path d='${FRANCE_PATH}'/></svg>`,
)}")`;

// Encre de la trame : bleu nuit sur brume (constante locale — pas un token de thème, la brume a
// ses encres fixes). Halo des épingles assorti au dégradé.
const DOT_INK = 'rgba(27,42,63,0.38)';
const PIN_RING = '#e9f0f9';

// 6 villes allumées (coordonnées du path, %) — « few » garde Paris/Lyon/Marseille.
const PINS: { color: string; left: string; top: string; few?: boolean }[] = [
  { color: ACCENTS.cyan, left: '57%', top: '11%' },                 // Lille
  { color: ACCENTS.blue, left: '52%', top: '24%', few: true },      // Paris
  { color: ACCENTS.apricot, left: '25%', top: '44%' },              // Nantes
  { color: ACCENTS.emerald, left: '70%', top: '50%', few: true },   // Lyon
  { color: ACCENTS.violet, left: '33%', top: '61%' },               // Bordeaux
  { color: ACCENTS.coral, left: '68%', top: '69%', few: true },     // Marseille
];

export function FranceDotsMap({ pins = 'full', style }: { pins?: 'full' | 'few' | 'none'; style?: CSSProperties }) {
  const shown = pins === 'none' ? [] : pins === 'few' ? PINS.filter((p) => p.few) : PINS;
  return (
    <div className="pl-france-hero" data-testid="france-dots" aria-hidden="true" style={{ pointerEvents: 'none', ...style }}>
      <div
        style={{
          position: 'absolute', inset: 0,
          backgroundImage: `radial-gradient(circle, ${DOT_INK} 1.35px, transparent 1.7px)`,
          backgroundSize: '8px 8px',
          WebkitMaskImage: FRANCE_MASK, WebkitMaskRepeat: 'no-repeat', WebkitMaskPosition: 'center', WebkitMaskSize: 'contain',
          maskImage: FRANCE_MASK, maskRepeat: 'no-repeat', maskPosition: 'center', maskSize: 'contain',
        }}
      />
      {shown.map((p, i) => (
        <span
          key={p.left + p.top}
          data-testid="france-pin"
          className="pl-pinpop"
          style={{
            position: 'absolute', left: p.left, top: p.top, width: 10, height: 10, borderRadius: '50%',
            background: p.color,
            boxShadow: `0 0 0 3px ${PIN_RING}, 0 0 16px ${p.color}99`,
            animationDelay: `${0.15 * (i + 1)}s`,
          }}
        />
      ))}
    </div>
  );
}
