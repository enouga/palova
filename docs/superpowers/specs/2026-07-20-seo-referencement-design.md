# SEO — crawlabilité, métadonnées par page, image sociale de marque

**Date** : 2026-07-20
**Statut** : spec validée, plan à écrire

## Contexte

Un audit a relevé 3 manques SEO sur Palova :
- Pas de `robots.txt` ni de `sitemap.xml` — rien ne dit à Google quoi crawler/indexer, ni où trouver les pages.
- L'Open Graph (aperçu de lien riche) n'existe que sur le partage d'une partie ouverte (`/parties/[id]`, carte dynamique 1200×630 déjà en prod). Toutes les autres pages partagées (club-house, fiche tournoi, fiche event…) n'ont aucun aperçu.
- Toutes les pages de tous les clubs partagent le même titre/description génériques posés dans `app/layout.tsx` (`"Palova"` / `"Réservez votre terrain de padel en quelques secondes"`) : seul `app/parties/[id]/page.tsx` définit ses propres métadonnées aujourd'hui — c'est le seul fichier de tout `app/` qui exporte `generateMetadata` en dehors du layout.

Palova est **multi-tenant par sous-domaine** : chaque club a son hôte (`{slug}.palova.fr`), en plus de l'hôte plateforme (`palova.fr`/`palova.app`). Ça structure toute la conception ci-dessous — un `robots.txt`/`sitemap.xml` par hôte, pas un seul global.

## Objectifs

1. Un `robots.txt` et un `sitemap.xml` par hôte (club et plateforme), cohérents avec ce qui est réellement public sans connexion (`lib/authGate.ts`).
2. Titre + description propres à chaque page publique à fort trafic (au lieu du texte générique hérité du layout).
3. Une image Open Graph de marque (logo + couleur du club) sur les pages qui n'en ont pas aujourd'hui, en plus de la carte dynamique déjà existante pour les parties ouvertes.
4. Éviter le contenu dupliqué en masse : plusieurs pages (CGU/CGV/mentions légales/confidentialité/aide/FAQ) utilisent un **gabarit de repli Palova générique** quand le club n'a rien personnalisé (documenté dans CLAUDE.md, section « Club-house v2 » et « Conformité légale ») — des centaines de clubs auraient alors un texte quasi identique. Ces pages sont exclues de l'indexation.

## Non-objectifs (hors périmètre, assumé)

