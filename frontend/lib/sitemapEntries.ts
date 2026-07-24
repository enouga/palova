import type { MetadataRoute } from 'next';
import type { Tournament, ClubEvent } from './api';

/** Pages statiques d'un club (pures — indépendantes des données du club). */
export function clubStaticEntries(host: string): MetadataRoute.Sitemap {
  const base = `https://${host}`;
  return [
    { url: `${base}/`, priority: 1 },
    { url: `${base}/club`, priority: 0.8 },
    { url: `${base}/events`, priority: 0.7 },
    { url: `${base}/parties`, priority: 0.5 },
  ];
}

/** Tournois/events PUBLIÉS d'un club → entrées dynamiques du sitemap. */
export function clubDynamicEntries(host: string, tournaments: Tournament[], events: ClubEvent[]): MetadataRoute.Sitemap {
  const base = `https://${host}`;
  return [
    ...tournaments.filter((t) => t.status === 'PUBLISHED').map((t) => ({ url: `${base}/tournois/${t.id}`, priority: 0.6 })),
    ...events.filter((e) => e.status === 'PUBLISHED').map((e) => ({ url: `${base}/events/${e.id}`, priority: 0.6 })),
  ];
}

/** Pages statiques de l'hôte plateforme. */
export function platformEntries(host: string): MetadataRoute.Sitemap {
  const base = `https://${host}`;
  return [
    // `/` porte désormais AUSSI la découverte (parties/tournois/clubs filtrables) : l'ancienne
    // entrée `/decouvrir` y redirige et n'a plus de contenu propre à indexer.
    { url: `${base}/`, priority: 1 },
    { url: `${base}/tarifs`, priority: 0.6 },
    { url: `${base}/offres`, priority: 0.6 },
    { url: `${base}/faq`, priority: 0.4 },
    { url: `${base}/cgu`, priority: 0.2 },
    { url: `${base}/cgv`, priority: 0.2 },
    { url: `${base}/mentions-legales`, priority: 0.2 },
    { url: `${base}/confidentialite`, priority: 0.2 },
  ];
}
