# Logos du club multi-formats — icône carrée, logotype, variante sombre (spec)

**Date** : 2026-07-16
**Statut** : validé par Eric (brainstorming du 2026-07-16, maquettes comparées dans le companion visuel — piste B « Studio avec aperçus en contexte » retenue)

## Problème

L'admin uploade **un seul fichier logo** (Réglages → Identité, JPEG/PNG/WebP 2 Mo, stocké brut) qui alimente une douzaine de surfaces aux besoins contradictoires :

- des usages **« icône carrée »** : sidebar admin (34×34 — aujourd'hui en `objectFit:'cover'` → un logo horizontal est rogné, c'est le déclencheur de ce chantier), tuiles blanches (pages d'auth, vitrine club-house, carte OG de partie), icônes PWA ×5 (dérivées par `icon.service.ts`), icône de notification push, aperçus onboarding ;
- des usages **« logotype horizontal »** : ClubNav (hauteur 24 px), en-tête des 19 emails automatiques (36 px).

Trous constatés en plus du conflit de format :

1. le **favicon d'onglet** est toujours `/favicon.svg` Palova, même sur un sous-domaine club ;
2. le **badge de notification Android** (`sw.js`) est en dur `/icon-192.png` Palova **en couleur**, alors qu'Android l'affiche en silhouette → blob illisible ;
3. un logotype à encre sombre **disparaît en thème sombre** dans le ClubNav (posé directement sur le fond, sans tuile) ;
4. le fichier uploadé est **servi brut** (pas de redimensionnement, EXIF conservés), contrairement aux photos DM.

## Décisions de cadrage (figées avec Eric)

1. **Trois emplacements d'upload** : icône carrée (obligatoire), logotype horizontal (recommandé, repli sur l'icône), variante du logotype pour fond sombre (optionnelle, repliée derrière « Avancé »). Le badge monochrome et le favicon sont **dérivés automatiquement**, jamais uploadés.
2. **`logoUrl` devient officiellement l'icône carrée** — migration additive de 2 colonnes seulement, zéro renommage, zéro régression pour les clubs existants.
3. **Ré-encodage sharp à l'upload** (pattern photos DM) + **warnings non bloquants** mesurés sur l'image réelle.
4. **UI = piste B « studio »** : uploads à gauche, panneau d'aperçus en contexte à droite (brume bleue), mis à jour en direct.
5. **Les 4 correctifs inclus** dans cette feature (sidebar `contain`, favicon club, badge monochrome, consommation de la variante sombre) — sans eux les uploads ne servent à rien.

## 1 · Modèle de données

Migration additive **`add_club_logo_variants`** (dossier horodaté `prisma/migrations/` ; DEV via `prisma db execute` du SQL additif — jamais `db push`, dérive connue — ; prod `prisma migrate deploy`) :

```prisma
model Club {
  logoUrl         String?  // inchangé — désormais sémantiquement « icône carrée »
  logoWideUrl     String?  // NOUVEAU — logotype horizontal (fond clair)
  logoWideDarkUrl String?  // NOUVEAU — logotype horizontal pour fond sombre
}
```

**Règle de repli unique**, implémentée en un seul endroit côté front (`lib/clubLogos.ts`, helpers purs testés) et documentée pour le back :

| Usage | Source |
|---|---|
| Icône (pastilles, tuiles, PWA, push, favicon, carte OG) | `logoUrl` |
| Logotype en thème clair (ClubNav, emails) | `logoWideUrl ?? logoUrl` |
| Logotype en thème sombre (ClubNav) | `logoWideDarkUrl ?? logoWideUrl ?? logoUrl` |

Les emails utilisent **toujours** la version claire (fond blanc du gabarit). Les nouveaux champs sont exposés par `getClubBySlug` (public — le ClubNav lit `ClubDetail`) et `getClubForAdmin` ; types `ClubDetail`/`AdminClub` enrichis dans `lib/api.ts`. `updateClub` ne les écrit pas : comme `logoUrl` aujourd'hui, la persistance passe par les routes d'upload.

## 2 · Backend

### 2.1 Ré-encodage — nouveau module `backend/src/services/clubLogo.ts`

`processClubLogo(buffer, kind: 'icon' | 'wide' | 'wideDark')` → `{ png: Buffer, width, height, warnings: LogoWarning[] }` :

