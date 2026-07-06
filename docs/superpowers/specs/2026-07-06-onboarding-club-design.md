# Onboarding de création de club — wizard « Aperçu vivant » + guide de démarrage

**Date** : 2026-07-06
**Statut** : validé (brainstorming avec maquettes visuelles)

## Objectif

Impressionner le gérant d'un nouveau club dès la première minute : un parcours d'accueil
**simple, rapide et très beau** qui le guide dans le paramétrage de son club, en s'appuyant
sur les réglages admin existants. Deux briques complémentaires :

1. **Un wizard immersif de 5 étapes** juste après la création du club (avant d'atterrir dans
   l'admin), avec un **aperçu vivant** : un mockup de téléphone où le club-house du club se
   construit en temps réel au fil des réponses.
2. **Une checklist « Guide de démarrage » persistante** sur le tableau de bord admin,
   dérivée de l'état réel du club, qui rattrape ce qui a été sauté et guide vers la suite
   (Stripe, offres, page club, premier event).

## Décisions de cadrage

- **Déclenchement** : les deux — wizard à la création + checklist dashboard (validé).
- **Périmètre wizard** : court, 5 étapes (~3-4 min) : Identité → Sports → Terrains →
  Règles clés → Visibilité/mise en ligne. Stripe, offres, page club, heures creuses,
  quotas → checklist (validé).
- **Checklist** : pour **tous les clubs incomplets**, y compris les clubs existants —
  calculée sur l'état réel, elle se coche toute seule et disparaît quand tout est fait
  (validé).
- **Style** : approche « A · L'aperçu vivant » (split-screen question/téléphone) **+ final
  festif de l'approche B** (confettis, révélation, URL copiable) (validé sur maquettes).
- **Aucune migration Prisma. Un seul endpoint backend nouveau** (read-only).

## Parcours

```
/clubs/new (hôte plateforme)
  formulaire → code email → createClub (+ sport principal, comme aujourd'hui)
  → redirection clubUrl(slug, '/admin/onboarding')        ← seul changement de cette page
/admin/onboarding (sous-domaine club, staff seulement)
  wizard plein écran 5 étapes → final festif
  → « Découvrir mon club-house » (/) ou « Aller à l'espace de gestion » (/admin)
/admin (dashboard)
  carte « Guide de démarrage » tant que le club est incomplet
  → « Rouvrir le guide guidé → » relance /admin/onboarding à tout moment
```

- « **Configurer plus tard →** » (haut droite, toujours visible) sort vers `/admin` sans
  rien perdre : chaque étape validée est **déjà enregistrée** (pas de gros submit final).
- Chaque étape a un « **Passer cette étape** » discret, sans culpabilisation.
- Le wizard est **ré-ouvrable et idempotent** : rouvert plus tard, il se pré-remplit depuis
  l'état réel (logo affiché, sports actifs pré-cochés, « déjà N pistes ✓ » à l'étape 3) et
  ne peut jamais écraser un réglage sans action explicite.

## Le wizard

### Layout (validé sur maquette)

Plein écran, fond sombre théâtral (dégradé bleu nuit), même famille visuelle que les heros
de l'app. Barre haute : logotype Palova, **barre de progression segmentée (1/5)**,
« Configurer plus tard → ». Corps en deux colonnes :

- **Gauche** : la question de l'étape — surtitre accent (`Identité · {nom du club}`), titre
  display serif, sous-titre rassurant (« Tout reste modifiable »), champs, CTA
  « Continuer → » + « Passer cette étape ».
