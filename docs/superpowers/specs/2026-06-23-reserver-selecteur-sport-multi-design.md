# Réserver : sélecteur de sport discret, multi-sports, défaut = sport préféré

**Date :** 2026-06-23
**Périmètre :** frontend uniquement (`frontend/components/ClubReserve.tsx` + un composant `SportPicker`)
**Statut :** validé en brainstorming, prêt pour plan d'implémentation

## Problème

Sur la page **Réserver** (`ClubReserve.tsx`), le choix du sport se fait via une **rangée de pastilles** (`PillTabs`) affichée en permanence quand le club a plusieurs sports. Trois irritants :

1. **Encombrant.** Juste sous la bande de dates (qui défile déjà), une 2ᵉ rangée de pastilles alourdit l'écran ; on n'a pas besoin d'afficher tous les sports en permanence.
2. **Défaut imparfait.** Le filtre applique bien le sport préféré (`ClubReserve.tsx:92-99`), mais **après** chargement : il montre d'abord `clubSports[0]`, puis bascule sur le sport préféré → **saut visuel** (la section affichée change).
3. **Mono-sport.** On ne peut voir qu'un sport à la fois, alors que la disponibilité de **tous** les sports est déjà chargée en mémoire.

## Objectifs

- **Retirer la rangée de pastilles.** La grille du **sport préféré** s'affiche directement, sans sélecteur visible permanent.
- **Défaut net.** Pré-sélectionner le sport préféré dès le départ, **sans saut ni double affichage**.
- **Multi-sélection.** Un lien discret « changer » ouvre une **liste à cocher** ; cocher plusieurs sports affiche **une section de grille par sport**.
- **Mémoriser** la sélection par club.

## Ce qui existe déjà (et qu'on réutilise tel quel)

Lecture de `ClubReserve.tsx` :

- `reloadAll()` (`:108-110`) **charge déjà la disponibilité de TOUS les `clubSports`** dans `availBySport` (indépendamment de la sélection). → **aucun changement de chargement de données nécessaire.**
- La grille (`:188-256`) rend une **section par sport** via `club.clubSports.filter(...).map((cs) => …)`. Chaque section gère **déjà** : son sélecteur de durée (`PillTabs` durées), ses terrains, ses créneaux, ses prix, le statut « Aucun terrain ». Le `.map` est simplement **filtré à un seul sport** aujourd'hui (`cs.id === selectedSportId`).
- Le titre de section (nom + icône du sport) s'affiche déjà, mais seulement si `club.clubSports.length === 1` (`:195-197`).
- Le lien profond (`:121-133`) appelle `setSelectedSportId(cs.id)` pour révéler le sport du créneau ciblé.

→ Le passage **mono → multi** consiste surtout à **élargir le filtre d'affichage** et à **remplacer le sélecteur**, pas à reconstruire la grille.

## Décisions de conception (validées)

### 1. État de sélection : un ensemble de sports

