# Étude de prix — offre Palova pour les clubs (2026-07-07)

> Objet : caler les 3 formules SaaS destinées aux gérants de clubs (Découverte / Club / Club Pro),
> aujourd'hui « [à compléter] € » dans `frontend/lib/platformContent.ts` (`PLATFORM_TARIFS`).
>
> ✅ **Fiabilité — vérification adversariale effectuée le 2026-07-07.** Les prix concurrents ont été
> **recoupés sur les pages éditeurs live** (+ comparateurs indépendants Capterra/GetApp). Statut par
> ligne dans la colonne « Vérif. » ci-dessous (✅ confirmé verbatim · ⚠️ corrigé/à nuancer · ❔ non
> vérifiable/non publié). **Corrections notables issues de la vérif :**
> - **Eversports Starter = 79 €/mois** (pas 69 — le 69 traîne sur Capterra/GetApp, périmé) ; il existe
>   un 5ᵉ palier **Champion 229 €** ; surtout la grille 49→229 est la gamme **« Studios »** (bien-être),
>   la gamme pertinente pour un club de **courts** est **« Ballsports » — Standard 99 €/mois** (annuel).
> - **Tennislibre est PAYANT** (pas gratuit) : SaaS annuel, gratuit seulement < 20 membres + essai 30 j.
> - **CourtReserve dès 199 $/mois** (pas 50 $) ; **Mindbody plancher 99 $** (pas 117 $).
> - **Commissions Playtomic et Anybuddy NON PUBLIÉES** → ne pas chiffrer « 3,5-4 % » ni « 5-15 % ».
> - Reproches **« Doinsport sans tournois »** et **« Gestion-Sports matériel en sus »** : **contredits**
>   par les pages éditeurs → à ne pas publier tels quels.
> - FFT/ADOC : gratuit **confirmé** ; parc de clubs = **7 000+** (chiffre officiel ; « 7 300 » plausible
>   mais non recoupé sur page live, tenup.fft.fr derrière une file d'attente queue-it).
>
> **Impact sur la reco :** les deux ancres qui portent le positionnement Palova — Doinsport (89 / 161-179 €)
> et Gestion-Sports (197 / 247 € HT) — sont **confirmées verbatim**. La grille recommandée (§3) tient donc
> sans changement.

## 1. Ce que facture le marché (FR/EU, 2025-2026)

Tous les prix sont **par club, HT, mensuels** sauf mention contraire. Colonne « Vérif. » = statut de la
vérification live du 2026-07-07.

| Acteur | Modèle | Prix | Commission | Vérif. |
|---|---|---|---|---|
| **TenUp / ADOC (FFT)** | Gratuit fédéral | **0 €** | — | ✅ gratuit confirmé (ligue-grandest-fft.fr/adoc). Parc **7 000+** clubs (officiel FFT ; « 7 300 » non recoupé). |
| **Tennislibre** | SaaS annuel **payant** | **sur devis** (gratuit seulement < 20 membres + essai 30 j) | — | ⚠️ **corrigé** : n'est **pas** gratuit (CGU : « site payant sauf structures < 20 personnes »). |
| **Balle Jaune** | Freemium **par membre** | Bronze 0 € (30 users) · Silver **79 €/AN** (150) · Gold **149 €/AN** (500) · Platinum **249 €/AN** (1500) +0,30 €/user | Aucune | ✅ confirmé verbatim (2 pages live). **Prix TTC** (pas HT). Contrôle d'accès en sus (+5/+10/+20 €/mois). Essai 60 j Gold/Platinum. Soit ~7-21 €/**mois**. |
| **Eversports Manager** | Hybride abo + commission | Gamme **Studios** : Light 49 · **Starter 79** · Accelerate 119 · Professional 169 · **Champion 229** €/mois (facturé annuel) + onboarding **99 €** (199 € pour Pro/Champion). **Gamme Ballsports (clubs de courts) : Standard 99 €/mois** (annuel), Enterprise sur devis. | **25 %/résa** (plafond 75 €/pers.) **uniquement** sur clients acquis via l'app Eversports (pas les résas directes) | ⚠️ **corrigé** : Starter 79 (pas 69), +palier Champion 229 ; la grille 49→229 est la gamme **Studios/bien-être** — pour un club de courts c'est **Ballsports Standard 99 €**. Commission ✅ confirmée. |
| **Doinsport** | Forfait par club | Assos/public **89-99 €** · Clubs privés **161-179 €** (*Popular*) · Franchises sur devis | Aucune affichée | ✅ prix confirmés verbatim (doinsport.com/en/our-prices ; la page FR /nos-prix est morte). Paiement en ligne **inclus** dès l'entrée ✅. App marque blanche + SMS **en sus** ✅. ⚠️ **« pas de gestion de tournois » = FAUX** : l'éditeur liste bien « Event management : tournament ». |
| **Gestion-Sports** | Forfait par club | 100% Autonome **dès 197 € HT** · 100% Premium **dès 247 € HT** | Aucune | ✅ confirmé verbatim (gestion-sports.fr/tarifs). Pas de palier gratuit ✅. Borne **haute** du marché FR. ⚠️ **« matériel en sus » à nuancer** : la page inclut contrôle d'accès, éclairage connecté et **caisse NF525** dans les forfaits. |
| **Playtomic Manager** | Abo (4 paliers) + marketplace | Standard / Professional / Champion / Master — **prix cachés (devis)** ✅. Estimations tierces non officielles (softwaresuggest) : ~$38 / $88 / $132 / $276/mois. | **Non publiée** — varie par pays, plafond **absolu** (frais côté joueur ~2,9 % observé). | ❔ prix **cachés confirmés**. Commission **non chiffrable** : « 3,5-4 % » / « 5-15 % » **non vérifiables**. SLA 48h→**8h**→4h→prioritaire. Leader EU 6 700+ clubs. |
| **Anybuddy** | 100 % marketplace | **0 € abo** club | Commission par résa (**taux non publié**) | ✅ 0 € abo + ~1 500 clubs + **15 M€** de volume 2025 confirmés. ❔ taux de commission **non publié** — ne pas chiffrer. |

Repères internationaux (vérifiés sur pages éditeurs + Capterra indépendant ; l'ancienne source
auto-promotionnelle 1club.ai n'est plus la seule) :
- **CourtReserve** — ⚠️ **corrigé** : dès **199 $/mo** (Launch, 159 $ annuel) · Advance 369 $ · Momentum 549 $.
  Le « 50 $/mo » est faux ; le « 25 $ » de Capterra est un tarif **périmé**.
- **1club** — ✅ gratuit ≤ 100 membres puis **63 $/mo** (confirmé Capterra indépendant). ⚠️ mais c'est un
  logiciel **gym/fitness**, pas padel/tennis — repère de faible pertinence.
- **EZFacility** — ✅ dès **144 $/mo** (Capterra ; « 125 $+ » tient). Largement sur devis, add-ons lourds.
- **Mindbody** — ⚠️ **corrigé** : plancher affiché **99 $/mo** (pas 117 ; devis réels 129-159 $/mo).
- Fourchette « **200-500 $/mo** » pour la gestion de club mid-market : ✅ plausible (agrégation indépendante).
- « Plateformes type Playtomic **5-15 %** de commission » : ❔ **non vérifiable** (aucune source ne publie le taux).

## 2. Modèles de tarification dominants

Trois modèles coexistent (Book&Go, comparatif Doinsport) :

1. **Forfait mensuel par club** (paliers de fonctionnalités) — **modèle dominant en France** (Doinsport,
   Gestion-Sports). Simple, lisible, sans mauvaise surprise. Ne punit pas les clubs multi-terrains.
2. **Par terrain / par membre** — bon marché pour les tout petits, **grimpe vite**. Plutôt anglo (Pickle
   Planner, CourtReserve). Balle Jaune facture au membre.
3. **Commission % sur réservations** — mise de départ faible, **coûteux à gros volume** (Playtomic, Anybuddy).

**Fourchette selon la taille :** le modèle FR ne segmente **pas par nombre de terrains** mais par
**profil/fonctions** (asso vs club privé vs franchise). Un club de 2-4 terrains paie le même forfait
qu'un club de 8 chez Doinsport/Gestion-Sports ; les gros passent « sur devis ». Eversports est
l'exception qui scale au volume de réservations.

**Argument structurel pour Palova :** les tout-en-un français « **sans commission** » deviennent
d'autant plus rentables que le volume de résas monte — argument commercial fort face aux plateformes à
commission. C'est exactement le positionnement de Palova (Stripe Connect, fonds directs au club,
**0 % d'intermédiation**). ⚠️ Nuance issue de la vérif : « sans commission » est **cohérent** avec le
modèle forfait de Doinsport/Gestion-Sports mais **n'est pas écrit noir sur blanc** sur leurs pages tarif ;
à publier avec un léger conditionnel si comparaison externe.

## 3. Recommandation chiffrée pour Palova

> Grille **inchangée** après vérification (les ancres Doinsport 89/161 et Gestion-Sports 197/247 sont
> confirmées). Décision finale + écriture dans `PLATFORM_TARIFS` : **non tranché** (hors périmètre de
> cette passe « vérification seulement »).

**Principes :** (a) forfait plat par club, **pas par terrain** (attente du marché FR ; ne pas pénaliser
les clubs de padel qui ont beaucoup de terrains) ; (b) **undercut visible** des leaders FR car produit
jeune/inconnu = coût de bascule + risque perçu à compenser ; (c) un **gratuit crédible** est
quasi-obligatoire face au gratuit fédéral (TenUp/ADOC) ; (d) prix **HT**, remise annuelle **~-15 %**.

### Grille recommandée

| Formule | Prix mensuel HT | Annuel HT (~-15 %) | Positionnement |
|---|---|---|---|
| **Découverte** | **0 €** (à vie) | — | Bat le gratuit fédéral en UX ; land-and-expand. |
| **Club** | **79 €/mois** | ~69 €/mois | Sous Doinsport assos (89-99 €), **au niveau exact d'Eversports Starter (79 €)**. Cible 2-4 terrains. |
| **Club Pro** | **149 €/mois** | ~129 €/mois | Sous Doinsport clubs privés (161-179 €) **et** Gestion-Sports (197-247 €). |
| **Franchise / Multi-club** | **sur devis** | — | Convention du marché (Doinsport, Gestion-Sports). |

**Variante « conquête »** (si priorité = rafler les premiers clubs plutôt que la marge) :
Club **59 €** / Club Pro **119 €** → Palova devient le **price leader** clair du tout-en-un FR.

### Ce que contient chaque palier

- **Découverte — 0 €** : réservation en ligne, page club brandée (sous-domaine, PWA), annuaire public,
  **parties ouvertes** (effet réseau → laissé gratuit exprès), liste de membres basique. *Pas* de caisse,
  *pas* de paiement en ligne, *pas* de tournois/events, mono-sport. → moteur d'upgrade.
- **Club — 79 €** : tout Découverte + **gestion des membres/abonnements/carnets**, **tournois &
  événements**, **caisse & comptabilité** (encaissement au comptoir), quotas de réservation, emails
  automatiques personnalisables. 1 sport. Cible le petit/moyen club.
- **Club Pro — 149 €** : tout Club + **encaissement en ligne (Stripe Connect, 0 % de commission Palova)**,
  **multi-sports**, quotas avancés, calendrier national des tournois, **support prioritaire**, domaine/alias.
- **Franchise — devis** : multi-club, comptes centralisés, onboarding dédié.

### Pourquoi ces montants

- **79 € pour Club** : juste sous le plancher payant crédible du tout-en-un FR (Doinsport 89 €, **confirmé**).
  Assez bas pour qu'un club de 2-4 terrains dise oui vite ; assez haut pour signaler un produit sérieux (vs le
  quasi-gratuit Balle Jaune, perçu « réservation simple »). Coïncide pile avec Eversports Starter (79 €, **corrigé**).
- **149 € pour Club Pro** : ~20-30 € **sous** Doinsport privé (161-179 €, **confirmé**) et ~50-100 € sous
  Gestion-Sports (197-247 €, **confirmé**), tout en offrant le **paiement en ligne sans commission** — le seul
  argument que ni Playtomic ni Anybuddy ne peuvent égaler (leurs commissions existent mais **ne sont même pas
  publiées**, ce qui renforce l'argument « prix opaque » côté Palova). Le delta de prix est le levier de bascule ;
  le 0 % commission est le levier de rétention (rentabilité croissante avec le volume).
- **Ne pas facturer au terrain** : ce serait pénaliser exactement la cible (clubs de padel multi-terrains)
  et compliquer un pitch qui doit rester simple pour un produit jeune.

## 4. Prochaines étapes (non faites — hors passe « vérification »)

1. **Trancher** Club/Club Pro : grille standard (79/149) vs variante conquête (59/119).
2. **Écrire** les montants dans `frontend/lib/platformContent.ts` (`PLATFORM_TARIFS`, remplacer les
   `[à compléter]`), + compléter les mentions légales (`PLATFORM_MENTIONS` : forme juridique, SIRET…).
3. **Décider HT/TTC affiché** et la mécanique de remise annuelle (~-15 %) côté page publique `/tarifs`.
4. Éventuel garde-fou marketing : ne comparer publiquement qu'aux chiffres **confirmés verbatim**
   (Doinsport, Gestion-Sports, Balle Jaune) ; éviter d'avancer des commissions concurrentes chiffrées
   (Playtomic/Anybuddy) puisque non publiées.

## Sources principales (vérifiées live le 2026-07-07)

- **Doinsport** — grille officielle **live** : `doinsport.com/en/our-prices` (la page FR `/nos-prix` renvoie 404) ;
  comparatif : `doinsport.com/en/blog/best-padel-club-management-software-2026-comparison`.
- **Gestion-Sports** — `gestion-sports.fr/tarifs/` (197 / 247 € HT confirmés).
- **Balle Jaune** — `ballejaune.com/fr-fr/signup` + `ballejaune.com/fr/terms/terms-for-clubs` (prix TTC confirmés).
- **Eversports** — `eversportsmanager.com/pricing` (Starter 79 €, gammes Studios & Ballsports) ; Capterra/GetApp
  = source du **69 € périmé**.
- **Playtomic** — `playtomic.com/pricing` (prix cachés confirmés) ; pages « Service Fee » **403** → commission
  non vérifiable ; estimations tierces `softwaresuggest.com/playtomic-manager`.
- **Anybuddy** — `anybuddyapp.com/fr/pro` (0 € fixes) ; `padelonomics.com/.../anybuddy` (15 M€, 1 500 clubs).
- **FFT/ADOC** — `ligue-grandest-fft.fr/adoc` (gratuit) ; `fft.fr` (« 7 000+ clubs ») ; tenup.fft.fr inaccessible
  (file d'attente queue-it) → « 7 300 » non recoupé.
- **Tennislibre** — `tennislibre.com/tennis/front/home/cgu.php` (**payant** ; gratuit < 20 membres + essai 30 j).
- **International** — `courtreserve.com/pricing` (199/369/549 $) ; `1club.ai/pricing` + Capterra (63 $) ;
  Capterra EZFacility (144 $) & Mindbody (99 $).
- Taxonomie modèles — `bookandgo.app/en/blog/tennis-court-reservation-software`.
