# Stratégie clubs pilotes — « Clubs fondateurs »

*Rédigé le 21 juillet 2026. Objectif : premier club live à la mi-août 2026.*

## L'idée en une phrase

Lancer **un seul club pilote** à Toulouse sous un deal « Club fondateur » généreux, le faire tourner
sans assistance quotidienne en 3-4 semaines, puis dupliquer sur les clubs 2 et 3 avec un playbook
rodé — plutôt que d'ouvrir plusieurs clubs de front et de décevoir tout le monde en même temps.

## Le deal « Club fondateur »

**Ce que le club reçoit :**
- Palova **gratuit 12 mois**, quel que soit le nombre de membres actifs (hors grille de paliers).
- Ensuite, **tarif fondateur réduit à vie** (-40 à -50 % sur la grille publique).
- Un interlocuteur direct (Eric), sur place au démarrage.

**Ce que le club donne :**
- Du **feedback régulier** (point hebdo 15 min pendant le pilote).
- De la **tolérance aux bugs** — c'est un pilote, c'est dit franchement dès le départ.
- Un **témoignage + logo** utilisables commercialement une fois le pilote réussi.

L'accord tient sur une page. « Offre fondateur » devient ensuite un argument réutilisable pour les
clubs suivants (rareté : elle est limitée aux 3 premiers clubs).

## Le rythme

1. **Club 1 seul** pendant 3-4 semaines. Le premier onboarding révélera des frictions
   qu'on n'imagine pas (reprise de données, habitudes du staff, cas tordus du planning réel) —
   mieux vaut les découvrir avec un club qui a toute l'attention.
2. **Clubs 2 et 3** dès que le club 1 tourne sans appel au secours quotidien
   (le staff encaisse seul, les joueurs réservent seuls).
3. Un prospect grillé par une mauvaise première expérience ne revient jamais :
   on grille le moins de cartouches possible pendant qu'on apprend.

## La cible n°1 (prospection Toulouse/31, juillet 2026)

Profil recherché, dans l'ordre de préférence :
1. **Pré-ouverture** — zéro migration, zéro habitude à casser, le club démarre directement sur Palova.
2. **Club établi sans logiciel** (téléphone/cahier, ou TENUP basique) avec accueil staffé.

**Critères d'exclusion** (voir mémoire `concurrents-saas-padel-france`) :
- Club sous contrat **Playtomic / Gestion-Sports / Village Padel / LiveXperience / Xplor Active** —
  friction de changement trop forte pour un pilote.
- Club dont le modèle repose sur l'**accès autonome sans personnel** (déverrouillage smartphone,
  éclairage auto — ex. réseau Village Padel) : Palova ne pilote pas de porte (plan Akiles parké),
  le club garderait son système en parallèle, ce qui annule l'intérêt de migrer.
  Un digicode annexe en complément d'un accueil staffé reste éligible.

## Rétro-planning (depuis le 21/07)

| Semaine | Objectif |
|---|---|
| **21/07** | Prérequis techniques (ci-dessous) + **contact du club cible cette semaine** — les décideurs partent en congés début août : le chemin critique est commercial, pas technique |
| **28/07** | Démo sur place, accord fondateur signé, collecte des données du club (terrains, tarifs, horaires, plages creuses, offres) |
| **04/08** | Setup via le wizard d'onboarding, formation du staff (~1 h : planning, caisse, encaissement), période de doublon avec le système actuel |
| **11-15/08** | **Go live** : les résas réelles passent sur Palova, Eric joignable en direct |

## Prérequis techniques avant le go live

Rien de nouveau — c'est la liste VM/consoles existante, priorisée pour le pilote :

- **SMTP prod branché = bloquant absolu.** Sans lui, aucun joueur du club ne peut valider son
  inscription (code par email). À vérifier/faire en premier.
- **Backups** : gestes VM restants + moniteur uptime externe (UptimeRobot sur `/health`).
- **GA4** : renseigner `NEXT_PUBLIC_GA_ID` sur la VM + rebuild (le code est prêt).
- **Légal** : les placeholders Kbis peuvent rester « en cours d'immatriculation » pendant le pilote,
  à compléter dès que Tolaris Studio est immatriculée (+ bump `LEGAL_VERSIONS`).
  Le club doit adhérer à un dispositif de médiation de la consommation (ex. CM2C) —
  obligation du club, à mentionner au gérant.
- **Stripe Connect : PAS nécessaire.** Mode « paiement au club » (encaissement comptoir) —
  le pilote démarre sans paiement en ligne, ce P0 ne bloque pas.

## Boucle pendant le pilote

- Numéro direct (WhatsApp) pour le staff.
- Passage sur place en semaine 1 de go live.
- Point hebdo 15 min avec le gérant.
- `/admin/support` (tickets GitHub) pour tout le reste.

## Critères de succès — bilan fin septembre

- **≥ 60 %** des réservations passent en ligne (vs comptoir/téléphone) après 4 semaines.
- Le staff **encaisse dans Palova tous les jours** sans appel à l'aide.
- **Aucun bug critique** resté ouvert plus de 48 h.
- Le gérant **accepte de témoigner**.

**Si vert** → ouvrir les clubs 2 et 3 avec le playbook.
**Si le staff retourne au cahier** → comprendre pourquoi avant d'élargir. Un pilote qui échoue
en silence coûte plus cher qu'un pilote qu'on arrête proprement.

## Sortie du pilote

- Témoignage + logo « ils nous font confiance » sur palova.fr.
- Bascule au tarif fondateur à l'issue des 12 mois (rappel calendrier à J-60).
- Étude de cas courte (chiffres du club : % résas en ligne, temps staff gagné) pour la prospection.
