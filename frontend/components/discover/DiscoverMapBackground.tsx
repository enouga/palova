'use client';
import { useTheme } from '@/lib/ThemeProvider';

// Couche décorative « plan » de la page /decouvrir (« le Palova de tous les clubs ») : un fond
// discret de plan de ville (routes + rivière + pâtés) répété à échelle constante, ponctué de 3
// épingles aux couleurs de clubs. Signale la vue agrégée AU-DESSUS des clubs. Purement
// présentationnel : aucune donnée, aucune interaction. aria-hidden + pointer-events:none →
// invisible aux lecteurs d'écran et au pointeur ; posé SOUS le contenu (z-index 0). Les tons et
// alphas sont des constantes LOCALES (surface décorative propre à cette page — pas de nouveaux
// tokens de thème globaux).

interface PlanPalette {
  base: string;      // fond « plan »
  road: string;      // routes fines
  mainRoad: string;  // route principale teintée de l'accent Palova
  river: string;     // rivière pointillée
  block: string;     // pâtés estompés
  pinDot: string;    // point central des épingles (= couleur du fond → contraste net)
}

const LIGHT: PlanPalette = {
  base: '#eef1f5',
  road: 'rgba(24,21,14,0.06)',
  mainRoad: 'rgba(94,147,218,0.16)',
  river: 'rgba(70,230,208,0.20)',
  block: 'rgba(24,21,14,0.018)',
  pinDot: '#eef1f5',
};

const DARK: PlanPalette = {
  base: '#111110',
  road: 'rgba(255,255,255,0.05)',
  mainRoad: 'rgba(94,147,218,0.20)',
  river: 'rgba(70,230,208,0.16)',
  block: 'rgba(255,255,255,0.02)',
  pinDot: '#111110',
};

// 3 épingles aux couleurs de clubs (bleu / émeraude / violet), réparties dans la zone haute de
// la page — position en % de largeur pour s'étaler quelle que soit la largeur réelle.
const PINS: { color: string; pos: React.CSSProperties }[] = [
  { color: '#5e93da', pos: { left: '11%', top: 118 } },
  { color: '#34b27b', pos: { right: '16%', top: 82 } },
  { color: '#bda6ff', pos: { left: '38%', top: 360 } },
];

// Tuile SVG répétée : échelle CONSTANTE quelle que soit la largeur de page (contrairement à un
// SVG plein cadre en `slice` qui grossirait les traits ~3× sur desktop). Routes bord à bord →
// tuilage propre. La rivière et les pâtés introduisent une couture négligeable à faible alpha.
function tileUrl(p: PlanPalette): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='360' height='480' viewBox='0 0 360 480'>` +
    `<rect x='30' y='60' width='90' height='70' rx='6' fill='${p.block}'/>` +
    `<rect x='200' y='320' width='120' height='90' rx='6' fill='${p.block}'/>` +
    `<line x1='0' y1='96' x2='360' y2='96' stroke='${p.mainRoad}' stroke-width='7'/>` +
    `<line x1='0' y1='300' x2='360' y2='300' stroke='${p.road}' stroke-width='6'/>` +
    `<line x1='90' y1='0' x2='90' y2='480' stroke='${p.road}' stroke-width='6'/>` +
    `<line x1='270' y1='0' x2='270' y2='480' stroke='${p.road}' stroke-width='5'/>` +
    `<path d='M0,200 C80,170 130,260 200,225 S320,290 360,255' fill='none' stroke='${p.river}' stroke-width='7' stroke-dasharray='2 9' stroke-linecap='round'/>` +
    `<circle cx='90' cy='96' r='10' fill='none' stroke='${p.mainRoad}' stroke-width='5'/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function DiscoverMapBackground() {
  const { th } = useTheme();
  const pal = th.mode === 'floodlit' ? DARK : LIGHT;
  return (
    <div
      data-testid="discover-map"
      data-mode={th.mode}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        background: pal.base,
        backgroundImage: tileUrl(pal),
        backgroundRepeat: 'repeat',
        backgroundSize: '360px 480px',
      }}
    >
      {PINS.map((p, i) => (
        <span key={i} style={{ position: 'absolute', opacity: 0.55, pointerEvents: 'none', ...p.pos }}>
          <svg width="16" height="24" viewBox="0 0 16 24">
            <path fill={p.color} d="M8 0C3.582 0 0 3.582 0 8c0 5.25 8 16 8 16s8-10.75 8-16c0-4.418-3.582-8-8-8z" />
            <circle data-testid="discover-pin-dot" fill={pal.pinDot} cx="8" cy="8" r="3" />
          </svg>
        </span>
      ))}
    </div>
  );
}
