# Renommage des types de partie : « Pour de vrai / Pour le fun »

**Date** : 2026-07-21
**Statut** : validé (Eric)

## Contexte et motivation

Pista vient de renommer ses types de partie « Compétitive / Amicale » en « Partie classée /
Partie loisir ». Ce qui rend leur renommage efficace — et qu'on veut capturer — c'est la
**clarté de la conséquence** : le nom dit immédiatement que le résultat compte (ou non) pour
le classement, au lieu de décrire une ambiance. On veut se rapprocher de cette idée **sans
copier leurs mots** (« classée », « loisir » et leurs proches comme « classante » sont exclus).

Décision : la paire **« Pour de vrai / Pour le fun »** — la voix joueuse de Palova
(« Ça joue bientôt », « Envie de jouer ? »), mémorable, très différenciante face à Pista.
Les libellés portent le ton ; la pédagogie (« le résultat compte pour le niveau ») reste
portée par les sous-titres là où le joueur fait son choix.

## Périmètre

Renommage **100 % frontend** : 7 composants + leurs tests. Aucune migration, aucun
changement backend, aucun changement de comportement.

### Surfaces modifiées (avant → après)

| Fichier | Aujourd'hui | Demain |
|---|---|---|
| `components/reservations/OpenMatchQuickSwitch.tsx` | segmenté « Compétitive · Le résultat compte pour le niveau » / « Amicale · Le niveau ne bouge pas » | segmenté « **Pour de vrai** · Le résultat compte pour le niveau » / « **Pour le fun** · Le niveau ne bouge pas » |
| `components/reservations/OpenMatchToggle.tsx` | segmenté « Compétitive · Compte pour le niveau » / « Amicale · Le niveau ne bouge pas » | segmenté « **Pour de vrai** · Compte pour le niveau » / « **Pour le fun** · Le niveau ne bouge pas » |
| `components/openmatch/OpenMatchCard.tsx` | badge « Compétitive » (accent) / « Amicale » (neutre `tone="line"`) | badge « **Pour de vrai** » (accent) / « **Pour le fun** » (neutre) |
| `components/openmatch/MatchesFilterBar.tsx` | chips « Toutes · Compétitives · Amicales » | chips « Toutes · **Pour de vrai** · **Pour le fun** » (pas d'accord pluriel à gérer) |
| `components/match/MatchResultModal.tsx` | chip d'en-tête « Compétitive/Amicale » + phrase « Partie compétitive — le résultat compte pour le niveau. » / « Partie amicale — le niveau ne bouge pas. » | chip « **Pour de vrai / Pour le fun** » + phrase « **Pour de vrai — le résultat compte pour le niveau.** » / « **Pour le fun — le niveau ne bouge pas.** » |
| `components/match/MyMatchesList.tsx` | puce « Amicale » sur un résultat confirmé non compétitif | puce « **Pour le fun** » |
| `components/match/ResultsToRecord.tsx` | chip « Amicale » si `competitive === false` | chip « **Pour le fun** » |

Les **sous-titres existants des deux switches sont conservés tels quels** (ils diffèrent
légèrement l'un de l'autre aujourd'hui, on ne les unifie pas) — seuls les libellés changent.

### Retouches d'accompagnement

- `lib/api.ts` : mettre à jour le commentaire du champ `competitive` (ligne ~1678) pour
  refléter les nouveaux libellés.
- Commentaires de code devenus obsolètes dans les composants touchés (ex. le commentaire
  « pastille Compétitive » d'`OpenMatchCard`) : réécrits au passage.
- `__tests__/OpenMatches.test.tsx` (~ligne 232) : le commentaire expliquant le match exact
  `name: 'Ami'` (le chip « Amicales » matchait la regex `/Ami/`) devient caduc après le
  renommage — le nettoyer, le matcher exact peut rester.
- Tests mis à jour (assertions de libellés) : `OpenMatchQuickSwitch`, `OpenMatchToggle`,
  `OpenMatchCard`, `MatchesFilterBar`, `OpenMatches`, `MatchResultModal`, `MyMatchesList`,
  `ResultsToRecord`.
- `CLAUDE.md` : note d'évolution sous la section « Parties Amicale / Compétitive (v1) ».

## Invariants (ce qui ne bouge pas)

- **Champ API `competitive`** (booléen) : contrat serveur, DTO et payloads intacts.
- **Défaut** : « Pour de vrai » (`competitive: true`) reste le défaut partout.
- **Verrouillage** : sur une partie ouverte (PUBLIC), le type reste hérité et verrouillé à
  la saisie du résultat (badge figé, pas de segmenté).
- **Gate Glicko backend** (`MatchService.finalize`) : inchangé — les commentaires backend
  qui parlent d'« amicale » restent valides (vocabulaire interne, non affiché).
- **Garde `MATCH_ALREADY_RECORDED`** au changement de type : inchangée.

## Hors périmètre

- Renommer le champ `competitive` côté API/base (coût sans bénéfice utilisateur).
- La carte OG du lien partagé (elle n'affiche pas le type — déjà hors v1 du feature).
- Les emails (aucun email ne mentionne le type de partie).

## Tests / validation

- Suites frontend citées ci-dessus vertes (assertions renommées, pas de nouveau cas —
  le comportement est inchangé).
- `tsc --noEmit` frontend.
- Vérification visuelle CDP (clair + sombre, 390 + 1280) : badges lisibles sur
  `OpenMatchCard` (« Pour de vrai » fait 12 caractères, un de plus que « Compétitive »),
  filtre `/parties` sans débordement horizontal.
