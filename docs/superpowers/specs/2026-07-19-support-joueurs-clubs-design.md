# Support Palova — joueurs & clubs (design)

**Date** : 2026-07-19
**Statut** : validé par Eric (brainstorming), en attente de plan d'implémentation

## Contexte

Aujourd'hui, le seul canal de support est `contact@palova.fr`, cité dans la FAQ plateforme
(`frontend/lib/platformContent.ts`) et les pages légales. La FAQ plateforme (`PLATFORM_FAQ`,
rendue sur `/faq` via `FaqView`) cible déjà les gérants de club. Le système de signalement
(modération des chats) est un flux distinct et n'est pas du support.

## Décisions de cadrage (validées)

1. **Modèle à 2 étages** (SaaS B2B2C classique) : le **joueur s'adresse à SON CLUB** (résa,
   remboursement, accès…) ; le **club s'adresse à Palova**. Palova ne fait pas de support
   direct joueur, sauf compte/RGPD via `contact@palova.fr`.
2. **Côté joueur : page Aide simple** — FAQ + coordonnées du club. Zéro nouveau backend.
3. **Côté club : fire-and-forget + email** — le formulaire crée une issue GitHub ; accusé de
   réception par email avec un numéro ; Eric répond par email. Pas de suivi in-app en v1.
4. **Repo GitHub dédié `enouga/palova-support`** (privé, séparé du code). Les admins de club
   ne voient **jamais** GitHub — impossible sur un repo privé de donner accès aux issues sans
   donner accès au code ; le pont est l'API GitHub côté backend, avec un token bot.
5. **Tout le staff peut envoyer un ticket** (OWNER/ADMIN/STAFF) — c'est souvent le staff au
   comptoir qui rencontre le bug ; le rôle est indiqué dans le ticket.
6. **4 catégories** : Bug / Question / Suggestion / Facturation (une = un label GitHub).

## 1. Côté joueur — page `/aide` (hôte club, publique)

- **Entrées** : lien « Aide » dans le `ProfileMenu` (icône `info`) + lien dans le `Footer`
  global. Page **publique** : `/aide` ajouté à `PUBLIC_PATHS` (`lib/authGate.ts`) — un
  visiteur anonyme peut la lire (les coordonnées du club sont déjà publiques sur `/club`).
- **Sur l'hôte plateforme**, `/aide` **redirige vers `/faq`** (la FAQ plateforme existante) —
  même pattern que `/decouvrir` sur un hôte club (redirection au montage, chemin public).
- **Contenu** (3 blocs) :
  1. **FAQ joueur** : nouveau contenu statique **`PLAYER_FAQ`** (nouveau fichier
     `frontend/lib/helpContent.ts`, même forme que `PlatformFaqEntry`), rendu via le composant
     `FaqView` existant. Catégories : Réserver, Annuler & déplacer, Payer, Parties & niveau,
     Mon compte. Contenu générique plateforme (pas personnalisable par club en v1).
  2. **Carte « Contacter le club »** : téléphone (`tel:`), email (`mailto:`), adresse, horaires
     — données déjà en base et déjà servies par la route publique `GET /:slug/presentation`
     (`contactPhone`, `contactEmail`, `openingHoursText`) + l'adresse du club (`useClub`).
     Champs absents → lignes masquées ; aucune coordonnée → la carte affiche l'accueil du club
     sans moyen de contact (cas rare, le club est invité à remplir sa page dans `/admin/club`).
  3. **Encart « Un problème avec votre compte Palova ? »** : mailto `contact@palova.fr` —
     le seul cas où Palova parle directement au joueur (compte, RGPD).
- **Zéro nouveau backend** pour ce volet.

## 2. Côté club — page `/admin/support`

- **Entrée nav « Support »** en fin de sidebar (`app/admin/layout.tsx`), icône `info`,
  visible pour tous les rôles staff (pas de gate rôle).
