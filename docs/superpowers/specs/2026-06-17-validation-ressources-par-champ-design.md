# Validation par champ du formulaire Ressources — Design

**Date** : 2026-06-17
**Statut** : approuvé, prêt pour le plan

## Problème

Sur la page `/admin/courts` (« Ressources »), la création ou l'édition d'un
terrain affiche un message d'erreur **générique** quand le backend renvoie
`VALIDATION_ERROR` :

> Création : champs invalides (tarif > 0, ouverture < fermeture, créneau multiple de 15)

L'utilisateur ne sait pas **quel champ** est en faute. Cas déclencheur observé :
saisir **Ouv. = 09** et **Ferm. = 00**. Le backend valide avec `open >= close`
(`backend/src/services/resource.service.ts:28`) → `9 >= 0` est vrai → rejet.
Le code attend une fermeture en 0–24 où « minuit / fin de journée » se saisit
`24`, pas `00`. Le message générique ne le dit pas.

## Objectif

Garder les **règles métier inchangées** (le backend reste le filet de sécurité),
mais **valider côté front avant l'appel API** et afficher un message **précis,
sous le champ fautif** (texte rouge + bord rouge), à la **création** comme à
l'**édition en ligne** du tableau.

Hors périmètre : modifier la règle métier (ex. accepter `00` = minuit),
changer le backend, ajouter une migration.

## Architecture

### 1. Helper pur — `frontend/lib/resourceValidation.ts` (nouveau)

Source de vérité unique de la validation côté front, **miroir exact** de
`backend/src/services/resource.service.ts:27-48`.

```ts
export type ResourceFieldKey =
  | 'name' | 'price' | 'offPeakPrice' | 'openHour' | 'closeHour' | 'slotStepMin';

export type ResourceFieldErrors = Partial<Record<ResourceFieldKey, string>>;

export interface ResourceFieldInput {
  name: string;
  price: string | number;          // le formulaire tient des strings
  offPeakPrice?: string | number | null;
  openHour: string | number;
  closeHour: string | number;
  slotStepMin?: string | number | null;
}

export function validateResourceFields(input: ResourceFieldInput): ResourceFieldErrors;
```

Renvoie un objet ne contenant **que** les champs en faute, avec leur message FR.
Objet vide = tout est valide.

Règles et messages :

| Champ          | Règle (miroir backend)                                  | Message FR                                          |
|----------------|---------------------------------------------------------|-----------------------------------------------------|
| `name`         | requis, non vide après trim                             | « Le nom est requis. »                              |
| `price`        | nombre fini > 0                                         | « Le tarif plein doit être supérieur à 0. »         |
| `offPeakPrice` | optionnel ; si fourni (≠ '' / null), nombre > 0         | « Le tarif creux doit être supérieur à 0. »         |
| `openHour`     | entier, 0 ≤ open ≤ 24                                    | « L'ouverture doit être un entier entre 0 et 24. »  |
| `closeHour`    | entier, 0 ≤ close ≤ 24, et **open < close**             | « La fermeture doit être après l'ouverture. »       |
| `slotStepMin`  | optionnel ; entier multiple de 15, 15 ≤ step ≤ 240      | « Le créneau doit être un multiple de 15. »         |

Notes :
- `openHour`/`closeHour` partagent la contrainte `open < close`. Le message est
  porté par `closeHour` (champ « Ferm. »), car c'est lui qu'on corrige en
  pratique ; `openHour` ne reçoit un message que si lui-même est hors bornes.
- `slotStepMin` est rendu via un `<select>` à options fixes dans les deux UIs ;
  la règle ne sera donc jamais déclenchée depuis l'écran, mais on la garde par
  défense en profondeur (et pour la parité de test avec le backend).

### 2. Formulaire de création — `app/admin/courts/page.tsx`

- Nouvel état `createErrors: ResourceFieldErrors`.
- Au clic « Créer » : calculer `validateResourceFields(nr)`. Si non vide →
  **ne pas appeler l'API**, stocker dans `createErrors`, afficher les messages
  inline. Sinon, flux actuel.
- Chaque `onChange` d'un champ validé efface l'erreur de **ce** champ
  (`createErrors` sans la clé).
- Retirer le mapping en dur du message `VALIDATION_ERROR` → message générique,
  désormais inatteignable depuis ce formulaire ; conserver un repli générique si
  l'API renvoie malgré tout une erreur inattendue.

### 3. Édition du tableau — même page

- Nouvel état `rowErrors: Record<string, ResourceFieldErrors>` (clé = id ressource).
- Dans `saveAll` : pour chaque ligne *dirty*, calculer `validateResourceFields`.
  Si au moins une ligne est invalide → **annuler la sauvegarde** (comportement
  tout-ou-rien actuel conservé), remplir `rowErrors`, afficher les messages sous
  les cellules fautives. Aucune ligne n'est envoyée tant qu'il reste une erreur.
- L'édition d'une cellule (`editField` / `editStep`) efface l'erreur du champ
  correspondant pour cette ligne.

### 4. Présentation (styles)

- Un style d'erreur thémé : message en petit texte rouge sous le champ + bord
  rouge sur l'input fautif. Réutiliser la couleur d'alerte existante (ex.
  `ACCENTS.coral`) plutôt qu'un rouge en dur si disponible dans le thème.

## Tests

- `frontend/__tests__/resourceValidation.test.ts` (TDD, helper pur) : un cas par
  règle, dont **précisément `openHour=9, closeHour=0`** → erreur sur `closeHour`,
  les cas limites (close=24 valide, open=close invalide, price=0 invalide,
  offPeakPrice vide valide / 0 invalide, step 30 valide / 20 invalide), et le cas
  « tout valide » → objet vide.
- Les composants restent fins ; pas de nouveau test composant requis, mais un
  test léger de rendu inline est bienvenu si peu coûteux.

## Ce qui ne change pas

- Backend (`resource.service.ts`) : règles et messages inchangés, reste le filet
  de sécurité.
- Aucune migration. Aucune route. Forme des payloads API inchangée.
