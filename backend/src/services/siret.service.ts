// Validation + vérification d'un SIRET français. Seule porte vers l'API entreprises :
// swappable (Sirene INSEE…) sans toucher au reste du code. Miroir géo : geo.service.ts.
const API_URL = 'https://recherche-entreprises.api.gouv.fr/search';
const TIMEOUT_MS = 5000;

/**
 * Vrai si `siret` = exactement 14 chiffres avec une clé de Luhn valide (contrôle hors réseau).
 * Miroir client : frontend/lib/siret.ts — garder les deux synchronisés.
 * NB : les SIRET de La Poste (356 000 000 xxxxx) ne respectent pas Luhn — non géré (hors périmètre padel).
 */
export function siretIsValidFormat(siret: string): boolean {
  if (!/^\d{14}$/.test(siret)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = siret.charCodeAt(i) - 48; // '0' = 48
    // Luhn : on double un chiffre sur deux en partant de la droite (positions paires depuis la gauche pour 14 chiffres).
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

export interface SiretCheck {
  exists: boolean;       // un établissement correspond EXACTEMENT au SIRET fourni
  active: boolean;       // et son état administratif est « A » (ouvert)
  legalName: string | null;
  city: string | null;
}

interface ApiEtab { siret?: string; etat_administratif?: string; libelle_commune?: string }
interface ApiResult { nom_complet?: string; matching_etablissements?: ApiEtab[] }
interface ApiResponse { results?: ApiResult[] }

/**
 * Interroge recherche-entreprises.api.gouv.fr pour le SIRET donné. Ne throw JAMAIS :
 * renvoie `null` si l'API est injoignable/en erreur (→ le club se crée « non vérifié »).
 * `exists` est vrai seulement si un établissement matche exactement les 14 chiffres.
 */
export async function checkSiret(siret: string): Promise<SiretCheck | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${API_URL}?q=${encodeURIComponent(siret)}&per_page=1`, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const data = (await res.json()) as ApiResponse;
    const result = data.results?.[0];
    const etab = result?.matching_etablissements?.find((e) => e.siret === siret);
    // Aucun établissement ne matche exactement les 14 chiffres → SIRET introuvable.
    if (!etab) return { exists: false, active: false, legalName: result?.nom_complet ?? null, city: null };
    // Établissement trouvé : `exists` toujours vrai, `active` seulement si état administratif « A » (ouvert).
    // C'est createClub qui distingue SIRET_NOT_FOUND (!exists) de SIRET_INACTIVE (exists && !active).
    const open = etab.etat_administratif === 'A';
    return { exists: true, active: open, legalName: result?.nom_complet ?? null, city: etab.libelle_commune ?? null };
  } catch {
    return null;
  }
}