- **Contenu** :
  1. **FAQ gérant** : réutilise `PLATFORM_FAQ` telle quelle (déjà écrite pour les gérants),
     rendue via `FaqView`, au-dessus du formulaire (déflection : la moitié des questions ont
     déjà leur réponse).
  2. **Formulaire de ticket** : catégorie en chips (Bug / Question / Suggestion / Facturation),
     sujet (`input`, 3–120 caractères), description (`textarea`, 10–5000 caractères).
     **Pas de pièce jointe en v1** (pas d'API propre d'attachement d'images aux issues GitHub).
  3. **Note de transparence** sous le formulaire : « Votre nom, votre email et le nom du club
     sont transmis avec votre demande pour que nous puissions vous répondre. »
- **Succès** : bandeau « Demande **#42** transmise — nous vous répondons par email à
  {email}. » (sans numéro si le repli email a été emprunté, cf. §3). Formulaire vidé.
- **Erreurs mappées** : `RATE_LIMITED` → « Vous avez envoyé beaucoup de demandes, réessayez
  dans une heure. » ; `SUPPORT_UNAVAILABLE` (et tout échec réseau) → « Impossible d'envoyer
  votre demande. Réessayez, ou écrivez-nous à contact@palova.fr. » ; `VALIDATION_ERROR` →
  messages de champ.

## 3. Backend — `SupportService` + API GitHub

- **Route** : `POST /api/clubs/:clubId/admin/support/tickets`, gate `requireClubMember('STAFF')`.
  Body `{ category: 'BUG'|'QUESTION'|'SUGGESTION'|'BILLING', subject, description }`.
  Réponse `201 { number: number | null }`.
- **Validation** : catégorie dans l'enum, sujet 3–120, description 10–5000, sinon
  `VALIDATION_ERROR` 400.
- **Rate limit** : `assertRateLimit('support', userId, 5, 3600)` (réutilise
  `backend/src/services/rateLimit.ts`, fail-open) → `RATE_LIMITED` 429.
- **`SupportService.createTicket(clubId, userId, input)`** (nouveau
  `backend/src/services/support.service.ts`) :
  1. Charge club (nom, slug), expéditeur (nom, email), rôle staff (`ClubMember`), et le
     palier billing observé si disponible (best-effort, jamais bloquant).
  2. Construit l'issue :
     - **Titre** : `[{Catégorie}] {sujet} — {nom du club}`
     - **Labels** : un par catégorie (`bug` / `question` / `suggestion` / `facturation`)
     - **Body** (markdown) : bloc contexte (club + `slug.palova.fr`, expéditeur nom/email/rôle,
       catégorie, palier, date ISO) puis `---` puis la description **en bloc de citation**
       (chaque ligne préfixée `> ` — neutralise les titres/mentions accidentels ; GitHub
       échappe le HTML nativement, pas d'autre sanitisation).
  3. **Appel GitHub** : `POST https://api.github.com/repos/{GITHUB_SUPPORT_REPO}/issues`,
     header `Authorization: Bearer {GITHUB_SUPPORT_TOKEN}` + `X-GitHub-Api-Version`,
     `fetch` natif avec timeout ~10 s (`AbortController`). Succès → `{ number }`.
  4. **Repli si GitHub échoue** (réseau, 4xx/5xx, timeout) : envoi du même contenu par email
     à `SUPPORT_FALLBACK_EMAIL` (défaut `contact@palova.fr`) via le `sendMail` générique
     existant → réponse `{ number: null }`, le gérant voit quand même un succès.
     **Jamais de ticket perdu.** Si l'email de repli échoue AUSSI → `SUPPORT_UNAVAILABLE` 502.
  5. **Accusé de réception** au gérant, **best-effort** (`.catch` loggé, jamais bloquant) :
     email **identité Palova** (builder pur `buildSupportAckEmail` dans
     `src/email/templates/`, layout Palova — **PAS un email personnalisable club** : c'est
     Palova qui parle au club, pas le club à un joueur ; hors registre `/admin/emails`).
     Sujet : « Votre demande #42 a bien été reçue » (sans numéro en mode repli).
- **Config env** : `GITHUB_SUPPORT_TOKEN`, `GITHUB_SUPPORT_REPO` (ex. `enouga/palova-support`),
  `SUPPORT_FALLBACK_EMAIL` (défaut `contact@palova.fr`). **Sans token en dev** : mode console
  (l'issue est loggée, réponse `{ number: null }`) — même pattern que le SMTP. À ajouter à
  `.env.prod.example` + `docker-compose.prod.yml`.
- **Aucune migration** : rien n'est stocké en base, GitHub Issues est la source de vérité.

## 4. Sécurité & anti-abus

- Le gérant ne voit jamais GitHub ; le numéro de ticket est la seule fuite (anodine).
- **Token = fine-grained PAT** scopé au **seul repo `palova-support`**, permission
  **Issues : Read & write** uniquement (+ Metadata implicite). Même compromis, ce token ne
  peut pas lire le code de `enouga/palova`.
- Rate limit 5 tickets/heure/utilisateur (partagé toutes catégories).
- PII minimale dans l'issue (nom, email, club — annoncée par la note de transparence).
- La description est insérée en bloc de citation markdown ; repo privé, lectorat = Eric.

## 5. Tests

- **Backend** : `support.service.test.ts` (payload titre/labels/body, succès GitHub → number,
  échec GitHub → email de repli + `number: null`, échec des deux → `SUPPORT_UNAVAILABLE`,
  accusé best-effort non bloquant, mode console sans token) ;
  `admin.support.routes.test.ts` (STAFF 200, non-membre 403, validation 400, rate limit 429).
- **Frontend** : `AdminSupport.test.tsx` (formulaire, chips, envoi → « #42 », succès sans
  numéro, erreurs mappées, note de transparence, FAQ gérant rendue) ; `AidePage.test.tsx`
  (FAQ joueur, coordonnées du club, champs absents masqués, mailto Palova, redirection
  plateforme → `/faq`) ; `ProfileMenu` (lien Aide) ; `AdminLayout` (entrée Support) ;
  `authGate` (`/aide` public).

## 6. Prérequis manuels (Eric)

1. Créer le repo privé **`enouga/palova-support`** + les 4 labels (`bug`, `question`,
   `suggestion`, `facturation`).
2. Générer le **fine-grained PAT** : Resource owner `enouga` → Only select repositories →
   `palova-support` → Repository permissions → Issues : Read and write. Expiration longue,
   à renouveler (noter la date).
3. Ajouter `GITHUB_SUPPORT_TOKEN` + `GITHUB_SUPPORT_REPO` au `.env.prod` de la VM.
4. SMTP prod branché (prérequis global déjà connu) pour l'accusé et le repli email.

## 7. Hors v1 (parqué)

- Suivi in-app des tickets (statut, page « Mes demandes ») et sync GitHub → app (webhook).
- Conversation bidirectionnelle in-app.
- Pièces jointes / captures d'écran.
- Chat live, outil tiers (Crisp…).
- Support direct joueur par Palova (hors compte/RGPD).
- FAQ joueur personnalisable par club, recherche dans la FAQ.
- Notification in-app « votre demande a reçu une réponse ».