- **format réel** détecté via `sharp.metadata().format` (whitelist jpeg/png/webp — le mimetype client n'est plus source de vérité) ; fichier corrompu ou format non supporté → `VALIDATION_ERROR` ;
- `.rotate()` (orientation EXIF appliquée) puis ré-encodage **sans métadonnées** (EXIF/GPS/ICC retirés) ;
- redimensionnement plafonné `fit:'inside', withoutEnlargement:true` : icône → 1024×1024 ; logotypes → 1600×320 ;
- **sortie PNG systématique** : transparence préservée et compatible Outlook (les emails consomment `logoWideUrl` ; WebP n'y passe pas).

**Warnings** (codes, jamais bloquants, mesurés sur l'image source avant redimensionnement) :

| Code | Condition | Emplacements |
|---|---|---|
| `NOT_SQUARE` | ratio grand/petit côté > 1,05 | icône |
| `TOO_SMALL` | icône : min(côtés) < 512 ; logotypes : hauteur < 160 | tous |
| `LOOKS_SQUARE` | ratio largeur/hauteur < 1,5 | logotypes |

Le front mappe les codes en messages français (« Votre image n'est pas carrée — elle sera affichée dans un carré », « Image trop petite, elle risque d'être floue », « Cette image semble carrée — utilisez plutôt l'emplacement icône »).

### 2.2 Routes admin (dans `admin.ts`, multer `logoUpload` 2 Mo existant)

- **`POST /club-logo/:variant?`** — `variant` absent = icône ; `wide` | `wide-dark` ; autre valeur → 404. Ré-encode, écrit `uploads/logos/<clubId>-<kind>-<ts>.png`, supprime l'ancien fichier de ce champ (garde anti-traversée : uniquement sous `LOGOS_DIR`), persiste la colonne correspondante immédiatement. Réponse : `{ logoUrl | logoWideUrl | logoWideDarkUrl, warnings }`.
- **`DELETE /club-logo/wide`** et **`DELETE /club-logo/wide-dark`** — remet la colonne à `null`, supprime le fichier (best-effort), idempotent (200 même si déjà vide). **L'icône n'est pas supprimable** (remplaçable seulement — parité avec aujourd'hui, le repli initiale/Palova existe déjà pour les clubs qui n'ont jamais rien uploadé).

Front : `api.uploadClubLogo` gagne un paramètre de variante (rétro-compatible), + `api.deleteClubLogoVariant`.

### 2.3 Badge de notification monochrome — `icon.service.ts`

Nouvelle variante **`badge-96`** dans `ICON_VARIANTS` (96×96, fond transparent, `markRatio` ~0,9) avec un flag `monochrome` :

- rendu = silhouette **blanche** dérivée du **canal alpha** de l'icône (`ensureAlpha` → canal alpha appliqué à un aplat blanc) ;
- **icône sans transparence réelle** (JPEG/PNG à fond plein — alpha uniformément opaque via `stats()`) → repli sur le **badge Palova embarqué** (`assets/pwa/icon-badge-96.png`, nouvel asset à générer par `generate-pwa-icons.ts`) — jamais un carré blanc plein ;
- servi par la route existante `GET /api/clubs/:slug/icon/badge-96.png` (la route valide contre `ICON_VARIANTS`, rien à ajouter) ; repli Palova si pas de logo/erreur, comme les autres variantes ;
- `RENDER_VERSION` incrémenté (invalidation du cache disque).

### 2.4 Push — icône + badge

`push.ts` : à côté de `resolvePushIcon` (WIP existant sur la branche — cette spec se pose dessus), ajouter **`resolvePushBadge(clubId)`** → URL absolue de `badge-96.png` du club (repli asset Palova hors contexte club). `PushPayload` gagne `badge?: string | null`, le dispatcher le transmet, et **`sw.js`** utilise `badge: data.badge || '/icon-192.png'` (repli actuel conservé pour les payloads anciens).

### 2.5 Emails

`brandFromClub` (dans `notifications.ts`) et `loadBrand` (`emailTemplate.service.ts`) : le logo de marque devient **`logoWideUrl ?? logoUrl`** (URL absolue comme aujourd'hui) ; les `select` Prisma correspondants ajoutent `logoWideUrl`. Rendu du gabarit inchangé (36 px de haut).

## 3 · Correctifs de consommation

1. **Sidebar admin** (`app/admin/layout.tsx`) : le logo passe de `34×34 objectFit:'cover'` à une **tuile blanche arrondie 34×34** avec le logo en `contain` (~28 px) — même langage que les tuiles des pages d'auth. Repli initiale inchangé.
2. **Favicon par club** (`app/layout.tsx`, `generateMetadata`) : `icons.icon` = `${API_URL}/api/clubs/:slug/icon/192.png` sur un hôte club, `/favicon.svg` Palova sinon.
3. **ClubNav** : le logo affiché devient `wideLogo(club, th.mode)` (repli en cascade du §1). Rendu (hauteur 24, `contain`) et repli `logoFailed` → Logotype Palova inchangés.
4. **Badge push** : §2.3 + §2.4.

## 4 · Interface — carte « Logos du club » (Réglages → Identité)

Le bloc « Logo du club » actuel de `SettingsIdentity.tsx` est remplacé par une carte studio **2 colonnes** (pattern CSS `.pl-create-grid`, empilée < 700 px) — nouveau composant **`components/admin/settings/LogoStudio.tsx`** :

### Colonne gauche — les 3 emplacements

Chaque emplacement affiche : aperçu du fichier actuel (tuile 72×72 `contain` pour l'icône, bandeau pour les logotypes), **badge d'état**, **une phrase d'usage**, **chips de specs**, boutons.

| Emplacement | État/badges | Phrase d'usage | Chips | Actions |
|---|---|---|---|---|
| **Icône carrée** (obligatoire) | « En place ✓ » ; warning persistant si l'image actuelle n'est pas carrée (mesure client `naturalWidth/Height`) | « Le symbole seul, sans texte fin — app installée, notifications, favicon, pastilles » | PNG/WebP · Carré ≥ 512 px · Fond transparent | Changer |
| **Logotype horizontal** (recommandé) | « Recommandé » tant qu'absent | « Votre logo avec le nom — bandeau du site et en-tête des emails. À défaut : l'icône » | PNG/WebP · Hauteur ≥ 160 px · Fond transparent | Ajouter/Changer · Retirer |
| **Version fond sombre** (replié derrière « Avancé ▸ ») | — | « Si votre logotype est sombre, il disparaît en thème sombre — uploadez une version claire » | mêmes chips | Ajouter/Changer · Retirer |

Les **warnings serveur** de l'upload s'affichent sous l'emplacement concerné (bandeau apricot, non bloquant). « Retirer » passe par le `ConfirmDialog` existant. Uploads **immédiats** (pattern `syncImage` actuel : met à jour `server` ET `draft`, jamais de brouillon dirty, aucune interaction avec la SaveBar). Un état `uploading` par emplacement.

### Colonne droite — aperçus en direct (brume bleue `HERO_GRADIENT`)

Panneau qui **montre** chaque logo là où il vit, en consommant la vraie règle de repli de `lib/clubLogos.ts` — l'admin voit immédiatement ce que produit chaque upload et ce qui manque :

1. **Bandeau du site** — deux mini-bandeaux, thème clair et thème sombre (le sombre révèle l'intérêt de la variante) ;
2. **Écran d'accueil du téléphone** — tuile d'app (icône sur fond `accentColor`, coins arrondis, nom court dessous) ;
3. **Notification** — rangée factice avec l'icône ;
4. **En-tête email** — logotype centré sur carte blanche.

Aperçus construits en CSS pur à partir des URLs des 3 champs (pas d'appel aux routes d'icônes dérivées — approximation fidèle suffisante).

### Reste de l'onglet

Couverture et couleur d'accent **ne bougent pas**. L'étape Identité du **wizard d'onboarding** garde son upload unique (= l'icône) avec la consigne reformulée (« l'icône carrée de votre club — PNG transparent conseillé ») ; le studio complet reste dans Réglages.

### Helpers purs `frontend/lib/clubLogos.ts` (testés)

- `iconLogo(club)`, `wideLogo(club, mode)` — la cascade de replis du §1 ;
- `LOGO_WARNING_LABEL: Record<LogoWarning, string>` — mapping des codes serveur ;
- `clientRatioWarning(w, h, kind)` — miroir client des seuils du §2.1 pour le warning persistant sur l'icône en place.

## 5 · Tests

**Backend** : `clubLogo` (détection de format réel, rejet corrompu, resize plafonné, transparence préservée, warnings ×3, EXIF retirés) ; `icon.service` (variante `badge-96` : silhouette depuis alpha, repli sans-alpha, repli sans-logo, cache versionné) ; routes `admin.club-logo` (upload ×3 variantes, persistance de la bonne colonne, suppression de l'ancien fichier, DELETE ×2 idempotents, variante inconnue 404, icône non supprimable) ; `club.service` (nouveaux champs dans les selects) ; `notifications`/`emailTemplate.service` (brand = wide ?? logoUrl) ; `push` (badge dans le payload).

**Frontend** : `clubLogos` (cascade de replis, mapping warnings, seuils ratio) ; `LogoStudio` (3 emplacements, upload par variante, warnings affichés, Retirer confirmé, replié « Avancé ») ; `ClubNav` (variante sombre choisie en floodlit, cascade) ; `AdminSettings` (studio monté dans l'onglet Identité) ; `AdminLayout` (tuile `contain`). ⚠️ suites *real-mount* : tout nouvel appel `api.*` doit être mocké dans les suites voisines (classe de casse connue).

**Vérification visuelle** (CDP) : clair + sombre, desktop 1280 + mobile 390 (studio empilé, aucun débordement horizontal) ; favicon et badge vérifiés sur le club seedé `padel-arena-paris`.

## Hors périmètre (parqué)

- **Image OG générique du club** (partage WhatsApp du club-house — dérivable cover + logo, chantier séparé) ;
- upload **SVG** (question XSS du SVG servi statiquement — compensé par la conso ≥ 512/1024 px) ;
- ré-encodage des **logos sponsors** (circuit distinct) ;
- **éditeur/recadrage** d'image intégré ;
- suppression complète de l'icône (remplaçable seulement) ;
- rétro-traitement des logos déjà en base (ils restent servis tels quels tant que l'admin ne re-uploade pas).
