# Lien vivant — carte OG dynamique du partage de partie

**Date :** 2026-07-02
**Statut :** design validé (à implémenter)

## Problème / opportunité

Le partage de partie v1 (spec `2026-07-01-partager-partie-ouverte-design.md`) produit un lien
`/parties/[id]` avec un aperçu Open Graph **générique** : titre + description texte + icône
carrée du club (`icon/512.png`). C'est déjà mieux que rien, mais c'est le niveau des
concurrents.

Analyse concurrentielle (2026-07) : chez **Playtomic**, rejoindre un match partagé exige
compte + application + paiement en ligne, et le lien envoyé est une carte générique qui pousse
vers le store. **Anybuddy** est centré réservation (pas de partie ouverte sociale), **TenUp**
n'a pas de partage viral. Or tout le padel français s'organise dans des **groupes WhatsApp** :
l'aperçu du lien y est vu par des dizaines de personnes à chaque partage.

**Le différenciateur choisi : le lien montre le match vivant.** L'aperçu WhatsApp devient une
**carte-image de l'état réel du match** (équipes gauche/droite avec avatars, places restantes,
niveau, date, couleurs du club), et le destinataire rejoint en 2 taps sans installer d'app
(déjà en place : liste publique, adhésion à la volée, inscription éclair `?next=`).

## Décisions (issues du brainstorming)

1. Direction validée : **A « lien vivant »** (image OG dynamique + rejoindre sans app),
   plutôt que B « invitation à place tenue » (v2 candidate) ou C « boucle de remplissage ».
2. L'image reflète l'état **au moment du partage** ; les vieux messages WhatsApp gardent
   l'aperçu vrai au moment de l'envoi (comportement assumé).
3. Aucune migration — tout est additif.

## Architecture

### 1. Backend — service de carte (`backend/src/services/matchCard.service.ts`, nouveau)

Calqué sur `icon.service.ts` (sharp, cache disque, replis silencieux).

**Source de données : `OpenMatchService.getOpenMatch(slug, id, null)`** (lecture anonyme
existante) — fournit déjà `resourceName`, `startTime`, `spotsLeft`, `full`,
`targetLevelMin/Max` et `players[]` avec `firstName`, `avatarUrl`, `team`, `slot`, `level`
(placement concret via `effectiveTeams`). Le club (name, `accentColor`, `logoUrl`,
`timezone`, `slug`) est chargé à part.

**`renderMatchCard(slug, matchId): Promise<{ filePath: string }>`** — PNG **1200×630** :

- **Fond** : dégradé aux couleurs du club (base `accentColor`, assombrie — même esprit que
  `HERO_GRADIENT`).
- **En-tête** : logo du club sur tuile blanche (réutilise le pattern `fetchLogo` d'icon.service :
  lecture disque `/uploads/...` avec garde anti-traversée, sinon fetch borné 5 s / 5 Mo) +
  nom du club + **date/heure FR** au fuseau du club (Luxon, ex. « sam. 5 juil. · 18h00–19h30 »).
- **Bloc central** : deux colonnes **Éq. 1 / Éq. 2** séparées par « VS ». Chaque équipe affiche
  `maxPlayers/2` cases (2 en double, 1 en single) dans l'ordre des `slot` : joueur présent →
  avatar rond (photo si `avatarUrl` commence par `/uploads/` — lecture disque, redimensionnée,
  masque circulaire ; sinon **initiales sur pastille colorée** via un miroir backend de
  `colorForSeed`) + prénom + niveau si disponible (« Niv. 6,2 ») ; place vacante → cercle
  pointillé « Libre ».
- **Bandeau bas** : « **2 places restantes · Niveau 6–7 · {slug}.palova.fr** » — ou badge
  « **Complet** » si `full`. La fourchette niveau n'apparaît que si `targetLevelMin/Max` non nuls
  (réutilise la logique de `rangeLabel`).
