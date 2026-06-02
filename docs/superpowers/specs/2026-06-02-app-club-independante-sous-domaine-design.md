# App club indépendante par sous-domaine + home club + pop-ups vers le haut

**Date** : 2026-06-02
**Projet** : PadelConnect / SlotPadel (frontend Next.js 16 + backend Express/Prisma 7)
**Statut** : design validé, en attente de relecture utilisateur avant plan d'implémentation

## 1. Objectif

Trois demandes utilisateur :

1. **Dissocier l'annuaire/recherche de clubs de l'app par club.** Chaque club doit avoir une application **vraiment indépendante**, servie (à terme) sur son propre **sous-domaine** (`<slug>.slotpadel.fr`). L'annuaire et la recherche appartiennent à la plateforme, jamais à l'app club.
2. **Ajouter une page d'accueil par club** (sur `/` du sous-domaine) avec des sections **annonces**, **notifications**, **sponsors**, et un **hub de liens** vers toutes les pages.
3. **Aligner les pop-ups de réservation et d'annulation vers le haut** (top-sheet au lieu de bottom-sheet).

## 2. Décisions validées

| Sujet | Choix |
|------|-------|
| Architecture | **A** — un seul codebase Next.js, deux « faces » selon le host, résolution via `proxy.ts` |
| Session joueur entre sous-domaines | **a1** — session **partagée** via cookie sur le domaine racine |
| « Mes réservations » sur un host club | **ce club uniquement** |
| Back-office club | sur le sous-domaine du club (`<slug>.host/admin`), club résolu **depuis le host** |
| Domaine racine | piloté par env `NEXT_PUBLIC_ROOT_DOMAIN` ; dev = `localhost`, prod renseigné à la MEP |
| Dev local | sous-domaines `*.localhost` (résolus vers 127.0.0.1 sans toucher au fichier hosts) |
| `/c/[slug]` historique | conservé en **redirection** vers le sous-domaine |
| Sections home (annonces/sponsors) | **option 1** — vrais modèles BDD + back-office (CRUD) + endpoints publics |
| « Notifications » | rappels du **joueur connecté** (dérivés de l'existant, aucun nouveau modèle) |
| Route de réservation | **`/reserver`** (ex-contenu de `/c/[slug]`) |
| Pop-ups | **top-sheet** (ancrés en haut) |

## 3. Architecture de routing

### 3.1 `proxy.ts` (le « middleware » de Next 16)

Nouveau fichier `frontend/proxy.ts`. À chaque requête :

- Lit le `host`, retire le port. `ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'localhost'`.
- **Host plateforme** = `ROOT`, `www.<ROOT>`, `app.<ROOT>` (et `localhost` nu en dev) :
  - laisse passer la plateforme ;
  - redirige `GET /c/:slug*` → `http://:slug.<ROOT>(:port)/` (rétro-compat des anciens liens).
- **Host club** = tout autre host de la forme `<slug>.<ROOT>` :
  - extrait `slug` (premier label) et injecte le header de requête `x-club-slug=<slug>` via `NextResponse.next({ request: { headers } })` ;
  - redirige `/clubs` et `/clubs/new` vers le domaine plateforme (l'annuaire et la création n'existent pas dans l'app club).
- `matcher` excluant `/_next`, assets statiques, et routes API internes éventuelles.

### 3.2 Les deux faces

**Plateforme** (`localhost:3000`) — inchangée sauf liens sortants :
- `/` landing · `/clubs` annuaire + recherche · `/clubs/new` création de club.
- Les cartes de l'annuaire (`ClubCard`) pointent vers **`http://<slug>.localhost:3000/`** (lien absolu cross-sous-domaine) au lieu de `/c/<slug>`.

**Club** (`<slug>.localhost:3000`) — tous brandés club :
- `/` **home club** (hub : annonces / notifications / sponsors / liens) — NOUVEAU
- `/reserver` réservation (ex-`/c/[slug]` : onglets Réserver/Terrains, `BookingModal`)
- `/courts/[id]` détail terrain · `/login` · `/register` · `/me/reservations` · `/admin/*`

## 4. Branding remonté au layout (cœur de l'indépendance)

Aujourd'hui le branding club est appliqué **par page** (`/c/[slug]` et `/courts/[id]` ré-emballent un `<ThemeProvider accent=…>`). Pour que **toute** l'app club porte l'identité du club :

- Nouveau **`ClubProvider`** (client, `lib/ClubProvider.tsx`) :
  - reçoit `slug` en prop (lu depuis le header `x-club-slug` par le `layout.tsx` serveur via `headers()`) ;
  - si `slug` présent : `api.getClub(slug)`, expose `useClub() → { club, slug }`, et **emballe ses enfants dans `<ThemeProvider accent={club.accentColor} defaultMode={club.defaultThemeMode}>`** ;
  - si pas de `slug` (plateforme) : pas de club, `ThemeProvider` par défaut (lime).
- `app/layout.tsx` (serveur) lit le header et rend `<ClubProvider slug={slug}>{children}</ClubProvider>` à la place du `<ThemeProvider>` direct.
- On **retire** les `<ThemeProvider accent>` internes de l'actuel `/c/[slug]` et de `/courts/[id]` (héritent désormais du layout).
- **Compromis assumé** : le club étant fetché côté client, bref flash de l'accent (lime → couleur club) au premier rendu d'une page club. Acceptable en dev ; pré-peinture via fetch serveur possible plus tard (hors-scope).

## 5. Home club (`/` sur host club)

Nouveau composant `ClubHome` rendu par `app/page.tsx` quand `useClub()` a un club (sinon : landing plateforme actuelle).

Sections, dans l'ordre :

1. **En-tête club** : logo/nom du club, `ThemeToggle`, `MyBookingsButton` (si connecté), `LogoutButton` (si connecté). Le `Logotype` pointe vers `/` (home club).
2. **Notifications** (joueur connecté uniquement) : dérivées de `api.getMyReservations(token)` filtrées sur ce club → prochaine(s) réservation(s) à venir ; + badge statut abonné (`getMySubscriptions`). Masqué si déconnecté ou rien à afficher.
3. **Annonces** : liste des annonces publiées du club (`api.getClubAnnouncements(slug)`), triées (épinglées d'abord puis date décroissante). Carte = titre, corps, date, image/lien optionnels. Section masquée si vide.
4. **Sponsors** : grille/bandeau de logos cliquables (`api.getClubSponsors(slug)`), triés par `sortOrder`. Section masquée si vide.
5. **Hub de liens** : cartes/boutons vers `Réserver` (`/reserver`, onglet Réserver par défaut), `Terrains` (`/reserver?tab=courts` → l'onglet Terrains est présélectionné depuis le query param), `Mes réservations` (si connecté), `Contact / abonnement`, `Back-office` (si membre du club), `Connexion` / `Inscription` (si déconnecté).

La réservation elle-même = `app/reserver/page.tsx`, reprise de l'actuel `ClubContent` de `/c/[slug]`, mais lit le club via `useClub()` au lieu de `useParams()`.

## 6. Modèles de données (back-office géré — option 1)

Migration **additive** `add_announcements_sponsors` (pas de reset, cohérent avec `add_payments`).

### 6.1 `Announcement`
```
id          String   @id @default(cuid())
clubId      String
club        Club     @relation(...)
title       String
body        String                    // texte (peut être multi-ligne)
linkUrl     String?
imageUrl    String?
isPublished Boolean  @default(true)
pinned      Boolean  @default(false)
createdAt   DateTime @default(now())
updatedAt   DateTime @updatedAt
@@index([clubId])
```

### 6.2 `Sponsor`
```
id        String   @id @default(cuid())
clubId    String
club      Club     @relation(...)
name      String
logoUrl   String                      // URL collée (cohérent avec branding logo MVP, pas d'upload)
linkUrl   String?
sortOrder Int      @default(0)
isActive  Boolean  @default(true)
createdAt DateTime @default(now())
@@index([clubId])
```

`Club` reçoit les relations inverses `announcements Announcement[]` et `sponsors Sponsor[]`.

### 6.3 Endpoints

**Publics** (host club, lecture) :
- `GET /api/clubs/:slug/announcements` → annonces `isPublished` (épinglées d'abord, puis `createdAt` desc).
- `GET /api/clubs/:slug/sponsors` → sponsors `isActive` triés `sortOrder`.

**Back-office** (scopés club, `requireClubMember('STAFF')`, mêmes conventions que les routes existantes `/api/clubs/:clubId/admin/...`) :
- Annonces : `GET` (toutes, incl. brouillons) · `POST` · `PATCH /:id` · `DELETE /:id`.
- Sponsors : `GET` · `POST` · `PATCH /:id` · `DELETE /:id`.

Services : `announcement.service.ts`, `sponsor.service.ts` (vérif club via `clubId`, comme `reservation.service`/`payment`).

### 6.4 Back-office (frontend)
- Nouvelles pages `app/admin/announcements/page.tsx` et `app/admin/sponsors/page.tsx` (liste + formulaire créer/éditer + supprimer), thémées comme le reste du back-office.
- Entrées ajoutées à la nav admin (`app/admin/layout.tsx`).
- `lib/api.ts` : `getClubAnnouncements`, `getClubSponsors` (publics) + `adminGet/Create/Update/Delete` pour Announcement et Sponsor + types.

### 6.5 Seed
Le seed ajoute 1-2 annonces et 1-2 sponsors de démo au club `club-demo` (idempotent via upsert), pour que la home ait du contenu en dev.

## 7. Session partagée entre sous-domaines (a1)

L'auth reste **Bearer** vers l'API unique (`localhost:3001`) — **aucun changement backend**. Seul le **stockage** du token change : de `localStorage` (isolé par origine) vers un **cookie de domaine** partagé par tous les `*.<ROOT>`.

- `lib/useAuth.ts` : lit `token` et `clubId` depuis le cookie au lieu de `localStorage`.
- Login (`app/login`), register (`app/register`, `app/clubs/new`) : écrivent le cookie
  `document.cookie = "token=<jwt>; domain=<COOKIE_DOMAIN>; path=/; SameSite=Lax; max-age=…"`.
- `logout()` : efface le cookie (même `domain`/`path`).
- `COOKIE_DOMAIN = process.env.NEXT_PUBLIC_COOKIE_DOMAIN` ; dev = `localhost` (partagé par `*.localhost`), prod = `.<ROOT>` à la MEP.
- Posture de sécurité inchangée (le token était déjà lisible en JS via `localStorage`).
- **Back-office** : le `clubId` actif est résolu **depuis le host** (slug → club) et vérifié contre `api.getMyClubs(token)` (membre de CE club ?), au lieu du `clubId` stocké. Le gating reste purement UX (sécurité réelle = `requireClubMember` backend).

## 8. Pop-ups vers le haut (top-sheet)

`components/BookingModal.tsx` et `components/ui/ConfirmDialog.tsx` :
- conteneur fixe : `justifyContent: 'flex-start'` (au lieu de `flex-end`) ;
- feuille : coins arrondis **en bas** `borderRadius: '0 0 28px 28px'` ;
- poignée de glissement déplacée **sous** le contenu (ou retirée) ;
- ombre inversée `boxShadow: '0 10px 40px rgba(0,0,0,0.3)'` ;
- nouvelle keyframe `sp-sheet-in-top` (entrée par le haut : `translateY(-100%)→0`) dans `globals.css`, appliquée à la place de `sp-sheet-in`.
- Le `max-width: 480` + `margin: 0 auto` (centrage horizontal) est conservé.

## 9. Navigation & indépendance (détails)

- `ClubCard` (annuaire) → `http://<slug>.<ROOT>:<port>/` (helper `clubUrl(slug)` basé sur l'env).
- `Logotype` : sur host club → `/` (home club) ; sur plateforme → comportement actuel. Décision via `useClub()`.
- Sur l'app club, **aucune** affordance vers l'annuaire/recherche (on retire la flèche « retour annuaire » de l'ex-`/c/[slug]`, désormais `/reserver`).
- `/c/[slug]` : redirection (gérée par `proxy.ts`) vers `http://<slug>.<ROOT>/`.

## 10. Hors-scope (différé)

- Sous-domaines réels en production + config DNS/hébergement (MEP ultérieure ; tout est piloté par env).
- Pré-peinture serveur du branding club (suppression du flash).
- Notifications « poussées par le club » (au-delà des rappels joueur) — non demandées.
- Upload de fichiers (logos sponsors = URL collée, comme le branding club).
- Paiement en ligne / autres pistes hors-MVP.

## 11. Découpage en lots

- **Lot A — Routing & indépendance** : `proxy.ts`, env (`NEXT_PUBLIC_ROOT_DOMAIN`, `NEXT_PUBLIC_COOKIE_DOMAIN`), `ClubProvider`/`useClub`, branding remonté au layout, `app/reserver` (ex-`/c/[slug]`), `app/page.tsx` conditionnel, liens annuaire→sous-domaine, `Logotype` contextuel, redirection `/c/[slug]`.
- **Lot B — Session partagée (a1)** : cookie de domaine dans `useAuth`/login/register/logout ; résolution back-office du club via host.
- **Lot C — Home club + annonces/sponsors** : modèles BDD + migration + services + endpoints publics & admin + pages back-office + `ClubHome` (4 sections) + seed démo.
- **Lot D — Pop-ups top-sheet** : `BookingModal`, `ConfirmDialog`, keyframe `globals.css`.

(Lots A→B→C→D, dans cet ordre ; D est indépendant et peut être fait à tout moment.)

## 12. Vérification

À chaque lot : `npx tsc --noEmit` (front + back si touché) propre, tests Jest (front + back), et e2e manuel :
- `localhost:3000` → landing + annuaire ; clic sur un club → `padel-arena-paris.localhost:3000/`.
- `padel-arena-paris.localhost:3000/` → home club brandée (annonces, sponsors, hub) ; `/reserver` → réservation OK ; tout l'arbre brandé.
- Login sur un sous-domaine → session active sur un autre sous-domaine (cookie partagé).
- Back-office annonces/sponsors → CRUD reflété sur la home.
- Pop-ups affichés en haut.

## 13. Risques & points d'attention

- **Cookie `domain=localhost`** : accepté par Chrome/Edge/Firefox récents pour partager entre `*.localhost`, mais à valider en début de Lot B (sinon repli : cookie host-only par sous-domaine = re-login par club, à acter avec l'utilisateur).
- **`headers()` dans le layout** rend le layout dynamique (pas de rendu statique) — acceptable pour cette app.
- **Next 16** : bundler Turbopack, `params` = Promise côté serveur, « middleware » = `proxy.ts`. Lire `node_modules/next/dist/docs/` avant d'écrire le routing/proxy.
- **Prisma 7** : adapter `PrismaPg` obligatoire (déjà en place) ; migration additive sans reset.
- **Flash d'accent** sur pages club (cf. §4) — connu, accepté.
