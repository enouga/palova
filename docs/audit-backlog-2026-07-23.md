# Audit complet du backlog Palova — état à jour (2026-07-23)

> Document de suivi éditable directement par Eric (pas un fichier généré à sens unique). Cochez, biffez, ajoutez des lignes au fil de l'eau — c'est fait pour.

**Journal des mises à jour**
- 2026-07-23 : création (réconciliation des ~100 items du backlog brut avec l'état réel du code).
- 2026-07-23 : correction — `helmet` + en-têtes de sécurité HTTP sont **déjà faits** (commit du matin même, avant l'audit), déplacés de "pas commencé" vers "déjà fait" ; retirés des actions VM et de la priorisation.

## Contexte

Vous avez déversé ~100 items (bugs, questions, idées, specs en attente) accumulés au fil des sessions. Objectif : réconcilier chaque item avec l'état réel du code (pas la mémoire, le code), pour repartir avec une liste fiable. Vérifié via 3 agents de recherche en parallèle (lecture seule) sur les points où le doute était réel, complété par deux analyses dédiées (perf à l'échelle, sécurité/Vercel) écrites à partir de l'architecture réelle du repo.

**Bonne nouvelle générale** : une bonne partie des "bugs" listés n'en sont plus — soit déjà corrigés dans une session récente, soit jamais réellement cassés. Le vrai backlog est plus petit que ce que la liste brute laisse penser.

---

on ne peut pas changer une partie pour la rendre pour de vrai ou amicale ou mixte ou feminine
dans ou jouer pouvoir regler le niveau comme dans parties parties ouvertes
sur la page ou jouuer garder les filtres en memoire
 une fois la lilite dinscrtion dune evenement termine on pourrait crrer un goupe de chat ou le JA ou lorganisateur peut comuniquer avec tous les inscrits
 pour les offres/abo pourvoir ajouter une date de debut et de fin  dabonnement pour des dates fixes sinon a date de lachat de labo  et ajouter la duree de labonnement avec le prix la durée et une option renouvellement automatique
 et une date darret de labonnement et une duree dengagement
 peux ton offrir des credits a un juouer oudes parties gratuites ? 
 ajouter des periodes dexclusions sur la creation devenement dans planning quand on choisi evenement recurent
 ajouter un pseudo poir les joueurs qui peuvent choisir si cest leur pseudo ou nom qui ressort

Un point mineur noté mais non bloquant : la barre flottante mobile fait un retour à la ligne peu élégant sur très petit écran (pas de débordement, juste esthétique) — je peux le polir si tu veux.

## 1. Réponses directes aux questions posées

**Bannière cookies — quand s'affiche-t-elle / comment se déclenche-t-elle ?**
`AnalyticsConsent.tsx` : elle s'affiche seulement si (a) `NEXT_PUBLIC_GA_ID` est configuré, (b) la page n'est PAS dans le back-office (`/admin`, `/superadmin`), ET (c) aucun choix valide n'est stocké dans le cookie `palova_consent` — qui expire après 180 jours ou si vous bumpez `CONSENT_VERSION`. Réouvrable via le lien "Gérer les cookies" du Footer. C'est déjà exactement le comportement RGPD attendu.

**Accéder à palova.fr depuis l'appli d'un club pour chercher d'autres clubs/parties — bonne idée ?** Oui, clairement — et l'essentiel existe déjà côté plateforme (`/decouvrir`, calendrier national des tournois, parties ouvertes nationales opt-in par club). Ce qui manque, c'est un lien VISIBLE depuis la nav d'un club vers cette découverte plateforme (aujourd'hui le `ProfileMenu` a "Mes clubs" mais pas un lien direct vers `/decouvrir`). Petit ajout, faible risque, fort potentiel de rétention.

**"Il faut expliquer que la seule commission en plus de l'abonnement, c'est Stripe"** — c'est déjà l'architecture réelle : Stripe Connect en *direct charge*, l'argent va sur le compte Stripe du club, Palova ne prend aucune commission sur les transactions ; le seul revenu Palova est l'abonnement SaaS par palier de membres actifs. Donc l'affirmation est vraie. Reste à vérifier qu'aucun `application_fee_percent` n'est configuré côté Stripe et à l'écrire noir sur blanc sur `/tarifs`/`/offres` — chantier de copywriting, pas de code.

**Vérifier les 3 réglages de partage (annuaire / tournois nationaux / parties ouvertes nationales)** — confirmé correct : ce sont bien 3 booléens indépendants (`listedInDirectory`, `listTournamentsNationally`, `listOpenMatchesNationally`), 3 interrupteurs distincts dans Réglages › Visibilité & joueurs. Rien à corriger.

**"Il faut obligatoirement un compte admin" / staff ne voit pas le guide de démarrage / expliquer ça à la création + FAQ** — **déjà fait** (évolution du 13/07) : `StartChecklist` et la bannière de facturation sont gatées à `isClubAdmin`, un paragraphe explicatif existe sur `/clubs/new`, un rappel sur l'écran final de l'onboarding, et une entrée FAQ "Gérant, admin, staff : qui voit quoi ?".

**Caisse : abonné dont l'abonnement couvre → réglé automatiquement** — **déjà fait** (couverture auto par abonnement, 13/07) : Caisse et Planning posent un vrai paiement `SUBSCRIPTION` sans clic quand l'abonnement du joueur couvre le créneau.

**Réduction sur des terrains pendant une période** — **déjà fait** : `/admin/promotions`, remise en % ou prix fixe, période + fenêtre horaire optionnelle, ciblage par terrain (PR #40).

**"On ne peut pas éditer/modifier un tournoi/event"** — en fait **si**, c'est déjà possible : `PATCH /admin/tournaments/:id` et `/admin/events/:id` existent, et le front a un vrai bouton "Modifier" qui pré-remplit le formulaire complet (pas juste création + changement de statut). Si vous ne le trouviez pas, il est sur la carte de chaque tournoi/event dans `/admin/tournaments` / `/admin/events`.

**Régularisation de facturation qui "ne rafraîchit pas la page"** — la page `/admin/billing` refait bien son propre appel API à chaque montage (elle ne dépend pas du cache client habituellement périmé). La seule vraie limite : si vous revenez sur la page une fraction de seconde avant que le webhook Stripe ait fini de traiter le paiement côté serveur, elle affichera encore "à régulariser" brièvement — inhérent à tout flux webhook, pas un bug de cache. Si ça persiste plusieurs secondes/minutes, ce serait plutôt un souci de webhook côté prod à investiguer spécifiquement.

**"Exécute le lot A du plan cohérence UI"** — ambiguïté à lever : le "Lot A" en mémoire concerne l'**audit des rôles** (déjà fait et mergé le 17/07). L'**audit cohérence UI/UX** (8 chantiers graphiques, rien encore corrigé) n'a pas de "lots" nommés dans ce que j'ai sous la main. À préciser lequel des deux vous voulez attaquer, ou si "Lot A" désigne autre chose.

**Comment tester la saisie d'un résultat de match** — créez/utilisez une réservation padel PUBLIC avec 4 joueurs confirmés dont l'horaire est passé (ou avancez l'horloge côté seed) : elle apparaît dans la carte "Résultats à saisir" (Club-house, `/parties`, `/me/matches`). Ouvrez-la → tableau de score tapable (grille 3 sets × 2 équipes, pavé 0-7, auto-avance, backspace pour corriger) → "Enregistrer". Les 3 autres joueurs reçoivent une demande de confirmation ("Résultats à confirmer") ; en cas de désaccord, la modale de contestation attend un motif.

**Poser helmet/en-têtes de sécurité HTTP** — **déjà fait** (commit du 23/07 au matin, avant même cet audit). Voir section 2.

---

## 2. Déjà fait ✅ — des items de la liste sont en réalité terminés

| Item de la liste | Statut réel |
|---|---|
| En-têtes de sécurité HTTP (helmet + Caddy) | **Fait** — `backend/src/app.ts` pose `helmet({ crossOriginResourcePolicy: 'cross-origin' })` (couvre le dev sans Caddy devant + tout accès direct au backend), et `Caddyfile` importe déjà `security_headers` (HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy) sur les 3 blocs prod (apex, `api.palova.fr`, sous-domaines clubs) + une CSP dédiée au front (`csp_frontend`, `unsafe-inline` documenté et volontaire pour l'hydration Next.js). Les deux couches sont cohérentes, pas de doublon problématique |
| Animations récurrentes (mêlée hebdo) | **Fait** (19/07, `ClubEventSeries`) — le tableau original le listait encore "Absent", c'était périmé |
| Retrait d'un binôme payé par l'admin/J-A → remboursement | **Fait** — `adminRemoveRegistration` rembourse déjà via Stripe |
| Modifier un tournoi/event après création | **Fait** — route + UI existent |
| Numéro de téléphone du partenaire visible ailleurs | **Pas de fuite** — aucun DTO d'annuaire/équipe n'expose `phone` |
| Bug "retirer joueur gauche fait glisser le droit" ailleurs que la popup résa | **Déjà corrigé partout** — un seul composant partagé (`MatchTeams.tsx`) piloté par le slot serveur, utilisé par BookingModal, calendrier ET parties ouvertes |
| "Une pastille sans nom" sur les cartes de partie | **Le nom complet est affiché** — abrégé seulement si la carte est très étroite en mobile, jamais réduit à une pastille |
| Compteur "Mes réservations" n'inclut pas les tournois | **Il les inclut déjà** (+ events + cours) |
| Lien admin → site public du club | **Déjà là** (icône œil dans le bandeau admin) |
| Mail de confirmation tournoi sans date limite d'annulation | **Déjà incluse** dans le template (`date_limite_annulation`) |
| SIRET : explication "obligatoire" + validation | **Déjà fait**, et va plus loin que demandé : validation Luhn + vérification réelle contre l'API SIRENE (existence + statut actif) |

---

## 3. Partiellement fait 🟡

| Item | Ce qui manque |
|---|---|
| Chat de partie ouverte + gestion joueurs dans une seule zone | Vrai sur desktop (chat en widget flottant, page reste visible) ; sur **mobile**, le chat plein écran masque la gestion des joueurs pendant qu'il est ouvert |
| Toggle "Classement" limité au padel | Fonctionne en pratique (la page `/parties` entière est verrouillée au padel en amont) mais le toggle lui-même dépend d'un flag club générique, pas d'un vrai gate par sport — fragile si `/parties` s'ouvre un jour à d'autres sports |
| FAQ personnalisable par club | L'édition existe déjà (`/admin/pages`) ; **le bouton "Générer depuis les réglages" demandé n'existe pas** — la FAQ socle Palova est auto-générée mais invisible/non actionnable, pas un bouton |
| Remboursement en masse à l'annulation d'un tournoi/event | Pour les **events**, ça semble déjà câblé (le chantier récurrence du 19/07 réutilise le même code qui rembourse les inscrits payés, "déjà testé"). Pour les **tournois**, aucune trace équivalente trouvée — probablement encore le trou identifié par l'audit du 17/07. À vérifier précisément avant de le traiter comme un chantier à part entière — il est peut-être déjà à moitié réglé |
| Chat désactivable par le joueur | Il peut bloquer un joueur précis et couper les notifications de chat par préférence, mais pas de bouton "désactiver le chat entièrement" |

---

## 4. Pas commencé ❌ (vrai backlog)

**Tournois/events**
- Moteur de tableaux/poules/scores (spec parkée, rien codé)
- Table de marque du J-A : backend+composants prêts et testés, **mais aucune page ne les monte** (`/me/refereeing/[id]`, `/admin/tournaments/[id]/table` n'existent pas) — c'est cliquable nulle part
- Blocage automatique de terrains par un tournoi/event (le type TOURNAMENT/EVENT n'est qu'un label, pas de lien réel avec les réservations)
- Plafond de liste d'attente distinct de la capacité (rien en base, rien en UI)

**Cours (leçons)**
- Notifications au coach : aucune (ni nouvel inscrit, ni annulation, ni modif de son cours par le staff)
- Paiement/facturation des cours : aucun prix, le planning affiche "Rien à encaisser"
- Rappels e-mail avant échéance pour les cours (le cron ne couvre que réservations + tournois/events)

**Multi-langue**
- La préférence de langue en profil ne fait strictement rien — 100% français en dur, aucune lib i18n installée. Déjà repéré, confirmé.

**Autres**
- Remboursement d'un solde porte-monnaie (cf. section 1)
- Consommation de carnet lors d'un déplacement de résa
- Pouls du club en direct (retiré en juillet)
- Cherche-partenaire dédié
- Stats de visite du site par club et pour le owner (aucun dashboard analytics au-delà du tracking GA4 brut)
- Commentaire/annonce public rattaché à une partie ouverte précise (le modèle `OpenMatch` n'a que le chat privé, pas de texte public sur la carte)
- Documentation complète de la partie admin (gestionnaire + staff) — rien trouvé, demandé deux fois dans la liste
- Liste de fonctionnalités pour le marketing club (contenu à écrire)
- FAQ complète d'exemple pour un club + consignes J-A (contenu à écrire)
- Heures creuses/pleines **par sport** — aujourd'hui c'est un réglage club global (`Club.offPeakHours`), rien au niveau `ClubSport`
- N'afficher "éclairage" que si au moins un terrain du club en est dépourvu (actuellement probablement toujours affiché, pas vérifié en détail)
- Validation du niveau par un coach/club (question de conception, pas encore tranchée)

---

## 5. Nouvelles idées produit à trancher (pas des bugs)

**Accélérer le remplissage d'un tournoi avant sa clôture** — pistes concrètes à choisir/combiner :
1. Plafonner explicitement la liste d'attente (crée de l'urgence "plus que N places" — déjà en partie visuel via la jauge de remplissage, mais un vrai plafond configurable renforcerait l'effet)
2. Notification push aux membres du club à J-2/J-1 de la clôture si des places restent (miroir des rappels tournois existants, mais orientés "non-inscrits" plutôt que "inscrits")
3. TODO Tarif "early bird" dégressif (déjà un champ `entryFee`, pourrait devenir une grille par date)
4. Mettre en avant "N joueurs déjà inscrits" plus tôt et plus visiblement sur la fiche (preuve sociale)
5. TODO Partage facilité (bouton "Inviter un partenaire" pré-rempli, réutilisable du pattern "Inviter à jouer" des Amis)

**Lien palova.fr accessible depuis l'appli club** — recommandé (cf. section 1), petit chantier nav.

---

## 6. Documents/specs déjà prêts, jamais exécutés

- **Timezone "jour du club"** — spec+plan committés, 8 tâches TDD prêtes avec code des tests déjà écrit. Le plus gros refactor transversal risqué du repo (créneaux 8h-22h Paris en dur, arithmétique de dates éparpillée, DST) mais débloque les clubs hors France.
- **Tournois — tableaux/poules/scores (TMC)** — spec+plan committés dans le repo, volontairement non exécutés.
- **Contacter le J-A d'un tournoi (opt-in "jamais / après clôture seulement")** — spec+plan committés sur `feat/seo-referencement`, exactement la demande ("le JA peut choisir de ne pas être contacté du tout ou juste après la clôture") : réglage 3 états `refereeContactPolicy` (ALWAYS/AFTER_DEADLINE/NEVER, défaut AFTER_DEADLINE) édité en tête de `/me/refereeing`. **Rien codé**, prêt à exécuter sur feu vert.
- **Contrôle d'accès Akiles (portillon terrain)** — spec+plan committés, rien codé.
- **Parties hors club / CommunityMatch** — spec validée seule, pas de plan, rien codé.
- **Admin membres "maître-détail cockpit"** (`docs/superpowers/plans/2026-07-14-admin-membres-maitre-detail-cockpit.md`) — plan référencé, pas de trace qu'il ait été exécuté (la page `/admin/membres` a eu une fusion Membres+Abonnés le 13/07 mais rien qui corresponde à "cockpit maître-détail"). À vérifier/statuer.
- **Modération chat** (`docs/superpowers/specs/2026-07-14-moderation-chat-design.md`) — celui-ci **est fait** (signalement, rate-limiting, blocage, ré-encodage photos DM) — si cité comme "à faire", c'est périmé.

---

## 7. Performance à l'échelle — "centaines de joueurs à minuit"

TODO sur cette partie quoi faire ? j'ai mis en place le SSE deja 

**Déjà en place** (audit perf du 18/07, 6/7 correctifs mergés dans `main` en local, pas encore poussés) :
- Micro-cache disponibilité (2s + single-flight, invalide sur toute écriture)
- Fin du N+1 sur le calcul de dispo (3 requêtes SQL constantes au lieu de 2+2×terrains)
- Cache d'identité auth (30s, évite un SELECT user par requête authentifiée)
- Compression Caddy (SSE exclu exprès)
- SSE temps réel par club (les joueurs n'ont pas besoin de rafraîchir en boucle)
- Ouverture des créneaux avec jitter aléatoire 0-3s (étale la pointe serveur)

**Ce qui reste un vrai risque pour "centaines de connexions à minuit"** :
1. **Pas de retry documenté sur les erreurs Serializable Postgres (40001)**. Le verrou Redis SET-NX + `SELECT FOR UPDATE` Serializable garantit la correction (zéro double-booking), mais sous forte contention sur le MÊME créneau, Postgres peut renvoyer une erreur de sérialisation qui nécessite un retry applicatif. Si `holdSlot`/`confirmReservation` ne retentent pas automatiquement, une partie des joueurs à minuit pile verrait une erreur générique au lieu d'un "créneau déjà pris" propre — c'est le point le plus critique à vérifier avant une vraie pointe.
2. **Process Node unique** — les caches (dispo, auth) et le pub/sub SSE sont explicitement process-local par conception ; ça tient tant que le backend reste sur une seule instance. Le jour où ça scale horizontalement (2+ instances), ça casse silencieusement (déjà documenté comme dette connue).
3. **Taille du pool de connexions Prisma/Postgres non documentée explicitement** — sous une pointe de centaines de `hold` simultanés, un pool trop petit fait la queue côté DB avant même d'atteindre le verrou applicatif.
4. **Pas de rate-limiting générique** sur les routes publiques chaudes (disponibilité, hold) — seuls quelques buckets ciblés existent (chat, DM, signalement, support).
5. **Load test jamais vraiment exécuté à l'échelle** — le script `loadtest-members.ts` existe mais aucun résultat documenté d'un run à 200-500 connexions simultanées.

**Recommandation concrète avant d'ouvrir plusieurs clubs actifs** : (a) lancer le load test existant sur un scénario réaliste (des centaines de `hold` sur le même créneau au même horodatage), (b) ajouter/vérifier une politique de retry sur les échecs Serializable, (c) fixer explicitement la taille du pool Prisma, (d) poser un rate-limit raisonnable sur `/availability` et `/hold`.

---

## 8. Sécurité + projet de passage à Vercel

**Ce qui va bien** : en-têtes de sécurité HTTP posés (helmet + Caddy, cf. section 2), requêtes paramétrées (Prisma, pas d'injection SQL), JWT avec révocation par `tokenVersion` + cache, RBAC hiérarchique club-scopé, Stripe Connect en *direct charge* (jamais de carte en clair chez Palova), RGPD (export de données, suppression de compte anonymisée), modération (signalement + blocage), corps d'email personnalisés assainis (`sanitize-html`), uploads validés et ré-encodés (sharp strip l'EXIF des photos privées).

**Ce qui manque encore, indépendamment de Vercel** :
commentaire ENO : apparememnt cest fait et claude oublie vercel on reste chez
- Rate-limiting généraliste absent (login/register/reset-password non protégés contre le brute-force, à confirmer)
- Pas de WAF/CDN devant l'origine

**Le point le plus important pour le projet Vercel : incompatibilité architecturale de fond, pas un simple réglage.**

Le backend actuel n'est PAS conçu pour du serverless :
1. **Uploads sur disque local** (avatars, logos, affiches, images DM privées, images d'email, icônes PWA générées) — sur Vercel, le filesystem est éphémère et sans état entre invocations. Tout fichier écrit disparaît. Migration obligatoire vers un stockage objet (S3, Cloudflare R2, Vercel Blob) AVANT tout déploiement backend sur Vercel.
2. **Caches et pub/sub SSE en mémoire process-local** — explicitement documentés dans le code comme "process-local, passage en multi-instance ⇒ Redis". Or les fonctions Vercel sont multi-instance par nature : ces caches et les 5 canaux temps réel (cloche, club, conversation, match, réservation) casseraient silencieusement.
3. **Cron jobs in-process** (node-cron : nettoyage minute, rappels, facturation mensuelle) — incompatibles avec un process qui se termine après chaque requête. Il faudrait les remplacer par Vercel Cron + externaliser tout état partagé.
4. **Connexions SSE longues** — les fonctions serverless ont des limites de durée d'exécution ; un flux ouvert plusieurs minutes ne rentre pas dans ce modèle.
5. **Connexions Postgres/Redis par invocation** — sans pooler externe (PgBouncer, Prisma Accelerate), le serverless épuise vite les connexions disponibles côté Postgres.

**Conclusion pratique** : Vercel est excellent pour le **frontend Next.js** (c'est son terrain de jeu naturel). Il n'est **pas fait** pour ce backend Express tel qu'il existe aujourd'hui. Le pattern recommandé et le plus courant : **Frontend Next.js → Vercel** ; **Backend Express + Postgres + Redis → reste sur un host à process persistant** (Hetzner actuel, ou du managé type Railway/Render/Fly.io). Migrer le backend en serverless serait un chantier majeur à lui seul (stockage objet, Redis pour tout état partagé, cron externalisé, SSE remplacé) — non recommandé sans besoin fort et explicite.

Si l'intention est "juste le frontend sur Vercel, le backend reste ailleurs" — c'est le bon calcul, et le seul vrai point d'attention est le CORS/multi-sous-domaine (déjà géré aujourd'hui) et la latence Vercel↔Hetzner (généralement correcte pour un public FR/EU).

---

## 9. Obligations légales — récap

**La conformité légale est déjà largement implémentée** (18/07 : mentions légales, CGU, CGV SaaS avec annexe DPA art. 28, politique de confidentialité, preuves d'acceptation versionnées, export RGPD, désinscription broadcast en un clic, repli légal automatique des pages club sans contenu publié). Ce qui reste, **hors code** :
- Compléter les placeholders `[à compléter]` (Kbis Tolaris Studio) dans `platformContent.ts` puis bumper `LEGAL_VERSIONS`
- Renseigner l'identité Tolaris Studio dans le dashboard Stripe
- Faire relire les 4 documents + modèles club par un avocat avant ouverture publique
- Brancher le SMTP prod (sinon les emails de désinscription/relance légale ne partent pas réellement)
- Chaque club doit adhérer à un dispositif de médiation de la consommation (ex. CM2C) — champ `mediatorName`/`mediatorUrl` déjà prêt à recevoir l'info

Obligations principales en tant qu'éditeur de plateforme B2B2C : identité légale complète et à jour (mentions légales), CGU acceptées à l'inscription (fait), CGV SaaS acceptées à la création de club (fait), rôle de sous-traitant RGPD vis-à-vis des données des membres des clubs — DPA (fait, en annexe CGV), droit à l'export/suppression des données (fait), médiation de la consommation pour litiges B2C club↔joueur (à chaque club de s'y affilier).

---

## 10. Actions VM/ops (rien à coder)

- **Backups Hetzner** : `deploy/backup-db.sh` + runbook écrits, mais rien ne tourne (cron non posé, copie hors-site et supervision healthchecks.io commentées, backups Hetzner non cochés, jamais de test de restauration). Un incident disque aujourd'hui = perte totale. **Priorité la plus haute de toute la liste.**
- Brancher le vrai SMTP prod
- Moniteur uptime externe sur `/health` (UptimeRobot)
- Procédure Stripe Connect club : la page `/admin/payments` existe et fonctionne, **mais son lien de nav a été volontairement masqué le 13/07** — pour tester, y aller par URL directe (`/admin/payments`) ou réactiver la ligne commentée dans `app/admin/layout.tsx`

---

## 11. Recommandation de priorisation

Dans l'ordre :

1. **Backups + SMTP prod** — c'est la seule catégorie où un incident réel = perte de données/joueurs qui ne reçoivent rien. Zéro code, juste des gestes VM.
2. **Load test + retry Serializable** avant que plusieurs clubs actifs génèrent une vraie pointe à minuit.
3. **Remboursement à l'annulation d'un tournoi entier** (vérifier/combler le trou tournois, les events semblent déjà couverts) + **remboursement wallet** — cohérence "l'app rembourse toujours ce qu'elle a pris".
4. **Table de marque J-A** — déjà codé et testé, juste 2 pages à monter + le journal à afficher. Rapport effort/valeur excellent (quasi gratuit).
5. **Documentation admin complète** — demandée deux fois, aucun club ne peut se former seul sans ça.
6. Ensuite, à trancher parmi les specs prêtes : timezone jour du club, contacter le J-A, tournois TMC, Akiles.
