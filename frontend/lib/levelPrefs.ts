// Mémorise le dernier choix de fourchette de niveau d'une partie ouverte (BookingModal),
// pour le repré-remplir la fois suivante. Stocké en localStorage, par navigateur.

const KEY = 'palova:open-match-level';

export interface LevelPref {
  enabled: boolean; // l'interrupteur « Limiter le niveau » était-il activé
  min: number;      // borne basse mémorisée (1–8)
  max: number;      // borne haute mémorisée (1–8)
}

function valid(p: unknown): p is LevelPref {
  if (p == null || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return typeof o.enabled === 'boolean'
    && typeof o.min === 'number' && Number.isFinite(o.min)
    && typeof o.max === 'number' && Number.isFinite(o.max)
    && o.min <= o.max;
}

/** Dernier choix mémorisé, ou null (jamais réglé, SSR, ou JSON corrompu). */
export function loadLevelPref(): LevelPref | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return valid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Enregistre le choix courant (best-effort : un échec de stockage est ignoré). */
export function saveLevelPref(pref: LevelPref): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(KEY, JSON.stringify(pref)); }
  catch { /* quota / mode privé : on ignore */ }
}
