# Dupliquer un tournoi / un event (admin) — design

**Date :** 2026-07-20
**Statut :** spec validée, en attente de feu vert avant plan
**Périmètre :** 100 % frontend. Aucun backend, aucune migration, aucun nouveau composant.

## Problème

Un club qui organise régulièrement la même épreuve (l'Open de printemps chaque
année, la même soirée mêlée) doit aujourd'hui **tout re-saisir** dans le
formulaire de `/admin/tournaments` ou `/admin/events`. Le gabarit (catégorie,
genre, capacité, frais, description, prépaiement…) ne change pourtant pas d'une
édition à l'autre.

But : un bouton **« Dupliquer »** qui rouvre le formulaire de création
pré-rempli à partir d'une épreuve existante, de sorte que l'admin n'ait plus
qu'à vérifier les dates et publier.

## Ce qui existe déjà (et qu'on réutilise)

Les deux pages admin sont **jumelles** :

- `startEdit(t/e)` remplit l'état `form` depuis un objet existant et pose
  `editingId`.
- Le formulaire s'affiche dès que `form != null`.
- `save()` bascule create/update selon `editingId` :
  `editingId ? adminUpdate* : adminCreate*`.

« Dupliquer » est **une variante de `startEdit` qui reste en mode création**
(`editingId = null`), avec quelques valeurs remises à zéro. Rien d'autre à
câbler : la sauvegarde emprunte le chemin `adminCreate*` déjà en place, qui
repasse par toutes les gardes serveur (J/A, prépaiement, capacité…).

## Comportement

### Déclencheur

Un bouton `Dupliquer` (style `ghost`, à côté de `Modifier`) dans les `actions`
de **chaque carte**, quel que soit le statut — **y compris passées et
annulées**. Le cas d'usage le plus fort est justement « refais-moi l'Open de
l'an dernier » depuis une carte passée.

### Champs copiés tels quels

- **Tournoi** : `clubSportId`, `category`, `gender`, `openToWomen`, `maxTeams`,
  `entryFee`, `description`, `contactInfo`.
- **Event** : `kind`, `clubSportId`, `capacity`, `price`, `memberOnly`,
  `description`.

### Nom

Suffixé **« (copie) »** : `Open de printemps` → `Open de printemps (copie)`.
Distingue l'original du duplicata dans la liste et évite deux entrées au nom
identique.

### Statut

Le duplicata **n'est jamais publié automatiquement** : il naît via le bouton
`Créer (brouillon)` comme toute création. Pas d'inscriptions ouvertes sur une
épreuve non finalisée.

### Dates — décalage à la prochaine occurrence future

Les trois dates (début, fin optionnelle, limite d'inscription) sont **décalées
d'un nombre entier de semaines**, choisi ainsi :

- On prend le plus petit `N ≥ 1` tel que la **limite d'inscription** de la
  source décalée de `N` semaines tombe **dans le futur** (`> now`). On pivote
  sur la limite d'inscription (le jalon le plus précoce) : si elle est future,
  le début et la fin le sont nécessairement aussi.
- Les **trois** dates sont décalées du **même `N`**, donc :
  - le **jour de semaine** est préservé (tout multiple de 7 jours le conserve) ;
  - l'**heure locale** est préservée (voir « Piège DST » ci-dessous) ;
  - les **écarts** entre limite ↔ début ↔ fin sont préservés.

Exemples :
- Tournoi de **samedi dernier** → **samedi prochain** (`N = 1`).
- Open de **l'an dernier** → le **prochain samedi** à venir (`N` = nombre de
  semaines nécessaires), même heure.

L'admin voit toujours les dates pré-remplies dans le formulaire et peut les
ajuster avant de créer le brouillon.

### Récurrence (events uniquement)

La case « Se répète chaque semaine » est **décochée** sur un duplicata (`setRecurring(false)`).
Un duplicata est un ponctuel ; la récurrence hebdo a déjà son propre mécanisme
(`ClubEventSeries`).

### J/A (tournoi uniquement)

`refereeUserId` est copié **seulement si le J/A figure encore dans le vivier
chargé** (`referees.some(r => r.userId === source.refereeUserId)`). Sinon
`null`. Autrement, la création lèverait `REFEREE_INVALID` (la facette a pu être
retirée entre-temps).

### Prépaiement CB

`requirePrepayment` est copié **seulement si Stripe est encore actif**
(`stripeActive`). Sinon décoché. La case du formulaire est déjà `disabled`
quand Stripe est inactif ; copier `true` dans ce cas produirait une case
cochée-mais-verrouillée et un échec `ONLINE_PAYMENT_NOT_ENABLED` à la création.

## Découpage

### Helper pur (testé isolément) — le cœur

Un module `frontend/lib/duplicateAgenda.ts` avec une fonction pure :

```
shiftDatesToNextFuture(
  { startTime, endTime, registrationDeadline },  // chaînes "datetime-local" (YYYY-MM-DDTHH:mm), endTime possiblement '' / null
  now: Date,
) => { startTime, endTime, registrationDeadline }  // mêmes formats, décalés de N semaines
```

- Calcule `N` en pivotant sur `registrationDeadline`.
- Décale les trois dates du même `N` **sur le calendrier** (ajout de `N*7`
  jours aux composantes date), pas en millisecondes brutes.
- `endTime` vide/absent → laissé tel quel.

Testé : source récente (`N = 1`), source ancienne (`N > 1`, même jour de
semaine), écart limite↔début préservé, cas DST (une date qui traverse un
changement d'heure garde son heure locale).

### Piège DST

`form.startTime` etc. sont des chaînes **heure locale** (`YYYY-MM-DDTHH:mm`).
Ajouter `N*7*24*3600*1000` ms à un `Date` peut décaler l'heure affichée d'une
heure autour des changements d'heure d'été/hiver. Le décalage doit se faire sur
les **composantes calendaires** (jour + `N*7`), en recomposant la chaîne locale,
pour que « 20h00 » reste « 20h00 ».

### Câblage par page (symétrique)

- `frontend/app/admin/tournaments/page.tsx` : fonction `startDuplicate(t)` +
  bouton `Dupliquer` dans `actions`.
- `frontend/app/admin/events/page.tsx` : fonction `startDuplicate(e)` + bouton
  `Dupliquer` dans `actions` + `setRecurring(false)`.

Chaque `startDuplicate` :
1. `setError(null)`, `setEditingId(null)` ;
2. calcule les dates via `shiftDatesToNextFuture(source, new Date())` ;
3. pose `form` avec les champs copiés + « (copie) » + J/A filtré + prépaiement
   filtré + dates décalées.

## Tests

- **Helper** `duplicateAgenda.test.ts` : décalage `N = 1` / `N > 1`, préservation
  jour de semaine + heure locale, préservation des écarts, endTime vide, DST.
- **Suites existantes** `AdminTournaments.test.tsx` / `AdminEvents.test.tsx` :
  un cas « Dupliquer » → le formulaire s'ouvre en **mode création** (titre
  « Nouveau tournoi » / « Nouvel event », bouton « Créer (brouillon) »), nom
  suffixé « (copie) », champs de gabarit copiés, dates pré-remplies dans le
  futur, et la sauvegarde appelle `adminCreate*` (pas `adminUpdate*`).

## Hors périmètre

- Copier les inscrits (un duplicata part vide, par construction).
- Dupliquer une **série** d'events entière (on duplique une occurrence ponctuelle).
- Décalage configurable (autre que « prochaine occurrence hebdo »).
- Bouton « Dupliquer » ailleurs que dans les listes admin.
