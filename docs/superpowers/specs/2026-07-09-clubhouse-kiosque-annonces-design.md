# Club-house — hero « Kiosque » : scène cinéma des annonces

## Contexte

Le haut de page du Club-house (landing du club) déplaisait au gérant : un gros bandeau
pour un titre + un bouton « Réserver un terrain » + des chips « pouls du club », occupé
par l'annonce épinglée en mode bandeau publicitaire. Quatre griefs : pas assez utile,
générique/froid, encombrant, l'annonce en vedette qui squatte l'accueil. Le besoin exprimé :
**mettre les annonces du club en majesté** — les clubs produisent des affiches (souvent au
format portrait / story) ; les afficher « dignes des plus beaux sites », ou s'en passer
élégamment quand il n'y a pas d'image.

Brainstorming visuel mené (4 directions, puis 3 déclinaisons portrait). Direction retenue :
**« la Scène cinéma »**.

## Design

**Le Kiosque « À la une »** (`AnnouncementKiosk`, remplace `ClubHouseHero`) est en tête de
page, toujours présent. Une annonce à la fois, défilement automatique façon stories.

- **Défilement** : segments de progression cliquables en haut, flèches ‹ ›, pause au
  survol/focus, `prefers-reduced-motion` → pas d'auto-advance. La **vitesse est réglée par
  l'admin** (`Club.clubHouseKioskSeconds`, migration additive `add_club_house_kiosk_seconds`,
  défaut 6 s) : curseur 3–20 s + case « Pas de défilement automatique » (stocke 0 = manuel)
  dans la carte « Sections du Club-house » de `/admin/club`. Backend : `normalizeKioskSeconds`
  (0 ou borné 3–20), exposé par `getClubBySlug`/`getClubForAdmin`, écrit par `updateClub`.
  Front : prop `intervalSeconds` du kiosque (0 → pas d'auto-advance).
- **Annonce AVEC affiche** : l'affiche **portrait entière** (`object-fit` naturel, jamais
  rognée, hauteur plafonnée ~240 px) posée devant **son propre reflet flouté** (même image
  dupliquée en fond, `blur(34px) scale(1.25)`, voile sombre latéral) → chaque annonce porte
  sa propre ambiance sans travail pour le club. Encre blanche. À droite : nom du club
  (`fontBrand`), chip de type (Tournoi/Offre/Event ; INFO sans chip), chip compte à rebours
  coral si `validUntil` (via `deadlineCountdown`), titre display, extrait clampé 2 lignes,
  « En savoir plus → » si `linkUrl`.
- **Annonce SANS image** : panneau signature « brume bleue » (`HERO_GRADIENT` + `HERO_INK`,
  lisible en clair comme en sombre), mêmes éléments typographiques.
- **Clic sur une diapo** : affiche en grand (lightbox) si image, sinon feuille du texte
  complet (top-sheet).
- **Contenu** : toutes les annonces actives (non expirées), épinglées d'abord (ordre API),
  plafond 6 (`kiosqueSlides`).
- **Aucune annonce** : repli brume bleue fin (nom du club + accroche « Réservez, jouez,
  retrouvez-vous. »), sans CTA.

**Supprimé** (décisions du gérant) : le bouton « Réserver un terrain » et les chips « pouls
du club » (la nav et « Ça joue bientôt » les couvrent) — donc le fetch de disponibilité 7 j
disparaît de la page ; la mosaïque « À l'affiche » (`PosterMosaic`) et la liste texte
« Annonces », fondues dans le kiosque (une seule scène, plus de doublon). Les deux clés de
sections configurables `posters` et `announcements` sont retirées (front + backend) ; les
configs stockées les référençant sont ignorées à la lecture et purgées à la prochaine
écriture.

## Mise en œuvre (100 % frontend + 1 constante backend)

- **`frontend/lib/clubhouse.ts`** : ajout `kiosqueSlides(anns, now)` (pur, testé) ;
  suppression `clubPulse`/`PulseChip`/`pulseWhen`/`activePosters`/`posterLayout`/
  `pickUpcomingSlots`/`UpcomingSlot` (sans consommateur restant) ; `SECTION_KEYS`/
  `SECTION_DEFS`/`MEMBER_ORDER`/`VISITOR_ORDER` passent de 8 à 6 clés.
- **`frontend/components/clubhouse/AnnouncementKiosk.tsx`** (nouveau) : la scène + lightbox
  + feuille. Sanitize CSS de l'URL image conservé (anti-injection `url('…')`). Marge
  latérale élargie quand les flèches sont présentes (le contenu ne passe jamais sous une
  flèche).
- **`frontend/components/ClubHouse.tsx`** : câble le kiosque, retire le fetch de dispo,
  les dérivations `hero`/`posters`/`restAnn`, les sections `posters`/`announcements`,
  recalcule `empty`.
- Suppression de `ClubHouseHero.tsx` + `PosterMosaic.tsx` (+ leurs tests).
- **`frontend/lib/api.ts`** : `ClubHouseSectionKey` sans `posters`/`announcements`.
- **`backend/src/services/club.service.ts`** : `CLUB_HOUSE_SECTION_KEYS` sans
  `posters`/`announcements`.
- Aucune migration.

## Tests

`AnnouncementKiosk.test.tsx` (nouveau : diapos image/texte, chips, countdown, navigation
segments/flèches + bouclage, lightbox/feuille, repli, URL hostile), `clubhouse.test.ts`
(`kiosqueSlides`, sections 6 clés), `ClubHouse.test.tsx` (kiosque, ordre custom, état vide),
`AdminClub.test.tsx` (6 sections), backend `club.service.test.ts` (normalizer 6 clés).
Vérification visuelle (Chrome CDP) : clair + sombre, desktop 1280 + mobile 390, diapo texte
(brume bleue) et diapo affiche portrait (scène cinéma), repli sans annonce.
