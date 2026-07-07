# Timezone dynamique — jour du club, validation IANA & nettoyage legacy — Design

> Spec validée le 2026-07-07. Prérequis à l'ouverture internationale (chantier suivant :
> traductions multi-langues). **Constat d'exploration : le gros du chantier « timezone
> dynamique » du backlog est déjà fait** — le backend (availability, pricing/heures
> creuses, quotas, fenêtres de résa, récurrence, emails, carte OG) utilise partout
> `club.timezone` avec Luxon, DST compris, et la page Réserver formate déjà les heures
> dans le fuseau du club. La doc (CLAUDE.md, backend/README, STACK.md) est en retard.
> Ce qui reste : le « jour courant » calculé en UTC côté front (bug réel), un champ
> fuseau non validé (une faute de frappe casse le club), et du legacy à supprimer.

## 1. Objectif & périmètre

Rendre l'app correcte pour un club dans **n'importe quel fuseau IANA**, et solder
définitivement l'item de backlog « Timezone dynamique ».

**Dans le périmètre :**
1. **Jour du club côté front** — remplacer les « aujourd'hui = jour UTC »
   (`new Date().toISOString().slice(0,10)`) par un helper pur au fuseau du club.
2. **Validation IANA du fuseau** côté backend + **sélecteur de fuseaux** côté admin.
3. **Suppression du legacy** : `frontend/patch/`, pages démo `/courts`,
   `components/CourtCalendar.tsx`.
4. **Tests non-Paris** (Indian/Reunion, America/Toronto) backend + front.
5. **Docs à jour** (CLAUDE.md, backend/README.md, STACK.md).

**Hors périmètre :**
- i18n / traductions (chantier suivant, indépendant).
- Crons plateforme (`platformBilling.job` en Europe/Paris : assumé, la facturation SaaS
  Palova est française ; `ClubMemberSnapshot.month` idem).
- Fuseau à la création de club côté superadmin/wizard si le champ n'y est pas exposé
  (le gérant le règle dans `/admin/settings`).
- Préférence de fuseau **par utilisateur** (tout l'affichage club-scopé reste au fuseau
  du club — c'est le bon référentiel pour des créneaux physiques sur un terrain).

## 2. Le bug corrigé (pourquoi c'est réel dès aujourd'hui)

`new Date().toISOString().slice(0,10)` donne le jour **UTC**. Pour un club parisien,
entre 00h00 et 02h00 (été), la page Réserver s'ouvre sur **la veille** (tous les créneaux
« passés »), la caisse admin agrège le mauvais jour. Pour un futur club à l'ouest de
l'UTC (Guadeloupe, Toronto), caisse/planning basculeraient sur **demain dès 20h chaque
soir**. Occurrences vivantes recensées :

| Fichier | Usage |
|---|---|
| `frontend/components/ClubReserve.tsx:24` | date par défaut de Réserver + rareté `date === todayISO()` (l.320) |
| `frontend/lib/clubhouse.ts:11,18` | « créneaux du jour » du Club-house |
| `frontend/app/admin/page.tsx:57` | dashboard (réservations du jour) |
| `frontend/app/admin/caisse/page.tsx:23` | récap caisse du jour |
| `frontend/app/admin/encaissement/page.tsx:27` | caisse express |
| `frontend/app/admin/reservations/page.tsx:24` | page Encaissement |
| `frontend/app/admin/planning/page.tsx:60,66` | planning (jour courant + navigation ±1 jour) |

Cas particuliers audités :
- `frontend/lib/bookingWindow.ts:27` : arithmétique de jours via `Date.UTC` sur des
  chaînes `YYYY-MM-DD` = **calendaire pure, correcte** si l'ancre est le jour club —
  auditer l'ancre à l'implémentation, ajouter un test non-Paris, ne corriger que si faux.
- `frontend/lib/calendar.ts:66` : fait partie de l'« arithmétique UTC pure » posée
  APRÈS la clé de jour tz-aware (convention documentée du calendrier) — vérifier à
  l'implémentation que c'est bien le cas, ne pas toucher si conforme.

## 3. Décisions clés

| Sujet | Décision |
|---|---|
| Jour du club (front) | **Helper pur Intl partagé** (approche A) — pas de Luxon au front (~70 Ko évités), pas d'endpoint serveur (surdimensionné) |
| Référentiel d'affichage | Toujours le **fuseau du club** pour les surfaces club-scopées (créneaux physiques) |
| Validation fuseau | **Backend**, à l'écriture (`IANAZone.isValidZone` de Luxon, déjà en dépendance), erreur 400 `TIMEZONE_INVALID` |
| UI fuseau | Select alimenté par `Intl.supportedValuesOf('timeZone')`, repli liste courte statique |
| Legacy | **Suppression** (patch/, /courts, CourtCalendar) — plus aucun import vivant |
| Migration | **Aucune** (ni schéma ni données ; `Club.timezone` existe avec défaut Europe/Paris) |

## 4. Helper « jour du club » — `frontend/lib/clubDay.ts`

Module pur, sans I/O, testable :

```ts
/** Jour calendaire courant du club (YYYY-MM-DD) au fuseau IANA donné.
 *  Fuseau invalide/absent → repli UTC (jamais de crash d'affichage). */
export function clubDayISO(tz: string | null | undefined, at: Date): string;
/** Jour + n jours en calendaire pur (arithmétique Date.UTC sur la chaîne). */
export function addDaysISO(day: string, n: number): string;
```

- Implémentation : `Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric',
  month: '2-digit', day: '2-digit' })` (`en-CA` → format `YYYY-MM-DD` direct, pattern
  déjà utilisé par `lib/calendar.ts`) dans un `try/catch` → repli `toISOString().slice(0,10)`.
