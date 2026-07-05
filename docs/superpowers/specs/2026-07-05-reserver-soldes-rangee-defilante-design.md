# Réserver — rangée « soldes & quotas » défilante

**Date** : 2026-07-05
**Statut** : validé (approche « rangée défilante » choisie parmi 3 options)

## Problème

Sur la page Réserver, le bloc soldes/abonnements/quotas (au-dessus du sélecteur de dates) a quatre défauts :

1. **Trop d'espace vertical** : 4 grosses pastilles empilées sur 2 lignes + un libellé de période, qui repoussent la grille de réservation trop bas.
2. **Troncature** : la pastille « Abonné » coupe sa valeur (« padel · h. cre… ») dans sa cellule de grille 1fr.
3. **Largeur desktop gâchée** : le bloc est borné à `maxWidth: 360` et calé à gauche — tout l'espace à droite est vide.
4. **« cette semaine » orphelin** : le suffixe de période des quotas flotte seul, centré sous les jauges.

## Solution

Remplacer le bloc empilé de `ClubReserve.tsx` (l. 189–208) par **une seule rangée défilante pleine largeur** :

- Conteneur `.sp-scroll-x` (classe existante, scrollbar masquée) avec le pattern EventsFilterBar : wrapper `position: relative` pleine largeur, rangée `padding: 0 20px` — les pastilles filent bord à bord au swipe.
- Ordre : carnets/porte-monnaie → abonnés → quotas.
- Pastilles à **largeur naturelle** (`fill` retiré) → « padel · h. creuses » complet, fin de la troncature.
- Quotas rendus via **`<QuotaStatus inline />`** (mode existant, prévu pour ça) : le suffixe « cette semaine » / « à venir » revient **dans** chaque pastille de jauge (mode meter non-compact) — plus de libellé orphelin.
- **Fondu léger au bord droit** (pattern FriendsQuickRow, dégradé vers `th.bg`, `pointer-events: none`) pour signaler le débordement en mobile.
- `StatPill` : les pastilles non-`fill` gagnent `flexShrink: 0` (sinon, en flex overflow, la colonne texte `minWidth: 0` se compresse et ré-ellipsise). Sans effet ailleurs : toutes les autres surfaces (BookingModal, Mes réservations) utilisent `QuotaStatus compact` → `fill`.

## Comportement

- Desktop : tout tient sur une ligne et occupe la largeur.
- Mobile : swipe horizontal — même geste que la bande de dates juste en dessous.
- Aucun solde/abo/quota → bloc absent (condition actuelle conservée).

## Hors périmètre

- `DateSelector` (bande de dates, en-tête « Juillet », flèches) : inchangé.
- `QuotaStatus.tsx` : inchangé (le mode `inline` existe déjà).
- BookingModal et Mes réservations : inchangés.

## Tests

Nouvelle suite `frontend/__tests__/ClubReserve.balances.test.tsx` (mocks calqués sur `ClubReserve.persport.test.tsx` — monte le vrai ClubNav) : avec porte-monnaie + abonnement + quotas,

- la rangée `data-testid="balances-row"` avec classe `sp-scroll-x` est rendue ;
- la valeur d'abonnement complète « padel · h. creuses » est présente ;
- « cette semaine » apparaît **deux fois** (une par jauge, inline) — discriminant vs l'ancien mode compact (une occurrence centrée).

## Évolution (même jour) — quotas seuls

Décision user : le porte-monnaie/carnets et la chip « Abonné » sont **retirés de la rangée** — ces informations vivent déjà dans le menu profil (`ProfileMenu` : chip Abonné + soldes prépayés du club courant), pas de doublon sur Réserver. La rangée ne garde que les **jauges heures pleines / heures creuses** (`<QuotaStatus inline />`), condition d'affichage = `quotaStatus` seul. Effet de bord bienvenu : 2 pastilles au lieu de 4 → tout tient sans scroll dès ~600px (le débordement desktop de la v1 disparaît). `myPackages`/`mySubs` restent **chargés** par la page (BookingModal : « payer avec mon solde », couverture abo). Tests mis à jour : quotas seuls dans la rangée, porte-monnaie/Abonné absents du rendu, rangée absente sans quota même avec des soldes.
