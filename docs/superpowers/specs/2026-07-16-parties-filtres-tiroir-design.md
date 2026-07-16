# Parties ouvertes — tiroir de filtres (langage Events)

**Date** : 2026-07-16
**Statut** : validé (piste A choisie sur maquettes comparées dans le companion visuel — A tiroir / B toolbar une ligne / C carte structurée)
**Portée** : 100 % frontend. Aucun backend, aucune migration, aucune route.

## Problème

L'en-tête de la vue « Parties » de `/parties` (`components/openmatch/OpenMatches.tsx`) empile 5 étages
hétérogènes avant la première carte : label criard « FILTRER PAR NIVEAU » + 2 chips, slider de niveau
toujours déplié, rangée de chips Toutes/Compétitives/Amicales visuellement identique mais séparée,
bouton « 🔔 Créer une alerte » orphelin, chips d'alertes. Aucune surface commune, alignements épars —
jugé « pas beau » alors que `/events` a une barre de filtres soignée (`EventsFilterBar`).

## Décision

Regrouper tous les filtres dans **un tiroir unique** au langage exact de la barre Events, sous un
sous-titre raccourci. Le slider de niveau est **replié par défaut** derrière un chip « Régler ▾ ».

### Structure

- **Titre** : h1 « Parties ouvertes » inchangé. Sous-titre raccourci :
  « Rejoignez une partie publique, ou créez la vôtre au moment de réserver. »
- **Tiroir** (calqué sur le tiroir d'`EventsFilterBar`) : `th.bgElev`, coins 16,
  `inset 0 0 0 1px ${th.line}`, groupes en `flex-wrap` (gap `14px 26px`), labels de groupe en
  petites capitales 10.5px `th.textFaint`.
  - **Groupe « Niveau »** (rendu ssi `levelSystemEnabled` ET connecté) : 3 chips
    - `✓ À mon niveau · 5–7` — préset ±1 autour du niveau arrondi (logique `myLevelMin/Max`
      existante) ; le libellé inclut la fourchette (via `fmtLevel`). Rendu ssi `myLevel != null`.
    - `Tous` — remet [1, 8].
    - `Régler ▾` — déplie/replie le `LevelRangeSlider` compact **dans le tiroir**, sur une rangée
      pleine largeur sous les groupes (max-width ~430px). Quand la fourchette courante est
      **personnalisée** (ni préset « à mon niveau », ni 1–8), le chip passe actif et affiche
      `Niveau 4–6,5 ▾` (bornes via `fmtLevel`). Flèche `▾`/`▴` selon l'état déplié.
  - **Groupe « Type de partie »** : `✓ Toutes` / `Compétitives` / `Amicales` — état
    `kindFilter` inchangé. Toujours rendu.
- **Pied du tiroir** (filet supérieur `1px solid th.line`, comme le pied Events) :
  - à gauche : compteur `N partie(s)` = nombre de parties **après filtres**
    (recommandées + autres) ;
  - au milieu : chips des **alertes actives** (libellé `alertChipLabel`, ✕ suppression optimiste —
    comportement actuel inchangé) ;
  - à droite : bouton-lien `🔔 Créer une alerte` (texte accent, sans fond) — connecté seulement.
  - Le pied est rendu ssi connecté OU au moins un filtre actif (anonyme sans filtre : pas de pied).

### États

- **Anonyme** : tiroir réduit au groupe « Type de partie » (pas de niveau, pas d'alertes).
- **Club sans système de niveau** (`levelSystemEnabled === false`) : idem anonyme pour le groupe
  Niveau ; les alertes restent (elles ne dépendent pas du niveau).
- **État vide** « Aucune partie ouverte… » : inchangé (garde son bouton alerte plein accent).
- **Mobile** : les groupes passent à la ligne naturellement (`flex-wrap`) — aucun débordement
  horizontal.
- Le défaut « à mon niveau » à l'arrivée (effet `filterTouchedRef`) est conservé tel quel.

### Suppressions

- Le label « FILTRER PAR NIVEAU » disparaît.
- Le slider n'est plus visible par défaut.
- Le bouton « Créer une alerte » autoportant (pill bordée) disparaît au profit du lien du pied.

## Découpage

- **Nouveau** `frontend/components/openmatch/MatchesFilterBar.tsx` — présentation pure, état 100 %
  contrôlé par le parent. Props : `{ levelEnabled, isAuthenticated, myLevel, fMin, fMax,
  onLevelChange(min,max), kindFilter, onKindChange, resultCount, alerts, timezone,
  onDeleteAlert(id), onCreateAlert() }`. Le `FilterChip` local d'`OpenMatches` migre dedans
  (même style : actif = encre pleine + coche, inactif = contour fin). L'état déplié/replié du
  slider est local au composant.
- **`OpenMatches.tsx`** garde toute la logique (fetch, `fMin/fMax`, `kindFilter`, `alerts`,
  suppression optimiste, ouverture de `MatchAlertSheet`) et rend `<MatchesFilterBar …/>` à la
  place des 5 étages actuels.

## Tests

- **Nouvelle suite** `frontend/__tests__/MatchesFilterBar.test.tsx` : groupe Niveau masqué si
  anonyme/pas de niveau ; chip préset actif ; « Régler » déplie le slider ; fourchette custom →
  chip `Niveau x–y` actif ; chips Type togglent ; compteur singulier/pluriel ; chips d'alertes +
  suppression ; pied masqué en anonyme sans filtre.
- **Adaptation** de la suite existante d'`OpenMatches` : les libellés « À mon niveau », « Tous »,
  « Toutes », « Compétitives », « Amicales », « Créer une alerte » subsistent ; les assertions sur
  le slider toujours visible passent par le dépliage « Régler ».
- Vérification visuelle CDP clair + sombre, desktop 1280 + mobile 390 (aucun débordement).

## Hors périmètre

- Vues « Mes matchs » et « Stats » (inchangées).
- Toute évolution des alertes elles-mêmes (feuille `MatchAlertSheet` inchangée).
- Compteurs par chip (façon `agendaCounts` d'Events) — pas nécessaire ici, volumes faibles.
