// Géocodage d'adresses françaises via la Base Adresse Nationale (gratuit, sans clé).
// Seule porte vers le géocodeur : swappable sans toucher au reste du code.
const BAN_URL = 'https://api-adresse.data.gouv.fr/search/';
const TIMEOUT_MS = 5000;

export interface GeoResult {
  latitude: number;
  longitude: number;
  region: string | null;
  postalCode: string | null;
  city: string | null;
}

interface BanFeature {
  geometry: { coordinates: [number, number] };
  properties: { context?: string; postcode?: string; city?: string };
}
interface BanResponse { features?: BanFeature[] }

/** Géocode une adresse FR. Renvoie null si vide, indisponible ou en échec (jamais d'exception). */
export async function geocodeAddress(input: { address?: string | null; city?: string | null; postalCode?: string | null }): Promise<GeoResult | null> {
  const q = [input.address, input.postalCode, input.city].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
  if (!q) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${BAN_URL}?q=${encodeURIComponent(q)}&limit=1`, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const data = (await res.json()) as BanResponse;
    const f = data.features?.[0];
    if (!f) return null;
    const [lon, lat] = f.geometry.coordinates;
    if (typeof lat !== 'number' || typeof lon !== 'number') return null;
    // context = "75, Paris, Île-de-France" → région = dernier segment.
    const region = (f.properties.context ?? '').split(',').map((s) => s.trim()).filter(Boolean).pop() ?? null;
    return { latitude: lat, longitude: lon, region, postalCode: f.properties.postcode ?? null, city: f.properties.city ?? null };
  } catch {
    return null;
  }
}

/** Distance grand-cercle (km) entre deux points lat/lng. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
