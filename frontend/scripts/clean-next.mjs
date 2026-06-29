// Nettoyage du cache de dev Next.js (.next) — cross-platform, sans dépendance.
//
// Pourquoi : en `next dev`, `.next/cache` (cache de compilation incrémentale + source maps
// + artefacts HMR) grossit sans fin, surtout en changeant souvent de branche → le serveur
// finit par ramer (cf. cache vu à 1,3 Go). En prod ce dossier n'existe pas : `next build`
// produit une sortie figée et petite. Ce script n'affecte donc QUE le confort de dev.
//
// Modes (1er argument) :
//   all   → supprime tout `.next` (reset complet)
//   cache → supprime seulement `.next/cache`
//   auto  → supprime `.next/cache` UNIQUEMENT s'il dépasse le seuil (utilisé en `predev`)
//
// Seuil configurable : NEXT_CACHE_MAX_MB (défaut 800).

import { rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const NEXT_DIR = '.next';
const CACHE_DIR = join(NEXT_DIR, 'cache');
const mode = process.argv[2] ?? 'auto';
const THRESHOLD_MB = Number(process.env.NEXT_CACHE_MAX_MB || 800);

function remove(dir, label) {
  try {
    rmSync(dir, { recursive: true, force: true });
    console.log(`[clean-next] ${label} supprimé`);
  } catch (e) {
    console.log(`[clean-next] échec suppression ${label} : ${e.message}`);
  }
}

// Somme les tailles de fichiers en s'arrêtant DÈS que `capBytes` est dépassé.
// Les caches webpack/turbopack sont de gros fichiers `.pack` → la détection « c'est trop
// gros » coûte quelques stat seulement (pas de marche complète de l'arbre).
function exceedsSize(dir, capBytes) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) { stack.push(p); continue; }
      try { total += statSync(p).size; } catch { /* fichier volatil, ignore */ }
      if (total > capBytes) return true;
    }
  }
  return false;
}

if (mode === 'all') {
  remove(NEXT_DIR, '.next');
} else if (mode === 'cache') {
  remove(CACHE_DIR, '.next/cache');
} else { // auto
  const cap = THRESHOLD_MB * 1024 * 1024;
  if (exceedsSize(CACHE_DIR, cap)) {
    console.log(`[clean-next] .next/cache dépasse ${THRESHOLD_MB} Mo → purge (les 1ers builds seront à froid)`);
    remove(CACHE_DIR, '.next/cache');
  }
}
