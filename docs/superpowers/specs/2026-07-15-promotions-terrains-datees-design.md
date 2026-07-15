# Promotions datées sur les terrains — design

**Date :** 2026-07-15
**Statut :** spec validée (brainstorming), plan à écrire

## Problème

Un club veut pouvoir baisser le prix de réservation de terrains pendant une
période donnée — promo saisonnière large (« −20% tout août »), promo ciblée sur
certains terrains (« court-3 à 15€ pendant 2 semaines »), ou happy hour daté
(« 18h-20h moins cher, du 20/07 au 05/08 »). Aujourd'hui **rien ne couvre ça** :
la tarification ne connaît que le prix plein (`Resource.price`) et le prix creux
récurrent hebdomadaire (`Resource.offPeakPrice` + `Club.offPeakHours`), calculés
par `slotPriceCents` dans `backend/src/services/pricing.ts`. Il n'existe aucun
modèle de promotion/remise bornée dans le temps.

## Objectif

Un système de **promotions datées** souple, géré par le club, qui couvre les
trois cas ci-dessus d'un seul mécanisme, s'affiche clairement au joueur (prix
barré + nom de la promo), et se propage à tout le pipeline de paiement sans
refonte (dû, abonnement, carnet, caisse continuent de lire le `totalPrice`
remisé stocké à la réservation).

## Décisions de cadrage (brainstorming)

1. **Souplesse** : un seul mécanisme couvre promo large / ciblée / happy hour.
2. **Type de remise** : au choix à la création — **pourcentage** OU **prix fixe**.
3. **Ciblage** : terrains (tous ou une sélection) + **plage horaire optionnelle**.
   Pas de récurrence par jour de semaine, pas de raccourci « par sport ».
4. **Chevauchement de promos** : le client gagne — on applique automatiquement la
   remise la plus avantageuse (prix le plus bas), aucune validation bloquante.
5. **Affichage joueur** : prix barré + prix remisé + pastille au **nom** de la promo.
6. **Surface admin** : page dédiée `/admin/promotions`.

## Modèle de données

Migration additive **`add_promotions`** (appliquée en DEV via `prisma db execute`
du SQL additif à cause de la dérive de base connue ; en prod `migrate deploy`).

### `Promotion`

| Champ | Type | Notes |
|---|---|---|
| `id` | String @id cuid | |
| `clubId` | String | FK `Club`, cascade delete, `@@index` |
| `name` | String | Affiché joueur + admin (ex. « Promo été ») |
| `startDate` | DateTime (@db.Date) | Début de période, **date locale du club**, bornes incluses |
| `endDate` | DateTime (@db.Date) | Fin de période, incluse |
| `windowStart` | Int? | Minutes depuis minuit ; **null = toute la journée** |
| `windowEnd` | Int? | Minutes depuis minuit ; null si `windowStart` null |
| `kind` | enum `PromotionKind { PERCENT, FIXED }` | |
| `percentOff` | Int? | 1..100, requis ssi `kind = PERCENT` |
| `fixedPriceCents` | Int? | > 0, requis ssi `kind = FIXED` |
| `enabled` | Boolean @default(true) | Mise en pause sans suppression |
| `createdAt` / `updatedAt` | DateTime | |

Relation `resources PromotionResource[]`.

### `PromotionResource` (table de jointure de ciblage)

| Champ | Type | Notes |
|---|---|---|
| `promotionId` | String | FK `Promotion`, cascade |
| `resourceId` | String | FK `Resource`, cascade (nettoyage auto si un terrain est supprimé) |

`@@id([promotionId, resourceId])`. **Aucune ligne = la promo s'applique à tous
les terrains du club** (ciblage « tous »). Une ou plusieurs lignes = ciblage
restreint à ces terrains.

## Logique de prix (le cœur)

Helper **pur** dans `pricing.ts` (mêmes vecteurs de test que les autres, miroir
possible dans `frontend/lib/caisse.ts`), signature indicative :

```ts
type ActivePromo = {
  kind: 'PERCENT' | 'FIXED';
  percentOff: number | null;
  fixedPriceCents: number | null;
  windowStart: number | null; // minutes locales
  windowEnd: number | null;
  resourceIds: string[];       // vide = tous
};

function effectiveSlotPriceCents(
  baseCents: number,           // prix normal déjà calculé par slotPriceCents (plein OU creux)
  promos: ActivePromo[],       // promos du club, enabled, dont la période couvre la date locale du créneau
  resourceId: string,
  start: Date,
  end: Date,
  tz: string,
): { priceCents: number; promoName?: string }
```

Règles :

1. `baseCents` = le prix normal du créneau (plein ou creux), tel que
   `slotPriceCents` le calcule aujourd'hui — **inchangé**.
2. Une promo **s'applique** à un créneau si :
   - `enabled` est vrai ;
   - la **date locale de début** du créneau (fuseau club) est dans
     `[startDate, endDate]` (bornes incluses) ;
   - le terrain est concerné (`resourceIds` vide → tous, sinon `resourceId ∈ resourceIds`) ;
   - si une fenêtre est définie (`windowStart`/`windowEnd`), le créneau est
     **entièrement à l'intérieur** de la fenêtre en heure locale (miroir de la
     règle heures creuses « 100 % des minutes »).
3. Candidat de prix d'une promo applicable :
   - `PERCENT` : `Math.round(baseCents × (100 − percentOff) / 100)` ;
   - `FIXED` : `fixedPriceCents`.
