# Encaissement — filtres simplifiés « par sport, à venir »

Date : 2026-06-24
Page concernée : `/admin/reservations` (back-office, intitulée « Encaissement »)
Composants : `frontend/components/admin/ReservationFilters.tsx`, `frontend/app/admin/reservations/page.tsx`, helpers `frontend/lib/collect.ts`

## Problème

La barre de filtres actuelle a **trop de contrôles** et ils ne sont **pas adaptés** au geste du comptoir :
`Statut` (5 états : Tout / Non payé / Partiel / Soldé / Annulées), `Créneau` (presets Maintenant / Matin / Après-midi / Soir + plage horaire personnalisée), `Terrain` (facette), `Moyen de paiement` (facette), plus recherche et jour.

Au comptoir d'un club **multi-sports**, ce qui compte est : « montre-moi les **prochains créneaux** du/des **sport(s)** que je gère, et ce qu'il reste **à encaisser** ». Le reste est du bruit.

## Objectif

Remplacer la barre par un modèle **léger, centré sur le sport et le « à venir »** :

```
┌──────────────────────────────────────────────────────────┐
│ Padel, Tennis · changer        🔍 Rechercher un client…   │   ← ligne 1
│ [ À venir · Tout le jour ]   ○ À encaisser     Jour ▦      │   ← ligne 2
└──────────────────────────────────────────────────────────┘
```

### Contrôles conservés / nouveaux
- **Sports** (nouveau) : sélecteur **multi-sport** (cases à cocher), même pattern que la page Réserver — un lien discret « <résumé> · changer » ouvre un panneau de cases. Garde **≥ 1 sport coché**. **N'apparaît que si le club a ≥ 2 sports.**
- **À venir | Tout le jour** : segmenté, défaut **À venir**.
- **À encaisser** : toggle unique. Off = tout l'actif du jour ; On = uniquement les réservations avec un reste dû.
- **Recherche client** : conservée.
- **Jour** (+ « Tout afficher ») : conservé pour naviguer entre les jours.

### Contrôles supprimés
- Statut 5 états (remplacé par le seul toggle « À encaisser » ; **annulées toujours masquées**, comme aujourd'hui ; pas de vue « Soldé » dédiée).
- Presets de créneau (Maintenant / Matin / Après-midi / Soir) et la plage horaire personnalisée.
- Facette **Terrain**.
- Facette **Moyen de paiement**.

## Comportement des filtres

Helpers **purs** dans `lib/collect.ts` (testés), appliqués dans `page.tsx` :

- **Sport** — `passSport(r, selectedSportKeys, resourceSportBy=resourceId→sportKey)` :
  le sport du terrain de la réservation (résolu via `resources[r.resourceId].clubSport.sport.key`) appartient à la sélection.
  Club **mono-sport** → pas de filtre, sélecteur non rendu.
- **À venir** — `isUpcoming(r, now)` : **garde les créneaux dont l'heure de fin `r.endTime` ≥ `now`** (masque les créneaux **terminés**). Un créneau **en cours** reste donc visible (on peut encore encaisser). `now` posé **côté client** dans un effet (jamais au rendu — hydration), comparaison sur les `Date` ISO. Désactivé quand le toggle est sur « Tout le jour ».
  - Effet de bord assumé : sur un **jour passé**, « À venir » n'affiche rien (tout est terminé) → l'utilisateur bascule sur « Tout le jour » ou change de jour. Acceptable.
  - Sur un **jour futur**, tous les créneaux sont « à venir » → « À venir » et « Tout le jour » montrent la même chose.
- **À encaisser** — réutilise `isCollectable(r)` (déjà présent : `status !== 'CANCELLED' && remainingOf(r) > 0`).
- **Recherche** — `matchesQuery` (inchangé, recherche déjà titulaire + participants).

La **liste reste groupée par terrain** (inchangé), limitée aux terrains des sports cochés. Le **bandeau KPI** (Encaissé / Reste / Total) reflète la **vue filtrée** courante (comme aujourd'hui via `kpiRows`).

## Défauts & mémorisation

- **Sports cochés par défaut = tous** (vue d'ensemble du comptoir).
- Sélection **mémorisée par club** en `localStorage`, clé `palova:encaissement-sports:<clubId>` (ids périmés filtrés au chargement), pattern repris de la page Réserver. Si la clé est absente → tous cochés.
- **À venir** activé par défaut ; **À encaisser** désactivé par défaut. Ces deux-là ne sont pas persistés (état de session).

## Périmètre technique

### `ReservationFilters.tsx`
Props et UI réécrites, bien plus légères :
```ts
interface ReservationFiltersProps {
  query: string; onQuery: (q: string) => void;
  date: string; onDate: (d: string) => void; onClearDate: () => void;
  // sports : rendu uniquement si sports.length > 1
  sports: { key: string; name: string }[];
  selectedSports: Set<string>; onToggleSport: (key: string) => void;
  upcoming: boolean; onUpcoming: (v: boolean) => void;
  dueOnly: boolean; onDueOnly: (v: boolean) => void;
  activeCount: number; onReset: () => void;
}
```
- Le panneau de sport réutilise **`components/reserve/SportPicker.tsx`** si son interface le permet, sinon on en mire le pattern (lien résumé « … · changer » + panneau de cases, fermeture clic-extérieur / Échap, garde ≥ 1).

### `reservations/page.tsx`
- État supprimé : `status`, `courtSel`, `preset`, `showCustom`, `fromHour`, `toHour`, `methodSel` (et les compteurs/facettes associés : `statusCounts`, `courtFacets`, `methodsUsed`, `STATUS_MODES`, `METHOD_ORDER`, `applyPreset`, `setCustomHour`, `toggleCourt`, `toggleMethod`).
- État ajouté : `selectedSports: Set<string>`, `upcoming: boolean` (défaut `true`), `dueOnly: boolean` (défaut `false`).
- `now` : déjà un effet pose l'heure ; étendre pour disposer du **timestamp complet** (pas seulement l'heure) afin de comparer `endTime`.
- Map `resourceSportByKey = new Map(resources.map(r => [r.id, r.clubSport.sport.key]))` pour `passSport`.
- `sportsPresent` : sports distincts présents parmi `resources` (pour alimenter le sélecteur ; le rendre seulement si `> 1`).
- `visible = dayResas.filter(r => passSearch && passSport && passUpcoming && passDue)`.
- Persistance localStorage de `selectedSports` par club.

### Tests (`__tests__/AdminReservations.test.tsx`)
- Remplacer les tests des anciens filtres (statut 5 états, presets, terrain, moyen) par :
  - filtrage par **sport** (un club multi-sport ; décocher un sport masque ses terrains) ;
  - toggle **À venir** masque un créneau terminé et garde un créneau à venir / en cours ;
  - toggle **À encaisser** masque une réservation soldée ;
  - club **mono-sport** → sélecteur de sport non rendu ;
  - défaut **tous sports cochés** + persistance localStorage.
- `collect.ts` : tests unitaires de `passSport` / `isUpcoming` (en-cours gardé, terminé masqué).

## Hors périmètre (YAGNI)
- Pas de vue « Soldé » ou « Annulées » dédiée (annulées masquées comme avant).
- Pas de regroupement par sport (on garde le regroupement par terrain).
- Pas de filtre par moyen de paiement ni par terrain (supprimés).
- Pas de persistance des toggles « À venir » / « À encaisser ».

## Point validé à la relecture
- **« À venir » = fin passée** (garde l'en-cours), pas « début passé ». Validé en brainstorming ; à confirmer au moment de la relecture du spec.
