# Refonte de la page admin « Membres » — design

Date : 2026-07-08

## Problème

`/admin/members` est un tableau brut de 8 colonnes : édition inline cellule par cellule
avec un bouton « Enregistrer » sur chaque ligne, deux gros formulaires d'ajout empilés en bas
de page, scroll horizontal en mobile. C'est fonctionnel mais austère et peu « vivant » : le
gérant ne voit ni photo, ni niveau, ni signe d'activité de ses membres. Objectif : une refonte
**graphique et fonctionnelle** ambitieuse, sans régression de contrat (accès STAFF, gestion des
rôles réservée OWNER/ADMIN, ids d'API inchangés).

## Vision

Passer du **tableau** à une **liste riche façon carte + panneau d'édition latéral** (le pattern
déjà éprouvé sur `/admin/encaissement`). Chaque rangée devient une carte avec avatar, badges
et signaux d'activité ; cliquer ouvre un panneau (colonne collante en desktop, feuille plein
écran en mobile) qui porte toute l'édition. La page gagne un bandeau KPI, des filtres segmentés
à compteurs, un tri, un export CSV et un dialog d'ajout unifié.

## Enrichissement des données (backend, additif, aucune migration)

`ClubService.listMembers(clubId)` passe de 2 à ~7 requêtes **à plat** (indépendant du nombre de
membres — aucune requête par ligne) et expose, en plus des champs actuels :

- `avatarUrl` — élargissement du `select` user, **coût zéro** ;
- `hasActiveSubscription` + `subscriptionPlan` — 1 requête `subscription.findMany` (prédicat
  `status: 'ACTIVE', expiresAt > now`, miroir de `subscription.service.ts`) ;
- `hasActivePackage` — 1 requête `memberPackage.findMany` + logique `isUsable` (copiée de
  `memberStats.service.ts`) ;
- `level` (niveau padel) — `ratingService.getLevelsForUsers(userIds, 'padel')` (clé **fixe**,
  jamais de résolution de sport préféré par user = N+1), tolérant à l'absence de sport via
  `.catch(() => ({}))` ;
- `lastSeenAt` — dernière réservation **CONFIRMED passée** (organisateur OU participant), via un
  `$queryRaw` UNION, `null` si aucune.

Décision : les comptes **supprimés (RGPD)** sont exclus (`user: { deletedAt: null }`) — leurs
lignes anonymisées « Joueur supprimé » sont inertes et pollueraient KPI/CSV. Effet de bord assumé :
on ne peut plus supprimer une telle ligne depuis cette page (la ligne est déjà inerte).

Tous les nouveaux champs du DTO front (`Member`) sont **optionnels** → les fixtures et tests
existants continuent de compiler.

## Composition de la page

1. **Bandeau KPI** (même langage que le bandeau du jour de l'Encaissement) : Membres · Abonnés ·
   Actifs 30 j (dernière résa < 30 jours) · Bloqués.
2. **Toolbar** : recherche existante (multi-termes ET, insensible aux accents) + `Pill` segmentées
   à compteurs live (Tous / Abonnés / Staff / À surveiller / Bloqués) + tri (Nom A–Z / Plus récents
   = adhésion `since` desc / Dernière activité) + « Exporter CSV » + « + Ajouter un membre ».
3. **Liste de cartes** : avatar (photo ou initiales colorées `colorForSeed(userId)`), nom, chips
   (rôle staff Gérant/Admin/Staff, 👁 à surveiller, Abonné · {formule}, Carnet, Bloqué),
   sous-ligne email · tél · n° adhérent, à droite niveau + « Vu il y a N j » + chevron. Ligne
   bloquée atténuée.
4. **Panneau d'édition** (clic sur une carte) : header identité + lien « Voir la fiche complète → »
   (`/admin/members/[userId]`), champs éditables tél / n° adhérent / note + interrupteur Abonné +
   Enregistrer, actions Bloquer/Débloquer, Rôle… (réutilise `StaffRoleMenu`), Supprimer
   (`ConfirmDialog` + mapping d'erreurs staff existant). Colonne collante en desktop, overlay
   plein écran en mobile. Gating staff inchangé (OWNER/ADMIN, jamais soi-même ni le OWNER).
5. **Dialog « + Ajouter un membre »** : remplace les deux formulaires du bas — un dialog à 2 onglets
   (`Segmented`) « Compte existant » (ajout par email) / « Nouveau compte » (création, affiche le
   mot de passe temporaire dans le dialog).
6. **Export CSV** de la liste filtrée, côté client : BOM UTF-8 + séparateur `;` (Excel FR),
   booléens Oui/Non, dates JJ/MM/AAAA.

## Contrats préservés (invariants de tests)

Chaînes d'accessibilité conservées à l'identique : lien du nom « Voir le passif de {prénom nom} »
(→ fiche), badge `title="À surveiller"`, bouton « Rôle staff de {prénom nom} », options
`menuitemradio` du `StaffRoleMenu`, flux « Supprimer » + erreur `MEMBER_IS_STAFF`. Dualité d'ids
d'API inchangée : `adminUpdateMember`/`adminSetMemberBlocked`/`adminRemoveMember` prennent l'id
d'adhésion (`m.id`) ; `adminSetMemberStaffRole`/watch/history prennent `m.userId`.

## Hors périmètre

Pagination serveur, colonnes triables côté serveur, édition en masse, sélection multiple,
import CSV, envoi d'email au promu, activité 90 jours dans la liste (réservée au snapshot
billing). Aucun changement des routes.