- Pas de carte OG dynamique par entité (nom d'event/tournoi incrusté dans l'image) — seulement une carte de marque générique par club, réutilisée sur toutes ses pages sauf les parties ouvertes (qui gardent leur carte dynamique existante).
- Pas de sitemap listant les parties ouvertes (`/parties/[id]`) — contenu éphémère, aucune valeur de référencement durable. Ces pages restent crawlables/partageables (l'aperçu de lien doit continuer à marcher) mais passent en `noindex`.
- Pas de sitemap plateforme qui référence les sous-domaines clubs (chaque hôte reste maître de son propre sitemap — cf. décision multi-tenant ci-dessous).
- Pas de traduction/i18n des métadonnées (tout reste en français, comme le reste du site).
- Pas de vérification Search Console / soumission — ce sont des actions manuelles pour Eric après déploiement (checklist en fin de doc).

## Architecture générale

Trois briques, additives, aucune migration :

1. **Crawlabilité** — `app/robots.ts` + `app/sitemap.ts`, routes Next dynamiques par hôte.
2. **Métadonnées par page** — helper `lib/seo.ts` + conversion de 6 pages client en paire serveur/client (pattern déjà en prod sur `app/parties/[id]/page.tsx`), + 2 pages déjà serveur qui gagnent une métadonnée.
3. **Image OG de marque** — extension d'`icon.service.ts` (backend) avec une nouvelle variante non carrée, servie par la route d'icônes existante.

## 1. Crawlabilité — `robots.ts` + `sitemap.ts`

### Résolution de l'hôte

Comme `app/manifest.ts` : le matcher du proxy exclut les chemins avec une extension de fichier statique (`.txt`/`.xml` compris, cf. le correctif documenté dans CLAUDE.md section « Emails admin »), donc `robots.txt`/`sitemap.xml` ne reçoivent jamais `x-club-slug`. Les deux fichiers résolvent le slug directement depuis l'en-tête `Host` via `clubSlugFromHost(host, ROOT_DOMAINS)` — même technique, mêmes imports que `manifest.ts`.

### `app/robots.ts`

Type `MetadataRoute.Robots`, une règle `{ userAgent: '*' }` avec `allow`/`disallow`, + `sitemap: 'https://{host}/sitemap.xml'`.

**Hôte club** (slug résolu) :
- `allow` : `/`, `/club`, `/events`, `/events/*`, `/tournois/*`, `/parties`, `/register`, `/clubs/new`
- `disallow` : `/reserver`, `/cours`, `/me`, `/admin`, `/superadmin`, `/login`, `/forgot-password`, `/session-bridge`, `/clubs`, `/cgu`, `/cgv`, `/mentions-legales`, `/confidentialite`, `/offres`, `/aide`, `/faq`

**Hôte plateforme** (pas de slug) :
- `allow` : `/`, `/decouvrir`, `/tarifs`, `/offres`, `/faq`, `/cgu`, `/cgv`, `/mentions-legales`, `/confidentialite`, `/register`, `/clubs/new`
- `disallow` : `/login`, `/forgot-password`, `/clubs`, `/me`, `/admin`, `/superadmin`, `/session-bridge`, `/tournois`, `/aide`

Notes :
- `/tournois` (chemin nu) est aujourd'hui un pur stub de redirection côté client (`router.replace` vers `/events?filtre=competitions` ou `/decouvrir#tournois` selon l'hôte, vérifié dans le code — la page ne rend jamais de contenu) : jamais linké en interne, laissé en l'état, juste absent du sitemap.
- `/parties/[id]` reste **crawlable** (pas de `disallow`) — bloquer via robots.txt casserait la récupération d'aperçu par les crawlers sociaux (WhatsApp/Facebook) qui l'utilisent pour l'unfurling de lien. L'exclusion de l'indexation se fait via une balise `robots: noindex` au niveau de la page (§2), pas via robots.txt.
- **Correction par rapport à la 1ʳᵉ présentation** : `/faq` est ajoutée au `disallow` de l'hôte club — omise par erreur dans la première passe alors qu'elle partage exactement le même risque de contenu dupliqué que CGU/CGV (gabarit `PLATFORM_FAQ` interpolé, cf. CLAUDE.md « Club-house v2 »). Sur l'hôte plateforme, `/faq` reste indexée (copie unique, canonique).

### `app/sitemap.ts`

Type `MetadataRoute.Sitemap`. Même résolution d'hôte. Toute erreur de fetch (club introuvable/suspendu, API indisponible) → repli sur un sitemap minimal (`/` seul), jamais d'exception — même posture défensive que `manifest.ts`.

**Hôte club** :
- Statique : `/`, `/club`, `/events`, `/parties`
- Dynamique : `api.getClubTournaments(slug)` filtré `status === 'PUBLISHED'` → `/tournois/{id}` ; `api.getClubEvents(slug)` filtré `status === 'PUBLISHED'` → `/events/{id}`. Mêmes fonctions déjà utilisées côté client par ces pages — pas de nouvel endpoint.

**Hôte plateforme** :
- Statique uniquement : `/`, `/decouvrir`, `/tarifs`, `/offres`, `/faq`, `/cgu`, `/cgv`, `/mentions-legales`, `/confidentialite`.

