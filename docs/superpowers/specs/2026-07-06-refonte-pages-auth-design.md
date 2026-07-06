# Refonte des pages d'authentification — écran scindé « brume bleue »

**Date** : 2026-07-06
**Statut** : validé (brainstorming avec maquettes navigateur)
**Périmètre** : 100 % frontend — aucune route backend, aucune migration.

## Contexte

Les 4 pages d'auth (`/login`, `/register`, `/forgot-password`, `/clubs/new`) partagent un gabarit
mobile-first (colonne unique dans `Screen`, cap 820 px) qui s'étire et paraît vide en desktop
(constat sur screenshot du user). La vitrine plateforme vient d'être refondue en langage
« éditorial premium » (hero `HERO_GRADIENT` brume bleue, encre fixe `HERO_INK`) ; les pages d'auth
doivent la rejoindre.

Décisions prises en brainstorming visuel :

1. **Direction** : écran scindé desktop — panneau de marque à gauche, formulaire à droite.
2. **Contenu du panneau** : panneau de marque **constant** (promesse + chips) ; le **titre de la
   page vit en tête de la colonne formulaire**, pas dans le panneau.
3. **Hôte club** : **identité club complète** dans le panneau (logo, nom, couleur d'accent en lavis
   clair) — repli Palova sur l'hôte plateforme.
4. **Mobile** : le panneau devient un **bandeau de marque compact** en tête, le formulaire suit.

## 1. Composant partagé `frontend/components/auth/AuthShell.tsx`

Client component qui porte toute la présentation. Il **remplace `Screen`** sur les 4 pages
(rendu pleine largeur, fond `th.bg`).

### Props

```ts
{
  title?: ReactNode;      // « Bon retour. » — omis sur les étapes verify/reset (les formulaires ont leur propre heading)
  subtitle?: ReactNode;   // ligne muted sous le titre
  audience?: 'player' | 'club';  // copy du panneau (défaut 'player')
  children: ReactNode;    // le formulaire de la page
}
```

### Desktop (≥ ~800 px, via le hook `useIsDesktop` existant)

- Deux colonnes pleine hauteur : panneau gauche **~44 %** (min-height 100vh), colonne droite
  centrée verticalement, contenu du formulaire **max-width ~460 px**.
- `ThemeToggle` en haut à droite de la colonne formulaire.
- Titre de page en display (~38–44 px) + sous-titre muted en tête de colonne, puis le formulaire.

### Mobile (< 800 px)

- **Bandeau de marque compact** en tête : même fond que le panneau desktop, logotype (ou identité
  club) + `ThemeToggle` sur la première ligne, promesse en une ligne, rangée de chips.
- Puis colonne : titre display (~34 px), sous-titre, formulaire — paddings proches de l'actuel.

### Panneau / bandeau — hôte plateforme (`useClub().club == null`)

- Fond `HERO_GRADIENT` (importé d'`AgendaHero`), textes en `HERO_INK` / `HERO_INK_MUTED`.
- `Logotype` en tête, filigrane décoratif (anneau/arcs du logo Palova en SVG très transparent,
  pattern du hero d'`AnonymousView`).
- Headline display + ligne muted + chips (pills translucides blanches, icônes du design system) :
  - **audience `player`** : headline « Le sport en club, simplifié. » ; ligne « Réservation en
    direct, tournois, parties ouvertes — dans tous les clubs Palova. » ; chips ⚡ Dispos en
    direct · 🏆 Tournois & events · 🤝 Parties ouvertes (icônes `bolt`/`trophy`/`users`).
  - **audience `club`** (`/clubs/new`) : headline « Votre club en ligne, simplement. » ; ligne
    « Planning, encaissement, tournois : le quotidien du club géré depuis un seul endroit. » ;
    chips 📅 Planning & résas · 💶 Caisse & offres · 🏆 Tournois (écho du ClubPitch de la vitrine).
  - Copy ajustable à l'implémentation, l'esprit est contractuel.

### Panneau / bandeau — hôte club (`useClub().club` renseigné)

- Fond = **lavis clair dérivé de `club.accentColor`** : dégradé de deux mixes très clairs de
  l'accent vers le blanc — helper pur `clubPanelWash(accent)` (ex.
  `linear-gradient(115deg, color-mix(in srgb, ${accent} 12%, #fdfdfc), color-mix(in srgb, ${accent} 30%, #fdfdfc))`).
  L'encre reste `HERO_INK` : le fond est clair quelle que soit la couleur du club (préférence
  user : jamais de panneau saturé/sombre).