- Remplacer `selectedSportId: string` par **`selectedSportIds: string[]`** (ids de `clubSport`, dans l'ordre du club). Jamais vide.
- La grille rend les sections pour **tous** les ids sélectionnés (filtre `selectedSportIds.includes(cs.id)`, en conservant l'ordre `club.clubSports`).

### 2. Défaut net (sport préféré) + mémorisation par club

Ordre de résolution de la sélection initiale (sans saut) :

1. **localStorage** `palova:reserve-sports:<clubId>` (tableau d'ids) s'il existe et qu'au moins un id est encore proposé par le club → on l'utilise (ids périmés filtrés ; si tout est périmé, on retombe sur l'étape suivante).
2. Sinon, **sport préféré** : si connecté, lire `preferredSport` (via `api.getMyProfile`) et prendre le `clubSport` dont `sport.key === preferredSport.key` s'il est proposé → `[cetId]`.
3. Sinon (pas de préféré, préféré non proposé, ou non connecté) → `[club.clubSports[0].id]`.

**Anti-saut :** tant que la sélection initiale n'est pas résolue (cas où on attend `getMyProfile`), la zone grille affiche un discret « Chargement… » plutôt que la section d'un mauvais sport. La disponibilité, elle, charge en parallèle (inchangé). Pour un club mono-sport ou un visiteur non connecté, la résolution est **synchrone** (pas d'attente).

**Persistance :** à chaque changement de sélection par l'utilisateur, écrire `selectedSportIds` dans `localStorage[palova:reserve-sports:<clubId>]`. (On ne persiste pas la résolution automatique initiale tant que l'utilisateur n'a rien changé — sauf si déjà présente.)

### 3. Sélecteur « lien discret + liste à cocher » (nouveau composant `SportPicker`)

- **Plus de `PillTabs` de sport.** À la place, un **lien discret** sous la bande de dates, affiché **uniquement si `club.clubSports.length > 1`** (un club mono-sport n'a rien à changer).
- **Libellé du lien** = résumé de la sélection suivi de « · changer » :
  - 1 sport : « **Padel** · changer »
  - 2 sports : « **Padel, Tennis** · changer »
  - 3+ : « **Padel +2** · changer » (1ᵉʳ nom + « +N »)
  - (noms dans l'ordre du club ; un crayon discret peut accompagner « changer ».)
- **Au clic**, ouverture d'un **panneau de cases à cocher** (un sport par ligne, dans l'ordre du club, coché = affiché). Cocher/décocher met à jour la sélection en direct. **Au moins un sport reste coché** (on empêche de tout décocher). Fermeture au clic extérieur.
- Composant **`frontend/components/reserve/SportPicker.tsx`**, autonome et testable :
  - Props : `sports: { id: string; name: string; icon?: string | null }[]`, `selectedIds: string[]`, `onChange: (ids: string[]) => void`.
  - Responsabilités : libellé résumé, ouverture/fermeture du panneau, cases à cocher, garde « ≥ 1 coché », fermeture au clic extérieur. Style cohérent (inline + `th`).

### 4. Grille multi-sections

- Rendre une section par sport de `selectedSportIds` (ordre du club). Chaque section = le rendu existant (durée, terrains, créneaux, prix), inchangé.
- **Titre de section** (icône + nom du sport) affiché quand **plus d'un sport est affiché** *(ou)* quand le club est mono-sport (comportement actuel conservé). Avec un seul sport coché sur un club multi-sports → **pas de titre** (écran aussi simple qu'aujourd'hui).
- **Lien profond** (`deepSlot`) : au lieu de remplacer la sélection, **ajouter** le sport du créneau ciblé à `selectedSportIds` s'il n'y est pas (pour que la section soit visible), puis pré-ouvrir la confirmation comme aujourd'hui.

## Architecture / découpage

- **Nouveau** `frontend/components/reserve/SportPicker.tsx` — le lien discret + panneau à cocher (libellé, garde ≥1, clic-extérieur). Une seule responsabilité, testable isolément.
- **Modifié** `frontend/components/ClubReserve.tsx` :
  - `selectedSportId: string` → `selectedSportIds: string[]` (+ init lazy depuis localStorage, effet de résolution préféré, persistance).
  - Remplacer le bloc `PillTabs` de sport (`:177-185`) par `<SportPicker … />` (gardé derrière `club.clubSports.length > 1`).
  - Filtre de grille `cs.id === selectedSportId` → `selectedSportIds.includes(cs.id)` ; règle d'affichage du titre de section ajustée.
  - `deepSlot` : ajouter le sport à la sélection au lieu de la remplacer.
  - Garde « Chargement… » tant que la sélection initiale n'est pas résolue (cas attente profil).

## Hors périmètre

- **Aucun changement backend.** Pas de nouvel endpoint ; `reloadAll` continue de charger tous les sports du club (comportement actuel). *(Optimisation possible plus tard : ne charger que les sports sélectionnés — non retenue ici pour ne pas fragiliser le lien profond qui balaie tous les sports.)*
- Pas de refonte de la grille, des durées, des prix, du `BookingModal`, ni de la bande de dates.
- Pas de changement de la notion de « sport préféré » (profil) ni du modèle de données.

## Tests

- **`SportPicker`** (`frontend/__tests__/SportPicker.test.tsx`) :
  - libellé : 1 / 2 / 3+ sports (« Padel · changer », « Padel, Tennis · changer », « Padel +2 · changer ») ;
  - le clic ouvre le panneau ; cocher un sport appelle `onChange` avec le bon ensemble ; décocher le dernier sport restant est **empêché** ;
  - clic extérieur ferme le panneau.
- **`ClubReserve`** (test existant à étendre, ou nouveau ciblé) :
  - club mono-sport → **pas** de `SportPicker` (rien à changer), grille du sport rendue ;
  - club multi-sports, connecté avec préféré « tennis » proposé → la sélection initiale est `[tennis]` (pas de bascule visible depuis `clubSports[0]`), et la section Tennis est affichée ;
  - cocher un 2ᵉ sport → **deux** sections de grille rendues, chacune avec son titre ;
  - la sélection est relue depuis `localStorage` au montage (id périmé ignoré) ;
  - ⚠️ les mocks `lib/api` doivent exposer ce que `ClubReserve` consomme (`getClubAvailability`, `getMyProfile`, etc.) ; `localStorage` nettoyé entre tests.

## Critères d'acceptation

1. Page Réserver : **plus de rangée de pastilles de sport**. La grille du **sport préféré** s'affiche directement.
2. **Aucun saut** au chargement (pas d'affichage transitoire du mauvais sport).
3. Un lien discret « **Padel, Tennis · changer** » (résumé + « +N » à partir de 3) ouvre une **liste à cocher** ; cocher plusieurs sports affiche **une section de grille par sport**, avec titre de section dès 2 sports.
4. On ne peut pas **tout décocher** (au moins un sport reste affiché).
5. La sélection est **mémorisée par club** (retour sur la page → on retrouve la sélection).
6. Club mono-sport ou visiteur non connecté : comportement simple, sans sélecteur superflu, sans régression de réservation (créneaux, durées, prix, lien profond, confirmation).
