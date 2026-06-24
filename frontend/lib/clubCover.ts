// Illustration de couverture déterministe d'un club (le « par IA », 100 % local) :
// « mesh gradient » multicolore (plusieurs taches de teintes analogues à la couleur
// d'accent qui se fondent) dérivé de l'accent + slug, jamais stocké.
// Même (slug, accent) → même rendu.

// Hash FNV-1a 32 bits (même algo que lib/playerColors), local, pur, sans dépendance.
export function coverHash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128]; // repli gris si couleur invalide
  const int = parseInt(m[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

// RGB (0-255) → HSL : h en degrés, s/l en 0..1.
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hsla(h: number, s: number, l: number, a: number): string {
  const H = ((h % 360) + 360) % 360;
  return `hsla(${Math.round(H)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%, ${a})`;
}

// Ancrages possibles pour les taches de couleur du mesh (varient par club).
const MESH_POS: [string, string][] = [
  ['16%', '14%'], ['84%', '18%'], ['26%', '86%'], ['88%', '80%'],
  ['8%', '62%'], ['66%', '6%'], ['50%', '46%'], ['98%', '40%'],
];

// Teintes analogues à l'accent (rotation de teinte) pour un fondu harmonieux.
const MESH_STOPS = [
  { dh: 0, sMul: 1, l: 0.58 },
  { dh: 36, sMul: 0.92, l: 0.54 },
  { dh: -44, sMul: 0.95, l: 0.62 },
  { dh: 16, sMul: 1, l: 0.5 },
];

// Fond « mesh gradient » CSS : plusieurs radial-gradient de teintes analogues à
// l'accent posés sur une base sombre, déterministe par (slug, accent).
export function coverBackground(seed: string, accentColor: string): string {
  const h = coverHash(seed);
  const [hue, sat0] = rgbToHsl(...parseHex(accentColor));
  const sat = Math.min(0.9, Math.max(0.55, sat0 || 0.7)); // vif même pour un accent désaturé
  const blobs = MESH_STOPS.map((st, i) => {
    const [x, y] = MESH_POS[(h >>> (i * 3)) % MESH_POS.length];
    const c = (a: number) => hsla(hue + st.dh, sat * st.sMul, st.l, a);
    return `radial-gradient(58% 72% at ${x} ${y}, ${c(0.95)} 0%, ${c(0)} 60%)`;
  });
  const base = `linear-gradient(135deg, ${hsla(hue, sat * 0.6, 0.26, 1)} 0%, ${hsla(hue + 20, sat * 0.65, 0.15, 1)} 100%)`;
  return [...blobs, base].join(', ');
}

// Banque de photos de courts par défaut (Pexels, licence libre sans attribution),
// servies depuis /public/covers. Voir public/covers/CREDITS.md.
export const COVER_PHOTOS = [
  '/covers/court-1.jpg',
  '/covers/court-2.jpg',
  '/covers/court-3.jpg',
  '/covers/court-4.jpg',
  '/covers/court-5.jpg',
  '/covers/court-6.jpg',
  '/covers/court-7.jpg',
  '/covers/court-8.jpg',
  '/covers/court-9.jpg',
  '/covers/court-10.jpg',
  '/covers/court-11.jpg',
  '/covers/court-12.jpg',
] as const;

// Photo de couverture par défaut d'un club (déterministe par slug). Le mesh gradient
// reste le repli si l'image ne charge pas.
export function coverPhoto(seed: string): string {
  return COVER_PHOTOS[coverHash(seed) % COVER_PHOTOS.length];
}

export function coverInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
