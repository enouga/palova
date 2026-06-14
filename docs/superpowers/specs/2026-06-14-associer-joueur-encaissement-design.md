# Associer / créer un joueur à l'encaissement (v1) — Design

**Date :** 2026-06-14

## Problème

Au moment de l'encaissement, l'accueil doit pouvoir **rattacher un joueur** à l'opération,
et **créer son compte à la volée** s'il n'en a pas — sans quitter l'écran pour aller sur la
page Membres.

Aujourd'hui :
- **Caisse `/admin/caisse` → « Vendre une offre »** : on ne peut choisir qu'un **membre déjà
  existant** (recherche client dans le fichier-membres). `sellPackage` refuse un non-membre
  (`MEMBER_NOT_FOUND`).
- **Planning `/admin/planning` → panneau « Encaisser »** : le payeur est un texte libre
  (`payerName`) ou le joueur déjà rattaché à la résa ; pas moyen d'associer un joueur ni
  d'en créer un depuis l'encaissement.
- `adminCreateMember` (route `POST /members/create`, service `createMember`) sait déjà créer
  le compte + l'adhésion et renvoie un mot de passe temporaire — mais **uniquement** depuis la
  page Membres.

## Décisions (validées)

1. **Périmètre : les deux** flux (caisse vente d'offre **et** planning encaissement), via un
   composant réutilisable.
2. **Infos minimales : Prénom + Nom + Email** (téléphone optionnel) → on **réutilise
   `createMember` tel quel**, aucune migration du modèle `User`. Le joueur créé devient
   **membre du club**.
3. **Connexion : comportement existant inchangé** — le compte créé est `emailVerified=false`
   (comme la page Membres) : mot de passe temporaire à transmettre, mais le joueur devra
   vérifier son email avant de se connecter. *Aucun changement à `createMember`.*
4. **Réaffectation au planning : remplacement libre** — on peut associer un joueur à une résa
   qui en a déjà un autre (cas « mauvais joueur saisi »). Le nouveau doit être **membre actif**.
   Pas de re-check quota (cohérent avec le bypass admin de `adminCreateReservation`).

## Architecture

### Composant frontend `PlayerPicker` (cœur)

`frontend/components/admin/PlayerPicker.tsx` — contrôle « rechercher **ou** créer un joueur ».

**Props (interface stable, testable isolément) :**
```ts
interface PlayerPickerProps {
  members: Member[];                       // fichier-membres déjà chargé par la page
  value: { userId: string; firstName: string; lastName: string } | null;
  onSelect: (m: Member) => void;           // joueur choisi ou fraîchement créé
  onClear: () => void;                     // bouton « Changer »
  onCreate: (body: CreateMemberBody) => Promise<{ tempPassword: string | null; existed: boolean }>;
  placeholder?: string;
}
```
- **Recherche** : champ texte → filtre `members` sur `firstName lastName email`
  (insensible à la casse, max 6) ; dropdown de résultats (pattern existant repris).
- **Création** : action « + Créer un joueur » → mini-formulaire compact (Prénom, Nom, Email
  requis ; Téléphone optionnel). Prénom/Nom **pré-remplis** en découpant la recherche tapée
  (`"Jean Dupont"` → firstName `Jean`, lastName `Dupont`). Submit → `onCreate(body)`.
- **Après création** : sélectionne le joueur, et affiche une note non bloquante :
  - `existed === true` → « Ce joueur avait déjà un compte — rattaché au club. »
  - sinon → « Compte créé — mot de passe temporaire à transmettre : `XXXX`. »
- **Joueur sélectionné** : affiché avec bouton « Changer » (`onClear`).
- Le composant ne fait **aucun fetch** lui-même (search = filtre local, create = callback) —
  il reste pur et réutilisable ; chaque page câble `onCreate` sur `api.adminCreateMember` et
  rafraîchit sa liste `members` après création.

### Caisse `/admin/caisse` — « Vendre une offre »

Remplace le bloc de recherche acheteur (lignes ~159-178) par `<PlayerPicker>`. `pickBuyer`
devient le `onSelect` (charge les soldes via `adminGetMemberPackages`). `onCreate` =
`api.adminCreateMember` puis `load()` (recharge `members`) puis sélection. Le reste du flux
de vente est **inchangé** : un joueur créé est membre → `adminSellPackage` passe.

### Planning `/admin/planning`

1. **Panneau « Encaisser »** : ajoute `<PlayerPicker>` au-dessus des moyens de paiement.
   - Pré-rempli avec `selected.user` (la liste planning expose déjà `user.id/firstName/lastName`).
   - `onSelect` → appelle la **nouvelle route** d'affectation, puis `load()` (la résa
     rechargée porte le nouveau joueur ; ses carnets/porte-monnaie deviennent payables —
     `payWithPackage` fonctionne car `addPayment` exige `reservation.userId === pkg.userId`).
   - `onClear` ne « dé-rattache » pas (hors v1) : sert juste à rouvrir la recherche.
