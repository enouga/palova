import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// Génère l'image de repli 1200×630 de la carte OG de partie (servie quand le rendu
// dynamique échoue : match introuvable, sharp KO…). PNG committé dans le repo.
// À relancer si le visuel de repli change : npx ts-node scripts/generate-og-fallback.ts

const OUT = path.join(__dirname, '..', 'assets', 'og-card-fallback.png');
const FONT = "'DejaVu Sans', 'Segoe UI', Arial, sans-serif";

const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1d3557"/>
      <stop offset="1" stop-color="#0e1b2e"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <text x="600" y="290" text-anchor="middle" font-family="${FONT}" font-size="64" font-weight="700" fill="#ffffff">Partie ouverte</text>
  <text x="600" y="360" text-anchor="middle" font-family="${FONT}" font-size="30" fill="rgba(255,255,255,0.75)">Rejoignez le match sur Palova</text>
</svg>`;

sharp(Buffer.from(svg)).png().toBuffer().then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log(`OK -> ${OUT} (${buf.byteLength} octets)`);
});
