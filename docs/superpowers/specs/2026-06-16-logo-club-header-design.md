# Logo du club dans le header (fallback Palova)

## Contexte

Toute l'infrastructure de logo club existe déjà :
- DB : `club.logoUrl` (`schema.prisma:162`)
- Backend : route d'upload `POST /club-logo` (persiste `club.logoUrl`, nettoie l'ancien fichier)
- API client : `uploadClubLogo`
- UI admin : section « Logo du club » avec upload + aperçu (`app/admin/settings/page.tsx`)
- Type front : `logoUrl` exposé dans `ClubDetail`

**Seul manque l'affichage public** : `ClubNav` (header présent sur toutes les pages
d'un sous-domaine club) affiche toujours le `Logotype` Palova, qui sert aussi de lien
« retour plateforme ».

## Objectif

Afficher le logo du club dans le header quand il est renseigné ; sinon, retomber sur
le logo Palova (comportement actuel).

## Comportement

Slot de gauche de `ClubNav` (rangée 1) :
- `club.logoUrl` renseigné → image du logo club, lien vers `/` (accueil du club).
- `club.logoUrl` absent (`null`) → `Logotype` Palova, exactement comme aujourd'hui.

Le nom du club (`club.name`) reste affiché à droite du logo, inchangé.

Retour plateforme : déjà assuré par l'entrée « Mes clubs » du menu profil
(`ProfileMenu.tsx:145` → `platformUrl('/clubs')`). Aucun ajout nécessaire ; on ne perd
aucune navigation en retirant le lien plateforme du logo de gauche.

## Rendu

- Logo **nu**, sans fond : `<img src={assetUrl(club.logoUrl)} alt={club.name}>`,
  hauteur ~24 px, `object-fit: contain`, largeur auto, `flex-shrink: 0`.
- L'image est enveloppée dans un lien (`Link`) vers `/`.

## Robustesse

- `onError` sur l'`<img>` → bascule vers le `Logotype` Palova via un état local
  (`logoFailed`). Couvre le cas d'un fichier logo supprimé / 404.

## Hors périmètre (YAGNI)

- Pas d'affichage du logo ailleurs (club-house, e-mails) pour l'instant.
- Pas de nouveau composant partagé tant qu'il n'y a qu'un seul point d'usage
  (rendu inline dans `ClubNav`).

## Tests (`__tests__/ClubNav.test.tsx`, déjà existant)

- `logoUrl` présent → l'`<img>` du logo club est rendue avec le bon `src` ; le
  wordmark Palova n'est pas affiché.
- `logoUrl === null` → le `Logotype` Palova est rendu (fallback).
- `onError` sur l'image → bascule sur le `Logotype` Palova.
