# Club-house — redesign « éditorial premium » (parties ouvertes en vedette)

**Date** : 2026-07-05
**Statut** : validé par le user (direction « éditorial premium », parties ouvertes en hero + section vedette, toute la page)

## Problème

Le Club-house actuel est une pile de cartes beiges identiques : même largeur, même
bordure inset, mêmes micro-titres majuscules gris. Aucun moment fort en haut de page,
aucune hiérarchie visuelle. Les « Parties ouvertes » — le contenu le plus vivant du
club — sont réduites à une ligne minuscule noyée au milieu. Les 4 cartes d'offres avec
leurs gros boutons bleus mangent la moitié de la page. Verdict user : « c'est vraiment
pas beau ».

## Direction retenue

**Éditorial premium** : hero immersif au dégradé signature, grandes typos display,
sections rythmées, ombres douces à la place des bordures inset. Les parties ouvertes
deviennent le contenu vedette (mention dans le hero + première section en grandes
cartes). Aucun changement backend.

## Design

### 1. Hero immersif — nouveau `components/clubhouse/ClubHouseHero.tsx`

- Pleine largeur, fond `HERO_GRADIENT` + encre `HERO_INK`/`HERO_INK_MUTED`
  (source de vérité inchangée : `components/agenda/AgendaHero.tsx` — lisible dans
  les deux thèmes).
- Nom du club en `th.fontBrand` (Righteous), petit, en sur-titre.
- **Contenu adaptatif** :
  - Annonce épinglée non expirée → son titre = titre du hero (typo display, grande),
    corps clampé 2 lignes, clic → **top-sheet existante conservée** (pattern repris de
    `HeroAnnouncement`, y compris CTA « En savoir plus → » si `linkUrl`, sinon
    « Réserver un terrain → », `stopPropagation`). Si l'annonce a une `imageUrl`,
    elle sert de fond (cover) sous un voile dégradé qui garantit la lisibilité.
  - Pas d'annonce épinglée → accroche générique du club.
- **Rangée « pouls du club »** en bas du hero : chips calculées depuis les données
  déjà chargées par `ClubHouse` —
  `⚡ Prochain créneau : dim. 20h00` · `👥 3 parties cherchent des joueurs` ·
  `🏆 Prochain event J-4`. Chaque chip n'apparaît que si sa donnée existe.
  La chip parties scrolle vers la section vedette ; la chip créneau pointe `/reserver`.
  Horloge `now` passée en prop (hydration-safe, jamais de `new Date()` au rendu).
- CTA principal « Réserver un terrain » (bouton encre `HERO_INK` → texte clair).
- `HeroAnnouncement.tsx` est **absorbé** par ce composant (fichier supprimé, tests
  migrés vers `ClubHouseHero.test.tsx`).

### 2. « Ça joue bientôt » — nouveau `components/clubhouse/OpenMatchesShowcase.tsx`

Remplace `OpenMatchesRail.tsx` (supprimé). Première section après le hero.

- Défilement horizontal snap (`.sp-scroll-x`, `scroll-snap-type: x mandatory`),
  grandes cartes ~280px (`flex: 0 0 280px`), jusqu'à 6 parties à venir.
- Chaque carte : date/heure en typo display (« dim. 6 juil. · 17h00 »), nom du
  terrain, **avatars des inscrits (chevauchés, `colorForSeed`) + sièges vides en
  cercles pointillés** (la capacité vient de `players.length + spotsLeft` — on *voit*
  les places à prendre), fourchette de niveau (`rangeLabel`) si définie, chip places
  restantes (**coral si 1 place**, accent sinon, « Complet » mute), CTA « Rejoindre »
  (lien `/parties/[id]` — la page détail gère join/auth). Carte complète → CTA « Voir ».
- Style : `th.surface`, radius 18, ombre douce, léger lift au survol (`.sp-btn`).
- En-tête de section : « Ça joue bientôt » + « Toutes les parties → » (`/parties`).

### 3. Rythme éditorial partagé

- Nouveau `components/clubhouse/SectionHeader.tsx` : titre en `th.fontDisplay`
  ~21px + lien d'action optionnel à droite. Remplace les micro-titres uppercase
  (le `sectionTitle` local de `ClubHouse.tsx` disparaît).
- Espacement vertical entre sections : 30px (au lieu de 22).
- Langage carte unifié : `th.surface` + **ombre douce** (`0 10px 30px` encre à ~7%,
  adaptée au thème sombre via `th.mode`) au lieu de `inset 0 0 0 1px th.line`.

### 4. Sections restylées (composants en place)

- **`SlotsAlaUne`** : rangées nettes (heure en display, prix mono), bouton Réserver
  compact ; carte au langage commun.
- **`TournamentsAlaUne`** : idem, jauges/countdown conservés.
- **Vos prochaines réservations** (inline dans `ClubHouse.tsx`) : rangées fines.
- **`PosterMosaic`** : bento conservée, rayons/ombres harmonisés.
- **`OffersShowcase`** : fini les 4 pavés à gros boutons — **rail horizontal** de
  cartes compactes (~240px), **prix en chiffre vedette** (typo display), sous-texte
  crédits/validité, CTA discret (bouton fin). Le flux d'achat (`StripePaymentStep`,
  `AuthPromptDialog`, gating `hasSub`) est inchangé.
- **`TopOfMonth`** : vrai **podium visuel** — 3 marches (2-1-3), avatars au-dessus,
  hauteurs différenciées, or/argent/bronze, victoires en gros chiffre.
- **`ClubPresentationCard`** : carte éditoriale — photo de couverture (1re photo)
  avec voile + titre en surimpression, extrait, → `/club`. Sans photo : repli texte.
- **Annonces** : liste resserrée.
- **`SponsorMarquee`** : conservé tel quel (déjà au niveau), coiffé du
  `SectionHeader` commun.

### 5. Ordre adaptatif conservé (`ClubHouse.tsx`)

- Membre : hero → parties → créneaux/events → vos résas → affiches → podium →
  offres → club → annonces.
- Visiteur : hero → parties → le club → créneaux/events → affiches → offres →
  podium → annonces.
- Rivière partenaires toujours en dernier. Chaque bloc continue de se masquer en
  silence si vide ou en erreur.

## Technique

- **Helpers purs** dans `lib/clubhouse.ts` (testés) :
  - `clubPulse(slots, matches, agenda, now, tz)` → `PulseChip[]`
    (`{ kind: 'slot'|'matches'|'event', label }`), n'émet que les chips dont la
    donnée existe ; `now` nullable → `[]` (hydration-safe).
  - `matchSeats(match)` → `{ filled: OpenMatchPlayer[], empty: number }`
    (capacité = `players.length + spotsLeft`).
- Aucun endpoint nouveau, aucune migration ; `ClubHouse` charge déjà tout.
- Tests front : `clubhouse.test.ts` (helpers), `ClubHouseHero.test.tsx` (migration
  des cas `HeroAnnouncement` : clamp, top-sheet, CTA, stopPropagation + pouls),
  `OpenMatchesShowcase.test.tsx` (sièges vides, chip coral 1 place, complet, liens),
  mises à jour `ClubHouse.test.tsx` / `TopOfMonth` / `OffersShowcase` /
  `ClubPresentationCard` si les assertions de structure changent.
- Vérification visuelle : screenshots CDP membre/visiteur × mobile/desktop ×
  clair/sombre.

## Hors périmètre

- Backend, migrations, nouveaux endpoints.
- Refonte de `/parties` (la section vedette pointe dessus).
- Récurrence des données du pouls côté serveur (tout est dérivé client).
- Mode TV / météo / QR (déjà hors v2).