- `at` toujours passé par l'appelant (convention hydration-safe du repo — jamais de
  `new Date()` dans le helper).
- **Remplacements** : les 7 surfaces du §2 remplacent leur `todayISO()` local par
  `clubDayISO(club.timezone, new Date())` (le `club` vient de `useClub()` déjà présent
  sur chaque page) ; la navigation ±1 jour du planning passe par `addDaysISO`.
  `lib/clubhouse.ts` reçoit le fuseau en paramètre (thread depuis `ClubHouse.tsx`).

## 5. Validation IANA (backend)

- `backend/src/services/club.service.ts` : à la **création** (l.133) et dans
  **`updateClub`**, si `timezone` est fourni — `trim()`, puis
  `IANAZone.isValidZone(tz)` (import `luxon`) sinon `throw new Error('TIMEZONE_INVALID')`.
  Chaîne vide → champ ignoré (on garde l'existant/le défaut).
- `backend/src/services/platform.service.ts` : même garde si la création superadmin
  accepte un fuseau (sinon rien).
- Mapping `TIMEZONE_INVALID: 400` ajouté aux `ERROR_STATUS` des routers concernés
  (admin.ts, clubs/platform selon exposition).
- Front : message FR « Fuseau horaire invalide » mappé dans `/admin/settings`.

## 6. Sélecteur de fuseau — `/admin/settings`

Remplacer l'input texte (l.176) par un **select** :
- Options : `Intl.supportedValuesOf('timeZone')` (~400 entrées), groupées par préfixe
  de continent (`Europe/…`, `America/…`, `Indian/…`, `Pacific/…`, `Africa/…`, `Asia/…`,
  `Atlantic/…`, `Australia/…`), avec en tête un groupe « Courants » : Europe/Paris,
  America/Guadeloupe, America/Martinique, America/Cayenne, Indian/Reunion,
  Pacific/Noumea, Pacific/Tahiti, Europe/Brussels, Europe/Madrid, America/Montreal.
- `Intl.supportedValuesOf` absent (vieux navigateur) → repli sur la liste « Courants ».
- La valeur actuelle du club est toujours présente (injectée si hors liste) — jamais de
  reset silencieux.
- Pas de nouveau composant générique : select natif stylé comme les champs existants de
  la page (ou `SelectField` d'`atoms.tsx` s'il convient).

## 7. Suppression du legacy

- **`frontend/patch/`** : répertoire mort (aucun import — vérifié), contient les derniers
  vrais `UTC+2` du repo → suppression complète.
- **`frontend/app/courts/`** (liste + `[id]`) et **`frontend/components/CourtCalendar.tsx`**
  (défaut `'Europe/Paris'` en dur) : pages de la démo d'origine, hors parcours produit →
  suppression, après un grep de contrôle (`/courts`, `CourtCalendar`) sur les navs,
  `PUBLIC_PATHS`/`authGate`, tests. Les tests associés (s'il y en a) partent avec.
- CLAUDE.md : retirer `courts/page.tsx`/`courts/[id]/page.tsx` du schéma d'architecture
  et l'item « Authentification réelle … DEMO_TOKEN » du backlog s'il ne référence que ces pages.

## 8. Tests

- **Front `__tests__/clubDay.test.ts`** : minuit UTC vs minuit club (Paris 00h30 été →
  jour local ≠ jour UTC), club à l'ouest (America/Toronto 21h → jour UTC = demain),
  UTC+4 sans DST (Indian/Reunion), tz invalide → repli sans throw, `addDaysISO`
  (fin de mois, année bissextile).
- **Front surfaces** : un cas « club non-Paris » sur la page caisse (mock de `Date` +
  club `America/Toronto` : le jour affiché est le jour local du club) ; suites
  existantes de Réserver inchangées (aucune assertion sur la date par défaut).
- **Backend** : dans `availability.service.test.ts` et `pricing.test.ts`, dupliquer un
  cas clé avec `Indian/Reunion` et `America/Toronto` (bornes open/close converties,
  heures creuses au bon fuseau) ; un cas `bookingWindow`/fenêtre de résa non-Paris ;
  `club.service.test.ts` : `TIMEZONE_INVALID` (typo), fuseau valide accepté, vide ignoré.
- **Type gates** : `npx tsc --noEmit` backend ; `node node_modules/typescript/bin/tsc
  --noEmit` frontend.

## 9. Docs à corriger (même PR)

- **CLAUDE.md** : « Créneaux : 8h–22h heure Paris (UTC+2 hardcodé) » → « Créneaux :
  bornes `openHour`/`closeHour` par terrain, au fuseau du club (`club.timezone`, IANA,
  DST géré par Luxon) » ; retirer l'item de backlog « Timezone dynamique » ; retirer les
  pages `/courts` de l'architecture.
- **backend/README.md** (§availability l.213 et l.279) : plus de `UTC_OFFSET = 2`.
- **STACK.md** (l.162) : cocher/retirer l'item.

## 10. Découpage de mise en œuvre (pressenti)

1. `lib/clubDay.ts` + tests (TDD).
2. Remplacements des 7 surfaces + thread du fuseau dans `lib/clubhouse.ts` + audits
   `bookingWindow`/`calendar.ts:66` + tests surfaces.
3. Validation backend (`club.service`, `platform.service` si exposé) + `ERROR_STATUS` + tests.
4. Sélecteur `/admin/settings` + message d'erreur FR + test.
5. Suppression legacy (grep de contrôle puis delete) + suites vertes.
6. Tests non-Paris backend + docs (CLAUDE.md / README / STACK).
