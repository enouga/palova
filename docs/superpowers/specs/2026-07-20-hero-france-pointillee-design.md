# « Trouvez où jouer. » — hero France en pointillés (vitrine) + Découvrir compact

**Date :** 2026-07-20
**Statut :** design validé en companion visuel (maquette « La France en pointillés » approuvée par Eric), arrangement vitrine/Découvrir validé.
**Périmètre :** 100 % frontend. Aucune migration, aucun changement backend, aucune route nouvelle.
**⚠️ Remplace la spec `2026-07-20-decouvrir-theme-territoire-design.md`** : l'habillage « Carte en filigrane » (fond « plan » en tuile répétée sur toute la page, déjà implémenté et mergé) est jugé raté par Eric (« bruit » sans point focal) et sera **retiré** par ce chantier.

## Intention

La vraie porte d'entrée des gens qui ne connaissent pas Palova est **palova.fr en anonyme**
(la vitrine `AnonymousView`). C'est là que doit vivre le geste signature « le Palova de tous les
clubs » — pas sur `/decouvrir`, qui est l'établi de recherche. Pattern marketplace classique
(Airbnb, Doctolib) : **le hero de l'accueil EST la recherche**, les résultats vivent sur une page
dédiée.

Décision d'ensemble (validée par Eric) :
- **Un seul endroit qui séduit** : le hero de la vitrine anonyme.
- **Un seul établi** : `/decouvrir` (public, pour tous), en-tête compacte.
- **Le connecté garde son raccourci** : la racine palova.fr connectée (« Vos clubs » joueur /
  accès admin gérant, `PlatformLanding`) est **strictement inchangée**.
- **Les cartes parties/tournois/clubs gardent la charte club partout** (contrainte dure).

## Le geste signature : « La France en pointillés »

Une **France dessinée en points d'encre** (trame de points masquée par la silhouette de
l'hexagone, Corse comprise) posée dans le hero brume bleue, où **6 points « clubs » s'allument**
aux couleurs de la palette `ACCENTS` : Lille cyan, Paris bleu, Nantes apricot, Lyon émeraude,
Bordeaux violet, Marseille coral. À l'ouverture, les épingles apparaissent une à une (pop
staggeré ~0,15 s d'écart, `cubic-bezier` rebond léger) ; `prefers-reduced-motion` → statique.

**Réalisation technique** (celle de la maquette validée, qui marche) :
- Trame : `background-image: radial-gradient(circle, rgba(27,42,63,.38) 1.35px, transparent 1.7px)`,
  `background-size: 8px 8px`, **masquée** par un SVG data-URI de la silhouette France
  (`mask: … center/contain no-repeat`).
- La boîte du composant est **carrée** (`aspect-ratio: 1/1`, ratio de la viewBox 100×100) pour
  que le masque `contain` la remplisse exactement → les épingles positionnées en % (coordonnées
  du path) tombent **sur** la forme.
- Épingles : `span` absolus 10 px, ronds, halo (`box-shadow` anneau brume + lueur couleur),
  positions : Lille (57,11), Paris (52,24), Nantes (25,44), Lyon (70,50), Bordeaux (33,61),
  Marseille (68,69).
- Silhouette (path 100×100, hexagone + Corse) : celle de la maquette
  `M58,3 L66,7 L74,9 L83,15 L90,22 L86,30 L91,40 L87,47 L92,55 L86,63 L88,69 L78,71 L68,74
  L60,72 L54,77 L47,81 L36,82 L25,79 L21,75 L24,66 L21,58 L26,52 L17,46 L9,43 L2,36 L8,30
  L17,31 L24,28 L23,20 L28,19 L30,26 L38,23 L46,15 L52,8 Z M92,74 L95,78 L93,87 L89,84 L90,77 Z`.
- Composant **partagé** `frontend/components/platform/FranceDotsMap.tsx` (présentationnel pur,
  `aria-hidden`, `pointer-events:none`), utilisé par la vitrine (grand) et `/decouvrir` (petit).
  Les tons sont des constantes locales (encre `#1b2a3f` sur brume — le hero brume garde ses
  encres fixes dans les deux thèmes, règle du site).