2. **Création de résa** : remplace la recherche membre (`cMemberQuery`/`memberMatches`,
   lignes ~318-320 + bloc UI ~665) par `<PlayerPicker>` ; `onSelect` pose `cMemberId`.

### Backend

- `createMember` / route `POST /members/create` : **réutilisés tels quels**, aucun changement.
- **Nouvelle route** `PATCH /reservations/:id/member` (body `{ memberUserId }`) →
  `reservationService.assignReservationMember(reservationId, clubId, memberUserId)` :
  - charge la résa + `resource.clubId` ; `RESERVATION_NOT_FOUND` / `CLUB_MISMATCH` ;
  - vérifie `ClubMembership` **actif** `{ userId_clubId }` (status ≠ BLOCKED) sinon
    `MEMBER_NOT_FOUND` ;
  - `prisma.reservation.update({ data: { userId: memberUserId } })` ;
  - **pas** de re-check quota (cohérent avec `adminCreateReservation`).
  - Route montée dans `admin.ts` à côté du `PATCH /reservations/:id` existant (type),
    réutilise `ERROR_STATUS` (`MEMBER_NOT_FOUND: 404`, `CLUB_MISMATCH: 403` déjà présents).

### Frontend `lib/api.ts`
- Ajouter `adminAssignReservationMember(clubId, reservationId, memberUserId, token)` →
  `PATCH /api/clubs/:clubId/admin/reservations/:id/member`.

## Flux de données

```
PlayerPicker (UI pure)
 ├─ recherche → filtre members[] en mémoire
 └─ création → onCreate(body)
                 caisse   : api.adminCreateMember → load() → onSelect(nouveau)
                 planning : api.adminCreateMember → load() → onSelect(nouveau)
                                                              └─ planning encaisser :
                                                                 api.adminAssignReservationMember → load()
```

## Gestion d'erreurs
- Création : `VALIDATION_ERROR` (Prénom/Nom/Email manquant) remonté inline sous le
  mini-formulaire (pas de toast global). **Pas** d'erreur « email déjà pris » : un email déjà
  connu rattache le compte existant au club et renvoie `existed: true` (note « rattaché au club »).
- Affectation : `MEMBER_NOT_FOUND` (joueur non membre/bloqué) → message « Ce joueur n'est pas
  membre actif du club. » ; `CLUB_MISMATCH` → message générique.
- Le mot de passe temporaire reste affiché tant que l'opération n'est pas close (ne pas le
  perdre au premier re-render).

## Tests
- **Backend** `reservation.service.test.ts` : `assignReservationMember` — membre actif OK
  (update appelé avec `userId`), non-membre → `MEMBER_NOT_FOUND`, autre club → `CLUB_MISMATCH`.
- **Backend** `admin.reservations.routes.test.ts` : `PATCH /reservations/:id/member` (201/200,
  400 si `memberUserId` absent, mapping d'erreurs).
- **Frontend** `PlayerPicker.test.tsx` : filtre de recherche, sélection (callback), bouton
  « + Créer » → `onCreate` appelé avec body pré-rempli, affichage du mot de passe temporaire,
  cas `existed`.
- MAJ des mocks `api` dans les tests caisse/planning existants si nécessaire (`adminCreateMember`,
  `adminAssignReservationMember`).

## Hors périmètre (YAGNI)
- Joueur sans email / walk-in anonyme (email obligatoire — écarté).
- Connexion immédiate du compte créé (`emailVerified` inchangé).
- « Dé-rattacher » un joueur d'une résa (remettre `userId = null`).
- Édition des détails du joueur (tél/licence) depuis le picker au-delà de la création.
- Recrédit/cohérence des paiements package déjà saisis en cas de réaffectation (cas de bord
  réservé aux walk-ins).
