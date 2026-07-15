# Largeur desktop des pages joueurs — 820 → 1080 px

**Date** : 2026-07-15
**Statut** : validé (design approuvé par Eric, à planifier)

## Contexte

Toutes les pages joueurs partagent la coquille `frontend/components/ui/Screen.tsx` : une colonne
centrée plafonnée à **820 px** (`maxWidth: 820`), pleine largeur en mobile. 18 fichiers l'utilisent
(club-house `app/page.tsx`, Réserver, Parties + fiche, Events + fiches, fiche tournoi, profil,
mes réservations, messages, amis, mes matchs, /clubs, /club, courts/[id], cours/[id],
PlatformLanding, AnonymousView). Le `ClubNav` collant vit **dans** le Screen.

En desktop, 820 px donne une impression d'« appli mobile étirée » : marges géantes, grilles de
cartes serrées en 2 colonnes, split messages étroit.

## Décision

**Cap unique porté à 1080 px, uniforme sur toutes les pages joueurs.** Pas de largeur par page :
le `ClubNav` étant dans le Screen, deux largeurs feraient sauter la barre de navigation d'une page
à l'autre. Les contenus qui doivent rester étroits (formulaires, texte long) gardent ou reçoivent
un **clamp interne au contenu** (~680–760 px centré), pas au shell.

Pourquoi 1080 (et pas 960 ou 1200) : sur un écran 1366 px il reste ~140 px de marge de chaque
côté ; sur 1920 px la page respire sans flotter ; les grilles déjà en `auto-fill`/`grid`
(créneaux, offres, cartes) passent naturellement à 2-3 colonnes ; cohérent avec le superadmin
(main à 1100). 1200 étire les sections mono-colonne et les lignes de texte.

## Changements

1. **`Screen.tsx`** : `maxWidth: 820` → `1080` (+ docstring qui mentionne 820). Mettre à jour le
   commentaire de `globals.css` (~ligne 17, « colonne max-width 820 »).
2. **Passe de vérification visuelle** de toutes les pages joueurs, avec ajustements ciblés là où
   ça s'étire mal (liste indicative, à juger à l'écran) :
   - `OpenMatches` : la grille 2 colonnes est explicitement calibrée « le Screen fait 820px »
     (commentaire dans le code) → envisager 3 colonnes quand la place le permet.
   - `/me/profile` : clamp interne (~720 px) sur la colonne de formulaire si elle s'étire.
   - Autres pages formulaire/lecture (mes réservations, amis…) : clamp interne au besoin.
3. **`TournamentFinder` (`/tournois`, hôte plateforme)** : aujourd'hui rendu **sans aucun cap**
   (pleine largeur fenêtre) — outlier pré-existant. L'envelopper dans `Screen` pour l'aligner sur
   le cadre unique.
4. **Mobile : zéro changement** (le viewport mobile est déjà sous les deux plafonds).

## Hors périmètre

- Back-office `/admin` (layout sidebar + caps par page) et `/superadmin` (1100).
- `AuthShell` (écran scindé auth), `ContentShell` (pages contenu, 800), `/me/notifications`
  (container 640 propre, déjà « clamp interne » de fait).
- Largeurs des modales/feuilles (`BookingModal` 480, dialogs 440–520…) : inchangées.

## Vérification

- CDP clair + sombre ; desktop **1280** et **1440–1920** ; mobile **390** en non-régression
  (`scrollWidth ≤ viewport` partout — piège d'émulation : `mobile:false` + width fixe).
- Pages à vérifier : club-house, /reserver (vues cartes + grille), /parties, /events,
  fiche tournoi + fiche event, /me/profile, /me/reservations (3 onglets), /me/messages,
  /me/friends, /clubs, vitrine anonyme, /tournois (calendrier national).
- Suites front existantes vertes (aucun test ne dépend de la valeur 820 — vérifié par grep).

## Risques

Des composants ont pu être calibrés implicitement pour 820 (heros, kiosque d'annonces, rails
snap-scroll, grille planning des créneaux) : la passe visuelle systématique est la garde. Tout
ajustement reste 100 % frontend, aucune migration, aucun changement backend.
