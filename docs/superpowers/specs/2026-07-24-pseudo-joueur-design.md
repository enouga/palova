# Pseudo joueur (affiché dans les parties ouvertes) — design

**Date :** 2026-07-24
**Statut :** validé par Eric.

## Contexte / demande

« Il faudrait pouvoir avoir un pseudo en plus du nom et du prénom, il apparaîtrait dans les
parties quand il sera présent. » Objectif : un joueur peut se choisir un pseudo, affiché à la
place de son prénom/nom dans les parties ouvertes (padel), sans toucher au reste de l'app.

## Décisions de cadrage

- **Format d'affichage** : pseudo **seul** si présent (pas de « Pseudo (Prénom) »). Sans
  pseudo, comportement actuel inchangé (prénom + nom / « Prénom N. » abrégé).
- **Périmètre** : *parties ouvertes uniquement* — liste `/parties`, la carte de partie
  (`OpenMatchCard`), le mini-terrain d'équipes (`MatchTeams`), la page détail
  `/parties/[id]` et son chat. Rien d'autre (calendrier, tournois/events, admin, emails,
  notifications, carte OG de partage, annuaire de recherche de membre).
- **Édition** : onglet Identité de `/me/profile`, via la mécanique baseline/brouillon +
  `SaveBar` différée déjà en place sur cette page.
- **Unicité** : le pseudo doit être unique sur la plateforme.
- **Contraintes de format** : 3–20 caractères, lettres/chiffres/`-`/`_` uniquement (pas
  d'espace ni d'accent), comparaison d'unicité insensible à la casse.

## Modèle & validation (backend)

Migration additive `add_user_pseudo` :

```prisma
model User {
  // ...
  pseudo String? @unique @db.VarChar(20)
}
```

- Format validé par la regex `^[A-Za-z0-9_-]{3,20}$` (après `trim()`).
- Chaîne vide/blanche après trim → traitée comme `null` (effacement du pseudo, toujours
  autorisé, sans contrôle d'unicité).
- Unicité **insensible à la casse** : avant écriture, `prisma.user.findFirst({ where: {
  pseudo: { equals: valeur, mode: 'insensitive' }, NOT: { id: <moi> } } })` — si trouvé,
  409. La contrainte `@unique` en base reste un filet anti-course sur la valeur exacte
  (elle ne couvre pas deux casses différentes soumises en une fraction de seconde — jugé
  négligeable à l'échelle de l'app).
- Codes d'erreur (messages directement en français, comme le reste de la route
  `PATCH /api/me`, pas de code à mapper côté front) :
  - 400 « Le pseudo doit contenir 3 à 20 caractères (lettres, chiffres, - ou _), sans
    espace ni accent. »
  - 409 « Ce pseudo est déjà pris. »
- `PROFILE_SELECT` (backend/src/routes/me.ts) gagne `pseudo: true`.

## Édition dans `/me/profile`

Nouvelle petite carte **« Pseudo »** dans l'onglet Identité (`ProfileIdentity.tsx`), même
patron que les cartes existantes (`CardKicker` + `ProfileInput` + texte d'aide sous le
champ : *« Affiché à la place de votre prénom/nom dans les parties ouvertes, quand il est
renseigné. »*), positionnée en tête de l'onglet (avant « Sport préféré »). Passe par la même
`SaveBar` différée que le reste du profil :

- `lib/api.ts` : `MyProfile.pseudo: string | null`, `updateMyProfile(body)` gagne
  `pseudo?: string | null`.
- `lib/meProfile.ts` : `UpdateProfileBody.pseudo`, `buildProfileBody` inclut
  `pseudo: p.pseudo?.trim() || null` (source unique de vérité du PATCH + du calcul
  `isDirty`, comme les autres champs).
- Aucune validation client-side en amont du Save (cohérent avec les autres champs de cet
  onglet) — l'erreur serveur (format ou pseudo pris) remonte dans la `SaveBar` via
  `saveError`, comme aujourd'hui pour tout échec d'enregistrement.

## Affichage dans les parties ouvertes

### Backend (DTO additifs, aucune rupture)

- `OpenMatchService` : `MATCH_INCLUDE.participants.select.user` gagne `pseudo: true` ;
  `toDTO` (partagé par `listOpenMatches` et `getOpenMatch`, donc par la liste `/parties`
  **et** la page détail `/parties/[id]`) expose `pseudo` par joueur dans `players`.
  `NATIONAL_INCLUDE`/`listNationalOpenMatches` (vitrine `/decouvrir`) **ne sont pas
  touchés** — hors périmètre.
- `OpenMatchChatService` : les selects `user: { select: { id, firstName, lastName,
  avatarUrl } }` (5 occurrences) gagnent `pseudo: true` ; l'objet `author` des DTO de
  message expose `pseudo`.

### Frontend

- `lib/api.ts` : `OpenMatchPlayer.pseudo?: string | null`,
  `OpenMatchMessage.author.pseudo?: string | null` (champs additifs optionnels).
- `MatchTeams.tsx` (`MatchPlayerData.pseudo?: string | null`) : le nom affiché devient
  **pseudo si présent, sinon** le comportement actuel (« Prénom N. » abrégé en colonne
  étroite via `shortNamesById`, sinon nom complet). Ce même libellé (`displayName`)
  remplace aussi les usages de `fullName(p)` dans les `aria-label` (« Modifier X »,
  « Écrire à X ») et dans le `playerName` passé à `PlayerActionSheet` — pour que ce qu'un
  lecteur d'écran annonce corresponde toujours à ce qui est affiché à l'écran.
- `OpenMatchCard.tsx` : passe `pseudo` dans le mapping vers `MatchTeams` ; le `replaceName`
  de l'`AddPlayerSheet` (en-tête de la feuille « remplacer par ») utilise aussi le pseudo
  s'il existe, via un petit helper partagé (`playerLabel` dans `lib/names.ts`) au lieu de
  systématiquement concaténer prénom/nom.
- `OpenMatchChatSheet.tsx` : l'en-tête d'un message (aujourd'hui le seul prénom) devient
  `pseudo ?? firstName`.
- **L'avatar (initiales + couleur) n'est pas affecté** — toujours dérivé de prénom/nom ;
  seul le texte du nom change.

### Hors périmètre, volontairement inchangé

Calendrier « Mes réservations », tournois/events (fiches, inscriptions, table de marque),
back-office admin (fiche membre, planning, caisse…), emails et notifications (in-app/push),
carte OG « lien vivant » du partage (`matchCard.service.ts`), annuaire de recherche de
membre (`AddPlayerSheet`/`PartnerSearch`/`MemberPicker` — chercher un membre à ajouter
affiche toujours son vrai nom), vitrine nationale `/decouvrir`
(`listNationalOpenMatches`).

## Tests prévus

- Backend : validation format/unicité (`me.routes.test.ts`), DTO `pseudo` dans
  `openMatch.service.test.ts` et `openMatchChat.service.test.ts`.
- Frontend : `MatchTeams` (pseudo prioritaire sur le nom, y compris aria-label et feuille
  d'actions), `OpenMatchCard` (mapping + `replaceName`), `OpenMatchChatSheet` (en-tête de
  message), `meProfile`/`MeProfile` (nouveau champ dans `buildProfileBody`/`isDirty`,
  affichage de l'erreur serveur dans la `SaveBar`).

## Ce qui ne change pas

Aucune migration destructive, aucun changement de forme des routes existantes (champs
additifs uniquement), aucun impact sur les avatars, aucun impact sur les autres surfaces de
l'app listées ci-dessus.