- **Droite** : `LivePhonePreview` — un téléphone (cadre sombre, halo lumineux teinté de la
  couleur d'accent choisie) affichant un mini club-house : header au dégradé brume bleue
  avec logo + nom + `slug.palova.fr`, carte « Réserver un terrain → », sections sports et
  terrains. Les sections pas encore configurées affichent un placeholder en italique
  (« apparaîtront à l'étape 2… »). Chaque validation met à jour l'aperçu instantanément.
- Transitions animées entre étapes (pattern `sp-rise` maison, CSS pur).
- **Mobile** (< ~800px) : colonne unique ; le téléphone devient une vignette réduite
  dépliable (bouton « voir l'aperçu ✨ »).

### Les 5 étapes

Chaque « Continuer » appelle les API admin existantes et n'envoie **que les champs de
l'étape** (le PATCH `adminUpdateClub` est partiel).

| # | Étape | Contenu | API |
|---|-------|---------|-----|
| 1 | **Identité** | Upload logo (ou monogramme par défaut, présenté positivement), couleur d'accent (palette `ACCENTS` + champ libre), thème clair/sombre | `uploadClubLogo`, `adminUpdateClub { accentColor, defaultThemeMode }` |
| 2 | **Sports** | Pills multi-sélection depuis le catalogue plateforme (`getSports`). Le sport choisi à l'inscription est déjà actif → pré-coché et non décochable (pas de retrait de sport dans le wizard) | `adminAddSport` pour chaque nouveau sport coché |
| 3 | **Terrains express** | Un bloc par sport actif : « Combien de {resourceNoun} ? » (stepper 0-20), prix au créneau (€), intérieur/extérieur. Génère « {ResourceNoun} 1…N » (défauts : 8h-22h, pas du sport, format standard). Terrains existants → « déjà N ✓ » + le stepper n'ajoute que des terrains supplémentaires | boucle `adminCreateResource` |
| 4 | **Règles clés** | 2 questions en **presets cliquables** : réservation à l'avance (7 j / 14 j / 30 j, abonnés = ×2 plafonné à 365) et délai d'annulation (jusqu'au début / 4 h / 24 h). Le reste (release mode, heures creuses, quotas) reste dans Réglages | `adminUpdateClub { publicBookingDays, memberBookingDays, cancellationCutoffHours }` |
| 5 | **Visibilité & mise en ligne** | Toggle « Afficher mon club dans l'annuaire Palova » (`listedInDirectory`) puis **final festif** | `adminUpdateClub { listedInDirectory }` |

### Le final festif (validé sur maquette)

Confettis **CSS pur** (aucune lib), téléphone terminé incliné en fond, titre display
« {Nom du club} est *en ligne*. », **URL copiable** `slug.palova.fr` (bouton copier,
`navigator.clipboard`), rangée de chips récap (✓ Identité · ✓ Padel · ✓ 4 pistes ·
« Paiement en ligne · plus tard »), double CTA : « Découvrir mon club-house → » (accent,
vers `/`) et « Aller à l'espace de gestion » (outline, vers `/admin`).

## La checklist « Guide de démarrage » (validée sur maquette)

Carte en tête de `/admin` (dashboard), au-dessus des StatCards, même langage visuel sombre
que le wizard : **anneau de progression SVG** (« 4/8 »), titre encourageant, lien
« Rouvrir le guide guidé → » (vers `/admin/onboarding`), croix de masquage, grille 2
colonnes (1 sur mobile) des 8 jalons :

| Jalon | ✓ quand… | Lien de la ligne |
|-------|----------|------------------|
| Créer votre club | toujours ✓ (on démarre à 1/8) | — |
| Logo & couleur | `logoUrl` renseigné | `/admin/settings` |
| Vos sports | ≥ 1 `ClubSport` | `/admin/sports` |
| Vos terrains | ≥ 1 `Resource` | `/admin/courts` |
| Votre page club | `presentationText` non vide **ou** ≥ 1 `ClubPhoto` | `/admin/club` |
| Le paiement en ligne | Stripe `ACTIVE` | `/admin/payments` |
| Vos formules | ≥ 1 `PackageTemplate` **ou** `SubscriptionPlan` actif | `/admin/packages` |
| Votre premier tournoi ou event | ≥ 1 `Tournament` ou `ClubEvent` | `/admin/events` |

- Item fait = ✓ accent + libellé barré ; item ouvert = ligne cliquable avec flèche.
- **Masquage** : croix → localStorage `palova:onboarding-hidden:<clubId>` (par appareil,
  assumé pour la v1). 8/8 → la carte n'est pas rendue du tout.
- Tout est **dérivé** : rien n'est stocké en base, les clubs existants en profitent, la
  carte se met à jour à chaque visite du dashboard.

## Architecture

### Frontend

- **Route** : `frontend/app/admin/onboarding/page.tsx` — profite de la garde staff du
  layout admin. Le layout admin détecte ce pathname et rend l'enfant **plein écran sans
  sidebar** (condition sur `usePathname`, dans l'esprit du mécanisme `AdminChromeContext`
  du Planning).
- **Composants** `frontend/components/onboarding/` :
  - `OnboardingWizard.tsx` — shell : chargement de l'état réel (`adminGetClub`,
    `adminGetSports`, `adminGetResources`, `getSports`), progression, navigation,
    « Configurer plus tard », gestion d'erreur par étape ;
  - `StepIdentity.tsx`, `StepSports.tsx`, `StepCourts.tsx`, `StepRules.tsx`,
    `StepLaunch.tsx` — un composant par étape, purement présentationnels + callbacks ;
  - `LivePhonePreview.tsx` — le téléphone, alimenté par un objet **`PreviewState`** pur
    (`{ name, slug, logoUrl, accentColor, sports: [{name, icon, courtCount, price}] }`) ;
  - confettis en CSS pur dans `StepLaunch`.
- **`components/admin/StartChecklist.tsx`** — la carte dashboard, montée dans
  `/admin/page.tsx` (fetch `adminGetOnboardingStatus`, rendu conditionnel).
- **Helpers purs testés dans `frontend/lib/onboarding.ts`** :
  - `buildChecklist(status: OnboardingStatus): ChecklistItem[]` (dérivation des 8 jalons) ;
  - `BOOKING_PRESETS` / `CANCEL_PRESETS` (presets de l'étape 4) ;
  - `resourceNames(noun: string, from: number, count: number): string[]`
    (« Piste 5…8 » quand 4 existent déjà) ;
  - `STEP_ORDER`, types `PreviewState`, `OnboardingStatus`, `ChecklistItem`.
- `lib/api.ts` : type `OnboardingStatus` + méthode `adminGetOnboardingStatus(clubId, token)`.
- Hydration-safe : pas de `new Date()` au rendu (aucune horloge nécessaire ici).

### Backend

- **Une seule nouveauté** : `GET /api/clubs/:clubId/admin/onboarding-status`
  (`requireClubMember('ADMIN')`, déclarée dans `admin.ts`) →
  `OnboardingService.getStatus(clubId)` (`backend/src/services/onboarding.service.ts`) :
  ```json
  {
    "hasLogo": true,
    "sportsCount": 1,
    "resourcesCount": 4,
    "hasPresentation": false,
    "stripeStatus": "NONE",
    "offersCount": 0,
    "eventsCount": 0
  }
  ```
  Implémentation en `count()`/`findUnique` Prisma bon marché (une poignée de requêtes,
  possiblement en `Promise.all`). **Aucune migration.**
- Le wizard réutilise les routes existantes : `uploadClubLogo`, `adminUpdateClub`,
  `adminAddSport`, `adminCreateResource`, `getSports`, `adminGetSports`,
  `adminGetResources`.
- `/clubs/new` : la redirection de `finishClub` passe de `clubUrl(slug, '/admin')` à
  `clubUrl(slug, '/admin/onboarding')` (le transfert de session existant est inchangé).

## Erreurs & cas limites

- **Échec d'un appel à la validation d'étape** : message d'erreur inline (mêmes libellés
  que Réglages), l'étape reste affichée, « Continuer » redevient actif.
- **Création de N terrains** : bouton verrouillé pendant l'envoi (garde `busy`) ; création
  séquentielle ; échec partiel → le retry reprend au terrain qui a échoué (index local),
  jamais de doublon.
- **Non-staff sur `/admin/onboarding`** : garde du layout admin existante (redirect).
- **Club multi-sport** : l'étape 3 répète le bloc terrain par sport coché.
- **Wizard rouvert sur club déjà configuré** : tout est pré-rempli, les steppers terrains
  n'ajoutent que du nouveau, valider sans changement = no-op sans danger.
- **Upload logo trop lourd / mauvais format** : mêmes gardes que Réglages (2 Mo,
  JPEG/PNG/WebP), erreur inline sans bloquer l'étape.

## Tests

- **Backend** : `onboarding.service.test.ts` (dérivation du statut : club nu, club
  partiellement configuré, club complet) + test de route (200 staff, 403 non-staff).
- **Frontend** :
  - `__tests__/onboarding.test.ts` — helpers purs (`buildChecklist` tous états,
    `resourceNames`, presets) ;
  - `__tests__/OnboardingWizard.test.tsx` — parcours nominal 5 étapes (appels API
    attendus), skip d'étape, erreur API affichée, pré-remplissage à la réouverture,
    « Configurer plus tard » ;
  - `__tests__/StartChecklist.test.tsx` — rendu des jalons, progression, dismiss
    localStorage, disparition à 8/8, lien « Rouvrir le guide » ;
  - `tsc --noEmit`.

## Hors périmètre v1

- QR code du club sur le final (l'URL copiable suffit).
- Persistance serveur du masquage de la checklist (localStorage par appareil assumé).
- Étapes wizard pour Stripe, offres, page club, heures creuses, quotas, release mode
  (→ checklist et pages admin).
- Emails de relance « votre club n'est pas fini ».
- Onboarding joueur (ce wizard est côté gérant uniquement).
- Retrait d'un sport depuis le wizard.

## Maquettes de référence

Sauvegardées par le compagnon visuel dans `.superpowers/brainstorm/2039-1783314852/content/`
(`approches.html`, `wizard-design.html`, `dashboard-checklist.html`).