## Surface 1 — vitrine anonyme (`AnonymousView`) : le hero change, tout le reste reste

**Ce qui reste strictement inchangé** (demande explicite d'Eric) : la nav sticky, les sections
`#parties` (rail `NationalOpenMatches`), `#clubs` (`ClubDirectory`), `#tournois`
(`UpcomingTournaments`), **« Comment ça marche »**, **le panneau B2B `ClubPitch` (« Vous gérez
un club »)**, l'outro. Les chips « pouls » (« N parties à rejoindre cette semaine » / « N
tournois à venir ») **restent dans le hero** (hydration-safe, ancres internes).

**Ce qui change — le panneau hero uniquement** :
- Le filigrane logo Palova + l'orbe accent sont **remplacés par la France en pointillés**
  (`FranceDotsMap`, calée à droite, ~92 % de la hauteur du panneau). **Mobile étroit** (< ~700 px,
  comme la maquette validée) : la France passe **derrière le texte** en filigrane (opacité ~0,5,
  débord droit coupé par l'`overflow:hidden` du panneau), le texte garde toute sa largeur.
- Kicker : **« Palova »** (fontBrand Righteous, inchangé — c'est l'accueil, la marque prime).
- Titre : « Le padel se joue ici. » → **« Trouvez où jouer. »**
- Sous-titre conservé dans l'esprit actuel : « Réservez un terrain, rejoignez une partie
  ouverte, visez un tournoi — dans les clubs Palova près de chez vous. » (inchangé).
- Les **2 CTAs** (« Trouver mon club → », « Voir les parties ») sont **supprimés** — la barre de
  recherche flottante les remplace (le pouls garde le lien vers `#parties`).
- **Barre de recherche flottante** à cheval sur le bord bas du panneau (`margin-top` négatif,
  z-index au-dessus) : pilule blanche h ≈ 58 px, ombre portée franche, épingle SVG accent à
  gauche, placeholder « Ville, code postal ou département », bouton **« Autour de moi »** en
  pilule encre `#1b2a3f` à droite. Elle reste **blanche dans les deux thèmes** (elle vit sur la
  brume, zone d'encres fixes).
- **Comportement** : saisie + Entrée → `router.push('/decouvrir?q=<saisie>')` ;
  « Autour de moi » → `router.push('/decouvrir?pres=1')`. (Même hôte plateforme → navigation
  Next standard.)

## Surface 2 — `/decouvrir` : l'établi, en-tête compacte

- **Retrait de l'habillage v1** : `DiscoverMapBackground.tsx` + son test sont **supprimés** ;
  la page redevient fond `th.bg` propre ; le liseré accent + l'épingle emoji du champ v1
  disparaissent avec le champ (remplacé ci-dessous).
- **Mini-hero compact** (pas de doublon de séduction) : bandeau brume bleue bas (~120-140 px de
  contenu), kicker « Découvrir » (Righteous), **pas de gros titre-promesse ni de sous-titre**,
  petite `FranceDotsMap` en filigrane à droite (opacité réduite, sans animation d'épingles ou
  épingles réduites à 3). La **même barre de recherche flottante** chevauche son bord bas —
  mais ici **contrôlée** : elle pilote `locInput` en direct (filtrage live des 3 sections,
  logique existante inchangée) et « Autour de moi » appelle `locateMe()` (états
  `idle/locating/denied` existants conservés, message « Localisation indisponible… » inclus).
- **Ancres** (`DiscoverAnchors`) : conservées fonctionnellement, **centrées** sous la barre
  (restyle léger conforme maquette). Compteurs, scroll-spy, deep-links `#parties/#tournois/#clubs`
  inchangés.
- **Deep-links de la vitrine** : au montage, la page lit `?q=` (→ `setLocInput(q)`) et
  `?pres=1` (→ `locateMe()` automatique). Aucun autre changement de logique (fetch, filtres,
  compteurs, redirection hôte-club → plateforme conservés).
- **Sections** : elles passent au **style éditorial existant** (tiret accent + kicker petites
  capitales + titre display) : « PARTIES OUVERTES / Ça joue bientôt », « COMPÉTITION /
  Tournois », « ANNUAIRE / Clubs ». Les grilles de cartes restent identiques.

## Composants (structure des fichiers)

- **Créer** `frontend/components/platform/FranceDotsMap.tsx` — la France en pointillés
  (présentationnel pur ; props : `pins?: 'full' | 'few' | 'none'` (défaut `full`),
  `style?: CSSProperties` pour taille/position/opacité posées par le parent). Keyframe du pop
  d'épingle dans `globals.css` (`pl-pinpop`, gardée par `prefers-reduced-motion`).
- **Créer** `frontend/components/discover/LocationSearchPill.tsx` — la barre flottante
  partagée ; props : `value`, `onChange`, `onSubmit?` (Entrée), `onNearMe`, `nearActive`,
  `locating`. La vitrine la contrôle avec un état local et navigue au submit ; `/decouvrir` la
  branche sur `locInput`/`locateMe`.
- **Modifier** `frontend/components/platform/AnonymousView.tsx` — hero (titre, retrait
  filigrane/orbe/CTAs, ajout France + barre, navigation).
- **Modifier** `frontend/app/decouvrir/page.tsx` — mini-hero compact, barre partagée, lecture
  `?q=`/`?pres=1`, sections éditoriales, retrait du fond v1.
- **Supprimer** `frontend/components/discover/DiscoverMapBackground.tsx` +
  `frontend/__tests__/DiscoverMapBackground.test.tsx`.

## Accessibilité & qualité

- `FranceDotsMap` : `aria-hidden`, `pointer-events:none`, jamais dans l'ordre de tabulation.
- La barre est un vrai `<input>` (le placeholder « Ville, code postal ou département » est
  **conservé à l'identique** — contrat des tests existants) + boutons accessibles au clavier
  (Entrée soumet sur la vitrine).
- Épingles : animation coupée par `prefers-reduced-motion`.
- Aucun débordement horizontal (France en `overflow:hidden` dans le panneau hero ; vérif CDP
  mobile en `mobile:false` largeur 390).
- Thème sombre : les heros brume restent clairs (encres fixes) ; le reste de la page suit `th`.

## Tests

- `FranceDotsMap.test.tsx` (nouveau) : `aria-hidden`, variantes `pins` (full → 6 épingles,
  few → 3, none → 0).
- `LocationSearchPill.test.tsx` (nouveau) : saisie → `onChange`, Entrée → `onSubmit`, clic
  « Autour de moi » → `onNearMe`, libellés selon `nearActive`/`locating`.
- `AnonymousView.test.tsx` (mise à jour) : « Trouvez où jouer. » rendu, barre présente,
  Entrée → navigation `/decouvrir?q=…`, « Autour de moi » → `/decouvrir?pres=1`, chips pouls
  toujours rendues, sections Comment ça marche/ClubPitch toujours là ; les assertions sur les
  anciens CTAs sont retirées.
- `DiscoverPage.test.tsx` (mise à jour) : plus de `discover-map` ; `?q=Lyon` préremplit le champ
  et filtre ; `?pres=1` déclenche la géoloc (stub `navigator.geolocation`) ; le reste des tests
  existants (ancres, filtres, redirection hôte-club) reste vert.
- `DiscoverMapBackground.test.tsx` : **supprimé**.
- **Vérification visuelle CDP** : vitrine anonyme + `/decouvrir`, clair + sombre, 1280 + 390.

## Hors périmètre

- Toute modification des cartes parties/tournois/clubs et des composants de section
  (`NationalOpenMatches`, `UpcomingTournaments`, `ClubDirectory`, `TournamentFinder`,
  `DiscoverMatches` : logique intacte, seuls les titres au-dessus changent de style).
- La racine palova.fr **connectée** (`PlayerView`/`ManagerView`) : intouchée.
- Vraie carte interactive (Leaflet/Mapbox), géocodage de la saisie du hero (la saisie est passée
  telle quelle à `/decouvrir` qui sait déjà l'interpréter ville/CP/département).
- Adaptation du hero par pays (la France en dur — l'i18n viendra avec le chantier mondialisation).