- **Texte** : composé en SVG puis rastérisé par sharp (même technique qu'icon.service).

**Miroir backend de `colorForSeed`** : nouveau petit module pur
`backend/src/utils/playerColors.ts` (constantes `PLAYER_COLORS` + hash FNV-1a), copie de
`frontend/lib/playerColors.ts`. ⚠️ Garder les deux synchronisés (même avertissement que
`slugify`/`lib/slug.ts`).

**Version d'état & cache disque.** Helper pur exporté
`matchCardStateHash(dto, accentColor, logoUrl): string` = md5 tronqué (12 hex) de
`RENDER_VERSION` + les champs qui influencent le rendu : joueurs (`userId`, `team`, `slot`,
`avatarUrl`), `spotsLeft`, `targetLevelMin/Max`, `startTime`, `endTime`, `resourceName`,
`accentColor`, `logoUrl`. Fichier cache : `uploads/ogcards/<matchId>-<hash>.png`
(`OGCARDS_DIR` ajouté à `src/utils/uploads.ts`, couvert par le volume prod
`backend_uploads`). À la génération d'un nouveau fichier, les autres `<matchId>-*.png` sont
supprimés (best-effort). Cache hit = aucune requête ni rendu.

**Repli embarqué.** Toute erreur (match introuvable/non-PUBLIC, rendu KO, police manquante…)
→ PNG statique neutre **1200×630** `backend/assets/og-card-fallback.png` (généré une fois par
le script `generate-pwa-icons.ts` étendu, ou un script frère), servi en 200. **Jamais de 500
face à un crawler.**

### 2. Backend — route

`GET /api/clubs/:slug/open-matches/:id/card.png` — **publique, sans auth** (les crawlers
WhatsApp/Facebook n'envoient pas de Bearer). Déclarée dans `clubs.ts` à côté du
`GET /:slug/open-matches/:id` existant (segment supplémentaire → aucun conflit avec
`unread-count`). Réponse : `Content-Type: image/png`,
`Cache-Control: public, max-age=300` (l'URL portant `?v=<hash>` change avec l'état, le TTL
court couvre le reste). Le paramètre `?v` n'est **pas interprété** (pur cache-busting).

### 3. Backend — `cardVersion` dans le DTO (additif)

`OpenMatchService.toDTO` expose un nouveau champ **`cardVersion: string`** =
`matchCardStateHash(...)` (le club — `accentColor`/`logoUrl` — est déjà résolu par les
appelants ; le select de `resolveActiveClub` est étendu à ces 2 champs + `slug`). Présent dans
`listOpenMatches` **et** `getOpenMatch` — forme de réponse existante inchangée par ailleurs.

### 4. Frontend — aperçu OG

`app/parties/[id]/page.tsx`, `generateMetadata` :

- `image = ${API_URL}/api/clubs/${slug}/open-matches/${id}/card.png?v=${match.cardVersion}`.
- `openGraph.images = [{ url: image, width: 1200, height: 630 }]`,
  `twitter.card = 'summary_large_image'`.
- Échec du fetch → repli neutre existant, inchangé (titre seul, pas d'image).

### 5. Frontend — URL de partage versionnée (contournement du cache WhatsApp)

WhatsApp fige l'aperçu **par URL partagée**. Les deux points de partage ajoutent donc un jeton
d'état à l'URL : **`/parties/{id}?s=<cardVersion>`**. Chaque partage à un état différent =
URL différente = re-crawl = image à jour. La page ignore `?s` (aucune lecture de
`searchParams` — déjà le cas).

- **Carte de liste** (`OpenMatchCard`) : URL = `${origin}/parties/${m.id}?s=${m.cardVersion}`.
- **Page détail** (`OpenMatchDetail`) : idem à partir de la partie chargée (ne pas utiliser
  `window.location.href` nu).

### 6. Frontend — texte de partage enrichi

Pour les canaux sans aperçu riche (SMS…), `navigator.share` reçoit aussi un `text`. Helper pur
**`matchShareText(match, clubName, timezone): string`** (nouveau module dédié
`frontend/lib/matchShare.ts`, testé) : « sam. 5 juil. · 18h00 · 2 places · Niveau 6–7 · {club} »
(mêmes briques que la description OG). `MatchShareButton` gagne une prop optionnelle
**`text?: string`** passée à `navigator.share({ title, text, url })` ; le repli presse-papier
continue de copier l'URL seule. La barre de la page détail (`ShareActions`) gagne deux props
optionnelles additives **`shareUrl?: string`** (remplace `window.location.href` au clic) et
**`shareText?: string`** (passé à `navigator.share`) — fiches tournoi/event inchangées
(props absentes = comportement actuel).

## Contrainte identifiée : polices dans sharp

librsvg rastérise le SVG avec les polices **système** : rendu différent entre Windows (dev) et
le conteneur prod (Alpine/Debian, parfois sans fontes). Mitigation : embarquer un fichier de
police (ex. sous-ensemble Inter/DejaVu) dans `backend/assets/fonts/` + fichier `fonts.conf`
et variable **`FONTCONFIG_PATH`** posée dans l'image Docker prod. En dev Windows, les polices
système suffisent (différence de rendu acceptée). Le repli embarqué couvre le cas « aucune
police » (texte absent → erreur sharp → PNG statique).

## Flux

```
Joueur ──[Partager]──► navigator.share({ title, text, url: /parties/{id}?s=abc123 })
                                    │
Groupe WhatsApp ◄───────────────────┘
   │ (crawler)                         │ (destinataire)
   ▼                                   ▼
generateMetadata                    /parties/[id] (page existante)
   og:image = card.png?v=abc123        └─ Rejoindre en 2 taps (existant)
   ▼
GET card.png → cache uploads/ogcards/<id>-abc123.png → rendu sharp si absent
```

## Gestion d'erreur

- Route carte : **toujours 200 image/png** (repli statique sur toute erreur).
- `generateMetadata` : inchangé (repli neutre, jamais de throw).
- Rendu : avatar illisible/manquant → pastille initiales ; logo en échec → tuile sans logo ;
  garde anti-traversée sur toute lecture `/uploads/...`.

## Tests

**Backend**
- `matchCard.service.test.ts` : `matchCardStateHash` stable (même état → même hash) et
  sensible (join/changement d'équipe/niveau → hash différent) ; `renderMatchCard` produit un
  PNG 1200×630 (vérifié via `sharp(buf).metadata()`) ; fichier cache créé, anciens
  `<matchId>-*.png` purgés ; hit de cache sans re-rendu ; erreur → repli.
- Route : `GET …/card.png` → 200 `image/png` sans token ; id inconnu → 200 PNG de repli.
- `openMatch.service.test.ts` : le DTO expose `cardVersion` (liste + lecture unitaire).
- `playerColors` backend : mêmes couleurs que le miroir front pour quelques seeds.

**Frontend**
- `matchShareText` : composition, singulier/pluriel des places, fourchette niveau absente.
- `MatchShareButton` : `text` transmis à `navigator.share` ; copie = URL seule.
- `OpenMatchCard` : l'URL partagée contient `?s=<cardVersion>`.
- Page `/parties/[id]` : `generateMetadata` renvoie l'`og:image` carte versionnée +
  `summary_large_image` (mock `api`).

## Hors périmètre (v2 candidates)

- **Invitation à place tenue** (option B du brainstorming) : lien nominatif qui réserve une
  place au destinataire avec expiration + attribution qui-invite-qui (socle du parrainage).
  S'appuiera sur ce même lien.
- Boucle de remplissage (relances ciblées amis/niveau à l'approche du créneau).
- QR code au club, image OG pour tournois/events, i18n EN de la carte.

## Fichiers touchés (indicatif)

- `backend/src/services/matchCard.service.ts` — **nouveau** (rendu + hash + cache).
- `backend/src/utils/playerColors.ts` — **nouveau** (miroir front).
- `backend/src/utils/uploads.ts` — `OGCARDS_DIR`.
- `backend/src/routes/clubs.ts` — route `card.png`.
- `backend/src/services/openMatch.service.ts` — `cardVersion` dans `toDTO`.
- `backend/assets/og-card-fallback.png` (+ script de génération) ; `backend/assets/fonts/` +
  `fonts.conf` (Docker prod).
- `frontend/lib/api.ts` — `OpenMatch.cardVersion`.
- `frontend/lib/matchShare.ts` — **nouveau** helper `matchShareText`.
- `frontend/app/parties/[id]/page.tsx` — og:image carte.
- `frontend/components/openmatch/MatchShareButton.tsx` — prop `text`.
- `frontend/components/tournament/ShareActions.tsx` — props `shareUrl`/`shareText`.
- `frontend/components/openmatch/{OpenMatchCard,OpenMatchDetail}.tsx` — URL `?s=`.
- Tests associés.
