// Illustration de couverture déterministe d'un club (le « par IA », 100 % local) :
// dégradé dérivé de la couleur d'accent + slug, jamais stocké. Même (slug, accent) → même rendu.

// Hash FNV-1a 32 bits (même algo que lib/playerColors), local pour rester pur et sans dépendance.
export function coverHash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function clampByte(n: number): number { return Math.max(0, Math.min(255, Math.round(n))); }

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128]; // repli gris si couleur invalide
  const int = parseInt(m[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((x) => clampByte(x).toString(16).padStart(2, '0')).join('');
}

function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  return toHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}

const DARK: [number, number, number] = [16, 19, 26]; // #10131a

export function coverGradient(seed: string, accentColor: string): { angle: number; from: string; to: string } {
  const h = coverHash(seed);
  const angle = (h % 8) * 45;                     // 0,45,…,315 — direction variée par club
  const factor = 0.45 + ((h >>> 3) % 21) / 100;   // 0.45..0.65 — profondeur du fondu vers le sombre
  const accent = parseHex(accentColor);
  return { angle, from: toHex(accent[0], accent[1], accent[2]), to: mix(accent, DARK, factor) };
}

export function coverInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