`lastModified` omis (champ optionnel) sauf s'il existe une donnée triviale à réutiliser (à trancher à l'implémentation) ; `priority` indicatif (1 pour la page d'accueil, dégressif ensuite) — impact SEO réel faible aujourd'hui, mais champ standard du type Next.

## 2. Métadonnées par page

### Helper partagé `frontend/lib/seo.ts` (nouveau)

```ts
clubTitle(page: string, clubName: string): string        // "{page} · {clubName}"
platformTitle(page: string): string                       // "{page} | Palova"
canonicalFor(slug: string | null, path: string): string | undefined
  // même règle que layout.tsx (`https://{slug}.${CANONICAL_ROOT}${path}`), mais autonome :
  // chaque page calcule son propre canonical plutôt que de compter sur la fusion de
  // métadonnées Next parent/enfant.
clubOgImage(slug: string): string                          // `${API_URL}/api/clubs/${slug}/icon/og.png`
PLATFORM_OG_IMAGE: string                                   // '/og-default.png' (asset statique, §3)
```

### Pattern de conversion (6 pages)

Toutes ces pages sont aujourd'hui des `page.tsx` **`'use client'`** — structurellement incompatibles avec `generateMetadata` (réservé aux composants serveur). Chacune est scindée en :
- `{route}/page.tsx` — nouveau composant **serveur**, fait le fetch de métadonnées + rend le composant client, exact pattern de `app/parties/[id]/page.tsx` déjà en prod.
- `{route}/*Client.tsx` — contenu actuel déplacé tel quel (aucune logique changée), co-localisé dans le même dossier de route.

| Route | Titre | Description | Fetch |
|---|---|---|---|
| `/` (hôte club) | `"{ClubName} — Réservez un terrain de padel"` | extrait de la présentation, sinon accroche générique | `getClub(slug)` |
| `/` (hôte plateforme) | `"Palova — Réservez votre terrain de padel en ligne"` | copie générique actuelle, conservée | — |
| `/club` | `clubTitle('Le club', name)` | extrait de la présentation | `getClub` + `getClubPresentation` |
| `/events` | `clubTitle('Tournois & animations', name)` | accroche générique par club | `getClub` |
| `/events/[id]` | `clubTitle(event.name, name)` | date · type · places (même style de jointure que `parties/[id]`) | `getEvent(id)` |
| `/tournois/[id]` | `clubTitle(tournament.name, name)` | date · catégorie/genre · places | `getTournament(id)` |
| `/decouvrir` | statique, sans fetch | "Trouvez un club de padel près de chez vous" | — |

Chaque page pose son `alternates.canonical` (via `canonicalFor`) et un bloc `openGraph`/`twitter` avec `clubOgImage(slug)` (ou `PLATFORM_OG_IMAGE` sur l'hôte plateforme).

### Pages déjà serveur (pas de scission nécessaire)

- `/faq` : gagne un `generateMetadata` (titre `clubTitle('FAQ', name)` sur hôte club, `platformTitle('FAQ')` sinon). Utile pour l'onglet navigateur/le partage même si `robots.txt` bloque l'indexation côté club (§1) — l'amélioration ne vaut vraiment pour le classement que sur l'hôte plateforme.
- `/tarifs` : `export const metadata` statique (`platformTitle('Tarifs')` + description), contenu identique quel que soit l'hôte, pas de fetch.

### Édition d'un fichier existant

`app/parties/[id]/page.tsx` : ajoute `robots: { index: false, follow: true }` sur les deux branches (succès et repli) de son `generateMetadata` déjà en place. Comportement de partage inchangé (carte OG, titre, description) — seul l'ajout empêche l'indexation Google d'un créneau éphémère.

## 3. Image Open Graph de marque

### Backend — extension d'`icon.service.ts`

Nouvelle fonction `renderOgCard(logo: Buffer, accentColor: string, clubName: string): Promise<Buffer>` : canevas 1200×630 fond `accentColor`, logo centré en `fit:'contain'` (même technique que `renderIcon`), + nom du club en overlay texte blanc/lisible via composition SVG+sharp (même technique déjà en prod dans `matchCard.service.ts` — police DejaVu déjà installée côté serveur). Nouvelle méthode `IconService.getClubOgCardPath(slug): Promise<string | null>` — même flux que `getClubIconPath` (résolution club, cache disque content-addressé par hash de `logoUrl`, écriture) mais avec un repli différent : **`backend/assets/og-card-fallback.png` existant** (déjà utilisé comme repli par `matchCard.service.ts`, déjà à la bonne taille 1200×630, aucun nouvel asset graphique à produire) au lieu d'une icône Palova carrée.

### Route

`GET /:slug/icon/:file` (route existante, `backend/src/routes/clubs.ts:809`) : cas spécial pour `file === 'og.png'` qui appelle `getClubOgCardPath` au lieu de la table `ICON_VARIANTS`. Un seul endpoint, cohérent avec les variantes existantes (192/512/maskable/apple-180).

### Image par défaut plateforme

`backend/assets/og-card-fallback.png` copié tel quel vers `frontend/public/og-default.png` — asset déjà designé, servi nativement par Next en statique, référencé par `PLATFORM_OG_IMAGE` dans `lib/seo.ts`. Aucun nouveau travail graphique.

### Limite connue, assumée

Comme les icônes PWA existantes, l'URL `/api/clubs/{slug}/icon/og.png` ne change pas quand le club change son logo (seul le nom de fichier du cache disque change, via le hash). Un crawler social (WhatsApp/Facebook) qui a déjà mis l'image en cache par URL peut donc continuer à servir un aperçu périmé un moment. Tradeoff déjà accepté aujourd'hui pour les icônes PWA — pas retravaillé ici.

## Tests

**Backend** :
- `icon.service.test.ts` — nouveaux cas `renderOgCard`/`getClubOgCardPath` (avec logo, sans logo → repli fallback, logo injoignable → repli fallback).
- `clubs.routes` (test existant du fichier de routes club) — nouveau cas `GET /:slug/icon/og.png`.

**Frontend** :
- `seo.test.ts` (nouveau) — `clubTitle`/`platformTitle`/`canonicalFor`, purs.
- Un bloc `generateMetadata` par page convertie (même pattern que le test déjà existant sur `parties/[id]`) : titre/description/canonical/OG corrects, repli propre si le fetch échoue.
- `robots.test.ts` / `sitemap.test.ts` (nouveaux) — règles par hôte (club vs plateforme), entrées dynamiques du sitemap club (événements/tournois publiés seulement), repli minimal si l'API échoue.
- `parties/[id]` — cas existant étendu : `robots.index === false` dans les deux branches.

## Déploiement

100 % additif : aucune migration, aucun endpoint existant modifié en profondeur (seul ajout d'un cas dans une route déjà publique), aucun changement de comportement visible pour un utilisateur connecté. Seul changement de comportement observable : `/parties/[id]` n'apparaîtra plus dans les résultats Google (comportement voulu), et les 7 pages listées en `disallow` club (CGU/CGV/mentions-légales/confidentialité/offres/aide/FAQ) ne seront plus crawlées par les moteurs respectueux de robots.txt.

**Vérification manuelle après implémentation** : `curl` sur `/robots.txt` et `/sitemap.xml` en local, hôte club **et** hôte plateforme ; vérification visuelle navigateur de `/api/clubs/{slug}/icon/og.png`.

**Checklist hors-code (Eric, après mise en prod)** :
- Vérifier/créer une propriété de **domaine** `palova.fr` dans Google Search Console (couvre tous les sous-domaines clubs automatiquement, contrairement à une propriété par préfixe d'URL).
- Soumettre le sitemap de l'hôte plateforme dans Search Console.
- Rien à soumettre manuellement pour les sitemaps par club — Google les découvre via la ligne `Sitemap:` de chaque `robots.txt` au fil du crawl.
