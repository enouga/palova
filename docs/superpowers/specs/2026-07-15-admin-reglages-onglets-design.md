# Réglages du club — onglets, barre sticky, contrôles polis

**Date** : 2026-07-15
**Statut** : validé par Eric (brainstorming avec maquettes comparées dans le companion visuel)

## Problème

La page `/admin/settings` empile 11 cartes sur ~4 écrans de scroll, avec un seul bouton
« Enregistrer » tout en bas — invisible sans scroller, aucun signal de modifications en
attente. Elle fait par ailleurs doublon avec le wizard d'onboarding (« guide de
démarrage »), qui modifie les mêmes réglages (logo/couleur/thème, fenêtres de
réservation, délais, visibilité annuaire).

**Décision de cadrage** : Réglages devient **LA référence complète** ; le wizard reste un
simple raccourci guidé de démarrage et **ne change pas**. Le chantier couvre la
réorganisation (onglets + barre sticky) **et** la modernisation des contrôles à
l'intérieur des cartes. 100 % frontend, aucun changement backend, aucune migration.

## 1. Structure — 5 onglets

- URL et entrée nav inchangées (`/admin/settings`, « Réglages »).
- Rangée d'onglets en pills : **Identité · Réservation · Tarifs & quotas ·
  Caisse & paiement · Visibilité & joueurs**.
- Onglet actif reflété dans l'URL `?tab=` via `history.replaceState` (pattern `/events`) ;
  deep-linkable. Défaut = Identité (`?tab=` absent).
  Clés : `identite`, `reservation`, `tarifs`, `caisse`, `visibilite`.
- Mobile : rangée scrollable horizontalement (pattern `.sp-scroll-x`), jamais de
  débordement du viewport.

## 2. Répartition des 11 sections actuelles

| Onglet | Sections (contenu actuel conservé) |
|---|---|
| Identité | Profil (nom, description, adresse, ville, fuseau) · Identité visuelle (logo, couverture, couleur d'accent, thème par défaut) |
| Réservation | Réservation à l'avance (fenêtres public/abonnés, mode d'ouverture, heures de release) · Délais (annulation, changement de joueurs, remboursement auto) |
| Tarifs & quotas | Heures pleines/creuses · Quotas de réservation (dépendants des plages creuses → côte à côte) |
| Caisse & paiement | Paiement au club (1 clic) · Moyens d'encaissement rapides · carte-lien « Paiement en ligne » → `/admin/payments` |
| Visibilité & joueurs | Annuaire public · calendrier national · offres sur le Club-house · Système de niveau · Page « Mes réservations » (autres clubs) |

## 3. Barre sticky d'enregistrement

- **Un seul brouillon global** couvrant tous les onglets — changer d'onglet ne perd rien.
- Dès qu'un champ diffère de l'état serveur chargé (dirty check), une **barre sombre
  sticky en bas** apparaît : « ● Modifications non enregistrées · Annuler · Enregistrer ».
- **Annuler** = reset du brouillon au dernier état serveur.
- **Enregistrer** = le PATCH global existant (`api.adminUpdateClub`, body inchangé) puis
  `refreshClub()` (ClubProvider) comme aujourd'hui.
- Succès → la barre affiche brièvement « Enregistré ✓ » puis disparaît. Erreur → message
  d'erreur dans la barre (elle reste visible, le brouillon est conservé).
- Garde `beforeunload` (confirm navigateur) tant que le brouillon est dirty.
- **Nuance uploads** : logo et couverture sont déjà persistés côté serveur dès l'upload
  (comportement conservé) → ils ne rendent PAS le brouillon dirty. Seule la remise à
  null de la couverture (« Utiliser l'illustration automatique ») passe par le brouillon.

## 4. Contrôles polis

- **Presets en chips + « Autre… »** (champ numérique révélé) :
  - fenêtres de réservation : public 7/14/30 j, abonnés 14/28/60 j (mêmes valeurs que
    `BOOKING_PRESETS` du wizard) ;
  - délais annulation & changement de joueurs : Jusqu'au début / 4 h / 24 h
    (`CANCEL_PRESETS`).
  - Une valeur existante hors presets sélectionne automatiquement « Autre… ».
- **Mode d'ouverture** (`bookingReleaseMode`) : chips segmentées 3 options au lieu du
  select ; heures de release en stepper −/+ (désactivées en ROLLING_SLOT, comme
  aujourd'hui).
- **Interrupteurs** (switch) à la place des cases à cocher : annuaire, national, offres
  publiques, niveau, autres clubs, remboursement auto, paiement au club.
- **Moyens d'encaissement rapides** : chips multi-sélection (ordre canonique
  `QUICK_METHODS` conservé) ; masqués quand « Paiement au club » est actif (inchangé).
- **Heures creuses** : par jour, chips « 9h00 → 12h00 × » + bouton « + plage » ouvrant
  une petite feuille (pattern `MatchAlertSheet`) avec deux `TimePicker` maison De/À —
  remplace les 4 selects par plage. Suppression = « × » sur la chip. Le résultat vit
  dans le brouillon global (persisté par Enregistrer, pas à la fermeture de la feuille).
- **Thème par défaut** : segmenté Clair/Sombre au lieu du select.
- Palette de couleur d'accent inchangée ; fuseau horaire reste un champ texte.

## 5. Articulation avec le guide de démarrage

- Wizard `/admin/onboarding` : **aucun changement**.
- Checklist du dashboard : la ligne « Logo & couleur » pointe vers
  `/admin/settings?tab=identite` (deep-link sur l'onglet Identité). Rien d'autre.

## 6. Architecture & tests

- `app/admin/settings/page.tsx` (487 lignes) éclaté :
  - la page = orchestrateur (chargement, brouillon global, onglets, SaveBar) ;
  - composants par onglet `components/admin/settings/{SettingsIdentity,SettingsBooking,
    SettingsPricing,SettingsCollect,SettingsVisibility}.tsx` (props : brouillon + setter) ;
  - `components/admin/settings/SaveBar.tsx` ;
  - contrôles partagés : `PresetChips`, `SwitchRow`, éditeur de plages creuses
    (feuille + chips).
- Helpers purs testés `lib/adminSettings.ts` : construction du body de PATCH /
  comparaison dirty (`buildUpdateBody`, `isDirty`), presets, libellé de chip de plage
  (`offPeakChipLabel`), défs d'onglets (`SETTINGS_TABS`).
- **Backend : aucun changement. Aucune migration.** Le PATCH existant couvre déjà tous
  les champs.
- Tests : `__tests__/adminSettings.test.ts` (helpers purs) +
  `__tests__/AdminSettings.test.tsx` (onglets + URL, barre dirty/Annuler/Enregistrer,
  erreur dans la barre, presets ↔ « Autre… », feuille heures creuses, deep-link `?tab=`,
  interrupteurs) ; suites existantes vertes.
- Vérification visuelle CDP clair + sombre, desktop 1280 + mobile 390 (aucun scroll
  horizontal ; barre sticky au-dessus du contenu, visible dans les deux thèmes).

## Hors périmètre

- La page `/admin/payments` (Stripe Connect) — la carte-lien suffit.
- Le contenu/les étapes du wizard d'onboarding.
- Un select de fuseau horaire.
- Auto-save par champ (rejeté au profit de la barre sticky).
