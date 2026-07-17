# Résultats à saisir — carte compacte + feuille « tableau de score »

**Date** : 2026-07-16
**Statut** : validé (directions choisies par Eric sur maquettes comparées dans le companion visuel : carte A « une carte, une ligne par match », saisie A « tableau de score + pavé 0–7 »)
**Périmètre** : 100 % frontend — aucune migration, aucun changement backend, aucune route.

## Problème

La carte « Résultat à saisir » en feuille de match (commit `f52d6a9`) prend ~230 px **par match** (en-tête + 2 rangées d'équipe avec cases de sets + footer), empilée en haut du Club-house, de `/parties` et de `/me/matches` : deux matchs en retard mangent tout l'écran. La modale de saisie (`MatchResultModal`) reste l'ancien écran à steppers −/+, jugé déplaisant.

## 1. Carte « Résultats à saisir » (`ResultsToRecord.tsx`)

**Une seule carte** pour tous les matchs à saisir (au lieu d'une carte par match) :

- Conteneur : `th.surface`, `borderRadius 18`, `th.shadow` (inchangé), **en-tête kicker** « Résultats à saisir · N » (singulier « Résultat à saisir » sans compteur si N = 1).
- **Une ligne par match**, séparées par un filet `th.line` :
  - **Grappe des 4 avatars** qui se chevauchent (taille ~26, chevauchement ~-28 %, liseré `th.surface`, `colorForSeed(userId)`), dans l'ordre équipe 1 puis équipe 2 (`teamRows` réutilisé).
  - **Ligne de noms** : « Lucas & Jean **vs** Céline & Mélanie » — **prénoms seuls**, « vs » en petit `textFaint` ; en cas de doublon de prénom au sein du match, désambiguïsation par l'initiale du nom (« Jean D. & Jean M. »). Troncature ellipsis, jamais de retour à la ligne ni de débordement.
  - **Ligne méta** : `mer. 15 juil. · 22h30 · Padel int 2` (`fmtWhen` existant + `resourceName`), petit, `textMute`, mono comme l'ancien footer.
  - **Chip « Amicale »** (`Chip tone="line"`, petite) à côté de la méta **uniquement si `competitive === false`** — la compétitive est le défaut, on ne l'affiche plus sur la carte (le type reste toujours visible dans la feuille de saisie).
  - **CTA pill « Saisir »** (`th.accent`/`th.onAccent`), à droite, `flexShrink: 0`.
- **Disparaissent** : les cases de sets décoratives (`SetBoxes`), les rangées d'équipe (`TeamRow`), le footer par match, la chip Compétitive.
- **Plus de mode `compact` dédié** (`useIsDesktop(560)` retiré) : la ligne est fluide — noms tronqués, tailles fixes. Vérifier 320–390 px sans débordement horizontal.
- Comportement inchangé : rendu `null` sans token ou sans matchs, filtre `clubSlug`, clic « Saisir » → `MatchResultModal` avec les mêmes props, `reload()` + `onRecorded?.()` après enregistrement.
- Budget : 2 matchs ≈ 150 px (au lieu de ~480).

### Helpers (`lib/resultsToRecord.ts`)

- `teamRows` inchangé.
- Nouveau helper pur pour la ligne de noms (prénoms + désambiguïsation par initiale en cas de collision), testé ; `abbrevName` supprimé s'il n'a plus de consommateur.

## 2. Feuille de saisie (`MatchResultModal.tsx`)

**Contrat externe inchangé** (mêmes props : `reservationId, players, token, onClose, onSaved, context, initialTeams, competitive, locked` ; même payload `api.recordMatchResult({ teams, sets, competitive })`) — seuls l'intérieur et l'interaction changent. Les 3 points d'entrée (carte, `/me/reservations`, `OpenMatchModals`) ne bougent pas. Overlay actuel conservé (bottom-sheet mobile / centré desktop).

### En-tête

- Titre « Saisir le résultat » + ligne contexte (`fmtContext` existant).
- **Type en haut à droite** :
  - `locked` (partie ouverte) → chip statique « Compétitive » (accent) ou « Amicale » (line), + la phrase d'explication actuelle en dessous.
  - non verrouillé (privée) → **mini-segmenté 2 chips** `[Compétitive | Amicale]` (remplace les deux gros boutons à sous-titres) ; le sous-libellé de l'option active (« Compte pour le niveau » / « Le niveau ne bouge pas ») s'affiche en petit dessous.

### Tableau de score

- Rangée de labels `S1 S2 S3` alignée au-dessus des colonnes de cases.
- **2 rangées équipe** : paire d'avatars en grappe + prénoms (« Lucas & Jean »), puis **3 cases** (~34×40, coins 9) ; séparateur « vs » fin entre les deux.
- États d'une case : **vide** = pointillés `th.lineStrong` (S3 estompée tant que non requise) ; **remplie** = bord plein neutre + chiffre ; **active** = bord accent 2 px + fond teinté ; **set complet** = case du camp gagnant en accent plein (encre `inkOn`), perdant en neutre rempli.
- **Pavé** sous le tableau : touches `0–7` + `⌫`, tuiles `th.surface2`.
- **Interaction** :
  - Case active initiale = S1 équipe 1. Taper un chiffre remplit la case et **auto-avance** : S1 haut → S1 bas → S2 haut → S2 bas → S3 haut → S3 bas.
  - Après S2 bas, si un vainqueur est déjà acquis (2–0), **pas d'auto-avance** vers S3 (le 3ᵉ set reste facultatif et vide → non envoyé).
  - **Taper n'importe quelle case** la sélectionne pour corriger.
  - `⌫` efface la case active ; si elle est déjà vide, recule d'une case.
- Sous le capot, l'état reste des `SetScore[]` ; un set existe dès qu'une de ses deux cases a une valeur. **`validSets`/`winnerFromSets` (`lib/match`) inchangés.** Les contrôles « + Ajouter un set » / « × » disparaissent (les 3 colonnes sont toujours visibles).

### Pied

- **CTA « Enregistrer »** : désactivé tant que composition 2v2 + `validSets` + vainqueur ne sont pas réunis ; quand valide, il porte le résumé — « Enregistrer — Victoire Lucas & Jean 2–0 ». Lien « Annuler » conservé. Erreur API en ligne coral (existant).

### Cas « équipes non pré-remplies 2v2 »

Détection `preFilled2v2` conservée. Si incomplet : **étape 1 = affectation** (UI actuelle joueur → Éq.1/Éq.2, léger restyle) avec bouton « Continuer » actif à 2v2, **étape 2 = tableau de score**. « Modifier les équipes » depuis le tableau ramène à l'étape 1. Contrainte 4 joueurs / 2 par équipe inchangée.

## Tests

- `__tests__/ResultsToRecord.test.tsx` réécrit : une seule carte avec N lignes ; ligne de noms (prénoms, vs) ; méta ; chip « Amicale » présente seulement si `competitive === false` ; clic « Saisir » ouvre la modale du bon match ; rendu null si vide.
- `lib/resultsToRecord` : tests du helper de noms (prénoms, collision → initiales).
- `__tests__/MatchResultModal.test.tsx` réécrit : pavé remplit + auto-avance ; skip S3 si 2–0 ; correction en tapant une case ; `⌫` ; CTA désactivé/résumé ; payload `recordMatchResult` inchangé ; chip verrouillée vs segmenté ; étape d'affectation quand `initialTeams` incomplet.
- Vérification visuelle CDP clair + sombre, desktop 1280 + mobile 390 (aucun débordement horizontal).

## Hors périmètre

- Backend, migrations, routes (rien ne change).
- Scores > 7 / tie-break détaillé / super tie-break (le plafond 0–7 actuel reste).
- Les autres surfaces de saisie éventuelles (le contrat de la modale ne bouge pas).
- La carte OG « lien vivant » et les emails de match.
