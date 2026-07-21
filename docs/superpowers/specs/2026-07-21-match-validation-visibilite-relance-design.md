# Validation d'un match : visibilité (qui a validé) + relance manuelle

**Date :** 2026-07-21
**Statut :** spec validée (design approuvé, option A pour l'email)

## Problème

Quand un joueur saisit le résultat d'un match padel, les 3 autres doivent le **confirmer**
(ou le contester). Aujourd'hui, dans « Mes matchs » (`MyMatchesList`), un match en attente
affiche seulement une étiquette **globale** « En attente de confirmation » et, pour le viewer,
les boutons **Confirmer / Contester**. Deux manques :

1. **On ne voit pas qui a validé et qui manque** — l'info n'est même pas envoyée au client
   (le payload `/api/me/matches` réduit chaque joueur à `{ nom, équipe, isMe }`, sans son
   champ `confirmation`).
2. **On ne voit pas que ça se valide tout seul** — Palova finalise déjà automatiquement un
   match `PENDING` **72 h** après la saisie (`MatchService.autoValidateDue`, appelé chaque
   minute par `cleanup.job`), mais rien ne l'indique → impression que « ça ne bouge pas ».
3. **Pas de moyen de relancer** un joueur qui traîne.

Comparatif Playtomic/Pista : le résultat s'**auto‑valide après un délai** (sauf contestation),
avec une notif de validation aux autres joueurs ; on **voit qui a validé** et un compte à
rebours ; la relance manuelle y est marginale (le délai + les push font le travail). Palova a
déjà l'auto‑validation ; ce qui manque est surtout la **visibilité**, plus une **relance à la
demande**.

## Périmètre

- **Uniquement les matchs `PENDING`**, dans le composant partagé `MyMatchesList` (utilisé par
  Parties → « Mes matchs », `/me/matches`, et l'onglet Matchs de `/me/reservations`).
- Les cartes `CONFIRMED` / `DISPUTED` / `CANCELLED` sont **inchangées**.
- **Aucune migration** : toutes les données existent déjà (`MatchPlayer.confirmation`,
  `Match.confirmDeadline`).

### Hors périmètre (YAGNI)

- Page « match » publique partagée façon Pista (offre séparée, pas maintenant).
- Relance **automatique** (job) — on garde uniquement le bouton manuel.
- Modifier la fenêtre d'auto‑validation (reste 72 h).
- Relancer un match « à saisir » (personne n'a encore saisi) — ce cas a déjà son propre
  rappel post‑match 15 min (`notifyMatchResultPrompt`).
- Cooldown par destinataire (on fait un cooldown **par match**).

## Décisions de conception

- **Qui peut relancer** : n'importe quel joueur du match.
- **Cible de la relance** : uniquement les joueurs encore `PENDING`, **hors l'émetteur**.
- **Canaux** : push + in‑app + email.
- **Anti‑spam** : 1 relance / 12 h **par match** (clé = matchId).
- **Email** (option A retenue) : **réutiliser** le type existant `match.pending_confirmation`
  (personnalisable dans `/admin/emails`) comme rappel — **aucun nouveau type**.

## Backend

### 1. DTO enrichi — `GET /api/me/matches` (`backend/src/routes/me.ts`)

Aucune requête nouvelle (les champs sont déjà sélectionnés / triviaux à ajouter au `select`).

- Chaque entrée de `players` gagne **`confirmation`** (`'PENDING' | 'CONFIRMED' | 'DISPUTED'`)
  — issu de `MatchPlayer.confirmation` (ajouter au `select` des `players`).
- La sortie du match gagne **`confirmDeadline`** (ISO) — déjà sélectionné (ligne 288), juste
  absent du `res.json` de sortie.

### 2. Nouvelle route — `POST /api/matches/:id/remind` (`backend/src/routes/matches.ts`)

Posée à côté de `confirm`/`dispute`, même style (`authMiddleware`, `matchError`).

- `matchError` : **ajouter `RATE_LIMITED: 429`** au map (les autres codes utilisés existent
  déjà : `MATCH_NOT_FOUND` 404, `NOT_A_MATCH_PLAYER` 403, `MATCH_NOT_PENDING` 409).
- Handler : `await matchService.remind(id, req.user!.id)` → `res.json({ reminded: n })`.

### 3. `MatchService.remind(matchId, byUserId)` (`backend/src/services/match.service.ts`)

1. Charger le match + `players { userId, confirmation }`.
2. `!match` → `MATCH_NOT_FOUND`.
3. `byUserId` non joueur → `NOT_A_MATCH_PLAYER`.
4. `status !== 'PENDING'` → `MATCH_NOT_PENDING`.
5. `recipients` = joueurs `confirmation === 'PENDING'` **et** `userId !== byUserId`.
   Si vide → retour `{ reminded: 0 }` **sans consommer le quota** (cas de bord : le viewer est
   le seul en attente ; le bouton ne s'affiche de toute façon pas côté front).
6. `assertRateLimit('match:remind', matchId, 1, 43200)` (12 h) → lève `RATE_LIMITED` si déjà
   relancé (fail‑open si Redis KO, cohérent avec les autres usages).
7. `this.safeNotify(() => notifyMatchReminder(matchId, recipients.map(r => r.userId)))`
   (best‑effort, un échec SMTP/push ne fait jamais échouer la relance).
8. Retour `{ reminded: recipients.length }`.

### 4. `notifyMatchReminder(matchId, recipientUserIds)` (`backend/src/email/notifications.ts`)

Calqué sur `notifyMatchPendingConfirmation`, mais **ciblé** sur une liste de destinataires
fournie et **sans coalescing** (une relance doit repartir même si une notif précédente est
non lue).

- Charge match + club + sport + auteur (nom) + score (`setsToScoreLine`).
- Pour chaque destinataire : notif **in‑app + push** (type `match.pending_confirmation`,
  url `/me/matches`, message tourné « rappel ») **+ email** via
  `renderClubEmail('match.pending_confirmation', vars, brand, override)` — **même template que
  la confirmation** (option A). Best‑effort par destinataire.

## Frontend

### Types (`frontend/lib/api.ts`)

- `MyMatchPlayer` gagne `confirmation?: 'PENDING' | 'CONFIRMED' | 'DISPUTED'` (optionnel,
  convention des champs additifs).
- `MyMatch` gagne `confirmDeadline?: string`.
- `remindMatch: (matchId, token) => request('/api/matches/${id}/remind', { method:'POST' }, token)`.

### `MyMatchesList` (`frontend/components/match/MyMatchesList.tsx`) — cartes `PENDING` seulement

- **Pastille de validation** sur chaque avatar du tableau de score : ✓ (vert `ACCENTS.emerald`)
  si `confirmation === 'CONFIRMED'`, ⏳/point gris si `PENDING`, ⚠ si `DISPUTED`. Petit badge
  ancré sur l'avatar (comme le badge de niveau du profil).
- Ligne **« N/4 validé »** sous le tableau (N = nb `CONFIRMED`).
- **Compte à rebours** « ✅ Validé automatiquement le {date fr} » à partir de `confirmDeadline`
  (helper de date déjà présent, `now` posé en effet — pas de `new Date()` au rendu, hydration‑safe).
  Si `confirmDeadline` est déjà passé (job pas encore repassé) → « Validation en cours… ».
- Bouton **« 🔔 Relancer »** : visible tant qu'il reste **≥ 1 joueur `PENDING` autre que le
  viewer**. Clic → `api.remindMatch` → toast « Relance envoyée ». Sur `429` (`RATE_LIMITED`) →
  message « Déjà relancé, réessaie plus tard ». Garde `busy` anti double‑clic.
- Cohabite avec les boutons **Confirmer / Contester** existants (inchangés) quand
  `needsMyConfirmation`.

## Tests

**Backend**
- `me.routes` : le DTO expose `confirmation` par joueur + `confirmDeadline`.
- `match.service` (`remind`) : non‑joueur → `NOT_A_MATCH_PLAYER` ; match non `PENDING` →
  `MATCH_NOT_PENDING` ; cible = uniquement les `PENDING` hors émetteur ; `reminded:0` si aucun
  en attente (sans consommer le quota) ; 2ᵉ appel dans la fenêtre → `RATE_LIMITED`.
- `matches.routes` : `POST /:id/remind` → 200 `{ reminded }`, 403 non‑joueur, 409 non‑PENDING,
  429 rate‑limited.
- `notifications.*` : `notifyMatchReminder` cible bien la liste fournie, ne coalesce pas.

**Frontend**
- `MyMatchesList` : pastilles ✓/⏳ selon `confirmation` ; « N/4 validé » ; compte à rebours
  d'auto‑validation ; bouton Relancer visible ssi ≥1 pending autre que soi ; toast au succès ;
  message sur `429`.

## Notes de mise en œuvre

- La route vit dans `matches.ts` (montée `/api/matches`), à côté de `confirm`/`dispute`.
- `assertRateLimit` (`backend/src/services/rateLimit.ts`) est **fail‑open** : Redis KO ⇒ la
  relance passe (acceptable — mieux vaut une relance de trop qu'un bouton mort).
- Réutiliser l'email `match.pending_confirmation` signifie qu'un club l'ayant personnalisé
  verra son texte servir **aussi** de rappel (comportement voulu, option A).