4. **Prix final = `min(baseCents, …tous les candidats applicables)`** →
   le client gagne (décision 4), et une promo **ne fait jamais monter** le prix
   (un prix fixe supérieur au tarif normal est ignoré par le `min`).
5. `promoName` = le nom de la promo qui **a produit le prix retenu** (pour le
   prix barré côté joueur). En cas d'égalité, la première rencontrée.

### Points de branchement (existants)

`effectiveSlotPriceCents` enveloppe le résultat de `slotPriceCents` aux endroits
qui calculent un **prix vivant** pour un créneau réservable :

- `availability.service.ts:69` — grille de disponibilité (prix affiché au joueur) ;
- `reservation.service.ts:279` — `holdSlot` (prix figé dans `totalPrice`) ;
- `reservation.service.ts` reschedule (`:1793` / `:2076`) — prix recalculé au déplacement ;
- `reservation.service.ts:1225` — repli tarif du « dû » d'une résa COURT sans prix
  (cohérence de l'affichage du dû sur le planning/caisse).

`memberStats.service.ts:173` (statistiques historiques) reste sur le prix de
base — les stats reflètent le tarif normal, la promo n'est pas un fait
historique à recomposer.

Les autres calculs (dû réel, plafond d'encaissement, abonnement, carnet) lisent
le `totalPrice` **déjà remisé** stocké à la réservation → **aucune modification**.

## Interactions & garanties

- **Forward-looking** : la promo n'agit qu'au moment de la réservation (hold) et
  sur la grille vivante. Les réservations **déjà prises** conservent leur
  `totalPrice` — pas de remboursement ni de recalcul rétroactif.
- **Abonnés / carnets / caisse** : automatique. Un abonné « illimité » paie
  toujours 0 ; un payeur cash paie le dû remisé ; un carnet/porte-monnaie
  consomme le montant remisé. La couverture auto par abonnement plafonne au dû
  (déjà remisé) sans changement.
- **Une promo ne fait jamais monter le prix** (garanti par le `min`).
- **Chevauchement** : meilleur prix, sans validation bloquante à la création.

## Surface admin — `/admin/promotions`

- Entrée de nav dans la section **Finances**, gatée **ADMIN**
  (`requireClubMember('ADMIN')`, comme Offres/Réglages).
- **Liste** de cartes façon `/admin/offres`, groupées **À venir / En cours /
  Passées** (dérivé de la période vs `now` au fuseau club), promo désactivée
  estompée. Chaque carte : nom, période, cible (« Tous les terrains » ou N
  terrains), fenêtre horaire éventuelle, remise (« −20% » ou « 15€ »), interrupteur.
- **Formulaire création/édition** (modale ou page) :
  - nom ;
  - période via `DateField` (début/fin) ;
  - interrupteur « Tous les terrains » ↔ multi-sélection de terrains ;
  - plage horaire optionnelle via `TimePicker` (début/fin), effaçable ;
  - type de remise en chips `%` / `Prix fixe` + champ valeur ;
  - interrupteur « Activer ».
- **Routes admin** : `GET/POST/PATCH/DELETE /api/clubs/:clubId/admin/promotions[/:id]`.
- **Validation** (400 `VALIDATION_ERROR`) : `startDate ≤ endDate` ; `percentOff`
  1..100 requis ssi `PERCENT` ; `fixedPriceCents > 0` requis ssi `FIXED` ;
  fenêtre cohérente (`windowStart < windowEnd`, ou les deux nuls) ; terrains
  appartenant au club.

## Affichage joueur

- DTO `TimeSlot` (availability) : ajout de `originalPrice?` (prix de base en €) et
  `promoName?`, renseignés uniquement quand `price < originalPrice`.
- **Grille Réserver** (vue cartes `ClubReserve` + vue grille `SportGrid`) et
  **`BookingModal`** : prix barré (`originalPrice`) + prix remisé (`price`) +
  pastille au nom de la promo, dans le langage visuel de la chip heures creuses.
- Types front `Promotion` + méthodes admin dans `lib/api.ts`.

## Tests

- **Pur (`pricing.test.ts`)** : `effectiveSlotPriceCents` — pourcentage, prix
  fixe, fenêtre horaire dedans/dehors, date dedans/dehors, tous terrains vs
  sélection, chevauchement (meilleur prix), `min` avec la base (prix fixe
  supérieur ignoré), `promoName` retourné.
- **Service** : `holdSlot` stocke le `totalPrice` remisé ; `availability`
  retourne `price`/`originalPrice`/`promoName` ; reschedule recalcule remisé.
- **Routes** : CRUD admin + validations (ordre des dates, exclusivité
  `percent`/`fixed`, bornes, appartenance des terrains au club, gating ADMIN).
- **Frontend** : page `/admin/promotions` (liste + formulaire + groupage), grille
  Réserver affiche le prix barré + pastille.

## Hors périmètre (YAGNI)

- Récurrence par jour de semaine ; raccourci de ciblage « par sport ».
- Codes promo saisis par le joueur (la remise est automatique).
- Remboursement / recalcul rétroactif des réservations déjà prises.
- Ciblage par catégorie de membre (nouveaux membres, etc.).
- Miroir promo dans les suggestions de prix admin (caisse/planning) : le dû
  affiché vient déjà du backend ; à réévaluer au plan si nécessaire.