- Identité : **logo du club sur tuile blanche arrondie** (repli : initiale sur accent), **nom du
  club** en display, ville en muted. Ligne : « Réservez vos terrains, rejoignez les tournois et
  les parties ouvertes du club. » Chips joueur identiques.
- Micro-ligne « propulsé par palova » (petit `Logotype`) en bas du panneau desktop ; sur le
  bandeau mobile, l'identité club remplace simplement le logotype.
- Repli : tant que `club` n'est pas chargé (ou `loading`), rendu Palova — pas de flash gênant,
  le wash arrive à l'hydratation du provider.
- Croisement des règles : **`audience: 'club'` prime sur l'identité club** — `/clubs/new` (créer
  un *nouveau* club) garde le panneau Palova B2B même si la page est ouverte depuis un hôte club.

### Thèmes

- La colonne formulaire suit les tokens `th.*` (clair et sombre).
- Le panneau/bandeau reste **clair à encre fixe** dans les deux thèmes — pattern établi
  `HERO_GRADIENT`/`HERO_INK` (heros brume bleue).

## 2. Les 4 pages — logique 100 % intacte

Seule la coquille JSX change : le couple `Screen` + hero inline est remplacé par `AuthShell`.
États, handlers, redirections `next`, gestion d'erreur (bandeau accent existant), liens de bas de
formulaire : **inchangés**.

| Page | `title` | `audience` | Étapes |
|---|---|---|---|
| `/login` | « Bon retour. » (sous-titre : « Connectez-vous pour réserver votre prochain créneau. ») | player | branche verify → `VerifyCodeForm` dans la colonne, `title` omis |
| `/register` | « Créez votre compte joueur. » (sous-titre actuel conservé) | player | étape verify → idem |
| `/forgot-password` | « Mot de passe oublié ? » (sous-titre actuel conservé) | player | étape sent → message neutre + `ResetPasswordForm`, `title` omis |
| `/clubs/new` | « Créez l'espace de votre club. » (sous-titre actuel conservé) | club | étape verify → idem |

`VerifyCodeForm` et `ResetPasswordForm` **ne changent pas** : ils portent déjà leur propre heading
display (« Vérifiez votre email. ») ; sur ces étapes la page passe `title`/`subtitle` omis pour
éviter le doublon. Les titres perdent leurs `<br/>` forcés (la largeur contrainte de la colonne
fait la césure naturellement) ; l'italique d'accent (« *quelques* secondes ») peut vivre dans le
headline du panneau.

## 3. Améliorations embarquées

- **Préremplissage login dev-only** : `/login` initialise aujourd'hui `test@palova.fr` /
  `password123` en dur — visible en prod. Init vide, préremplissage gaté
  `process.env.NODE_ENV !== 'production'`.
- **`SelectField` extrait dans `components/ui/atoms.tsx`** : le `<select>` stylé (label uppercase
  + surface 54 px + inset ring, même look que `Field`) est dupliqué inline dans `/register` et
  `/clubs/new` — extraction d'un composant unique, utilisé par les deux pages.

## 4. Tests

- **Suites existantes** (`RegisterPage.test.tsx`, `ForgotPassword.test.tsx`,
  `VerifyCodeForm.test.tsx`) : doivent passer sans changement de comportement — ajuster
  uniquement si un sélecteur visait la coquille.
- **Nouveau `AuthShell.test.tsx`** : panneau Palova par défaut (contexte club null), identité
  club rendue sur hôte club (nom + wash dérivé de l'accent), copy `player` vs `club`,
  `clubPanelWash` (helper pur), titre omis → pas de heading dupliqué.
- Gate de types : `tsc --noEmit` (jest ne type-checke pas).

## Hors périmètre

- Backend, migrations, routes : rien.
- `VerifyCodeForm`/`ResetPasswordForm` : pas de refonte interne.
- Wizard onboarding, pages admin/superadmin : non concernés.
- `AnonymousView`/vitrine : non touchée (elle est la référence, pas la cible).
