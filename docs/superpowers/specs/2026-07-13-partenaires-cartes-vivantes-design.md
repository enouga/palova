# Partenaires « Cartes vivantes » (flip 3D) — design

**Date** : 2026-07-13
**Périmètre** : 100 % frontend. Aucune migration, aucun changement backend, `/admin/sponsors` inchangé.

## Intention

La section « Nos partenaires » du Club-house (`SponsorMarquee`, tuiles logo statiques /
rivière défilante) est jugée générique. On veut une animation **originale et unique** qui
**met en avant les partenaires** et **leurs offres**, tout en restant élégante.

Direction retenue par Eric (parmi 3 concepts animés comparés dans le companion visuel :
A « bord de piste LED », B « spotlight stories », **C « cartes vivantes »**).

## Concept

Une **grille posée** de cartes partenaire (plus de rivière). Chaque carte est une tuile logo
blanche. **En cascade, une carte à la fois se retourne en 3D** (rotateY, ~0,6 s) pour révéler
son **dos** — l'offre du partenaire sur un dégradé bleu nuit — la tient ~3 s, puis revient ;
la carte suivante enchaîne, en boucle. **Au tap**, une carte se retourne manuellement et
ignore alors la cascade (l'utilisateur garde la main).

L'offre devient le héros **sans occuper d'espace supplémentaire** : elle vit au dos du logo.

## Composant

`components/clubhouse/SponsorFlipDeck.tsx` **remplace** `SponsorMarquee.tsx` (supprimé), même
signature de props `{ sponsors: Sponsor[]; now?: Date | null }`. Import + usage basculés dans
`ClubHouse.tsx` (`sponsorsVisible && <SponsorFlipDeck … />`). `SectionHeader title="Nos partenaires"`
conservé.

### Structure DOM

```
section
  SectionHeader "Nos partenaires"
  .fd-grid (flex wrap, gap)
    .fd-cell (révélation d'entrée : fondu + montée, stagger --i)   ← cible IntersectionObserver
      div[role=button] .fd-scene (perspective, tap = flip, aria-pressed, aria-label = nom)
        .fd-card (.is-flipped ⇒ rotateY(180deg), transition .6s)
          .fd-face.fd-front  → tuile blanche : logo (contain) + nom en bas
          .fd-face.fd-back   → dégradé bleu nuit : offre OU « Partenaire du club »
```

- La carte est un `div[role=button]` (pas `<button>`) pour pouvoir contenir le **bouton
  « copier le code »** et le **lien « Visiter → »** sans imbrication de `<button>` — pattern
  déjà utilisé par `HeroAnnouncement`. Clavier : Enter/Espace flippent ; `aria-pressed`.
- Bouton copier / lien visiter : `stopPropagation` pour ne pas flipper en cliquant dessus.

### État & cascade

- `autoIdx` : index de la carte actuellement retournée par la cascade, avance
  `(prev+1) % n` toutes les `CASCADE_MS = 3500` ms (`setInterval` dans un effet).
  Démarre à `-1` (aucune) → premier tick retourne la carte 0.
- `manual: Record<id, boolean>` : override par tap. Une carte est retournée si
  `id ∈ manual ? manual[id] : autoIdx === i`. Tap ⇒ `manual[id] = !flippedActuel`.
- Cascade **désactivée** si `n < 1` ou **`prefers-reduced-motion`** (détecté via `matchMedia`).

### Dos de carte

- **Offre active** (`offerIsActive(s, now)`) : label « Offre membres », `offerText`,
  **code copiable** (`offerCode`, bouton ✓ Copié — repris de SponsorMarquee), + compte à
  rebours coral si `offerUntil` urgent (`deadlineCountdown`).
- **Sans offre** : nom + « Partenaire du club » + chip « Visiter → » si `linkUrl`.
- ⇒ tout partenaire participe à la cascade, même sans offre (un club sans offres a quand
  même une section vivante).

### Accessibilité / robustesse

- `prefers-reduced-motion` : pas de cascade auto, pas de transition de rotation (bascule
  instantanée au tap), grille statique révélée d'emblée.
- Révélation d'entrée au scroll (IntersectionObserver, comme l'itération précédente) —
  cache les cartes tant qu'on n'est pas arrivé dessus, puis cascade.
- Reste beau avec 2 partenaires (grille de 2, pas de duplication).

## Tests

`__tests__/SponsorFlipDeck.test.tsx` (remplace `SponsorMarquee.test.tsx`, supprimé) :
- front : 1 logo + nom par sponsor (pas de duplication) ;
- dos avec offre : `offerText` + bouton code présents ; sans offre : « Partenaire du club » ;
- tap ⇒ `aria-pressed` bascule ; clic sur « copier » ne flippe pas la carte (stopPropagation) ;
- cascade (fake timers) : après `CASCADE_MS` la carte 0 se retourne, puis la 1 ;
- `prefers-reduced-motion` (matchMedia surchargé) : pas de cascade auto, tap flippe quand même ;
- 2 sponsors → 2 cartes ; 0 sponsor → `null`.

## Démo

Les 2 sponsors seedés (`club-demo`) n'ont pas d'offre → j'insère une offre d'exemple en base
dev (SQL direct via `prisma db execute`, sans toucher `seed.ts`/`seed-demo.ts` qui ont du WIP
parallèle) pour visualiser le dos « offre ».

## Évolution v2 (même jour) — sensation « carte physique »

Passe de polish sur le même concept, toujours 100 % frontend :
- **Tilt 3D au survol** (desktop seulement, `@media (hover:hover) and (pointer:fine)`) — la
  carte s'incline vers le curseur (vars CSS `--mx`/`--my` posées au mousemove, consommées en
  `rotateY/rotateX` sur `.fd-scene` ; `perspective` sur `.fd-cell`).
- **Entrée « distribution »** — les cartes arrivent tournées (`rotate(-5deg)`) et se posent
  avec un ressort (`cubic-bezier(.34,1.56,.64,1)`), stagger 90 ms.
- **Dos façon coupon** (offres seulement) : **encoches latérales** (2 pastilles couleur
  `th.bg` → semblent découpées, robustes clair/sombre), **filigrane « % »**, **reflet** qui
  balaie le dos une fois à l'ouverture (`fd-sheen`), ombre bleutée renforcée.
- **Pastille « % » apricot** (`th.accentWarm` + `inkOn`) en haut-droite de la **face avant**
  des cartes à offre active, avec battement discret — on sait qu'il y a une offre avant de
  retourner, et les utilisateurs `reduced-motion` (qui ne voient jamais la cascade) ne la
  ratent plus. Testée (`aria-label="Offre disponible"`, absente si pas d'offre/expirée).
- **Pop d'ouverture** (`fd-pop` sur `.fd-scene.is-open`) + micro-pop sur « ✓ Copié ».
- Reduced-motion : tous les nouveaux effets désactivés (tilt, deal, pop, sheen, battement).

## Hors périmètre

Édition admin des offres inchangée ; pas de récurrence/vidéo ; pas de nouveau modèle.
```
