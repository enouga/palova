# Refonte visuelle « Mon profil » — carte de joueur brume bleue

**Date** : 2026-07-17
**Statut** : validé (direction B + champs « label intégré » choisies par Eric sur maquettes comparées dans le companion visuel : 3 pistes de direction, 3 anatomies de champs, puis maquette de synthèse approuvée)

## Contexte et problème

La page `/me/profile` vient de passer en 5 onglets + SaveBar (2026-07-17) mais garde le langage visuel « plat » d'origine : cartes à liseré `inset 0 0 0 1px`, titres de carte en petites capitales grises, inputs bruts sur `surface2`, préférences en `Segmented` Oui/Non, gros bouton « Changer la photo ». Le reste du site est passé au langage éditorial premium (ombres douces, heros brume bleue, pills pleines). Eric : « vraiment moche, je les veux magnifiques ».

**Périmètre choisi (option B du cadrage)** : reskin complet + haut de page repensé « en majesté ». La mécanique ne change pas : 5 onglets dans l'URL `?tab=`, double état `server`/`draft`, `buildProfileBody` source de vérité, SaveBar unique couvrant profil + licence, garde `beforeunload`. Aucun endpoint modifié côté flux d'enregistrement.

## Direction retenue

**« Carte de joueur — brume bleue »** : le haut de page devient un hero `HERO_GRADIENT` façon fiche tournoi où l'identité du joueur est mise en scène ; les formulaires passent en cartes à ombre douce avec des champs à **label intégré** (le label vit dans le bloc du champ, en petites capitales).

## 1. Le hero « carte de joueur »

Nouveau composant **`components/profile/ProfileHero.tsx`**, rendu par la page sous le `ClubNav` (hôte club) ou sous la rangée BackButton/ThemeToggle/ProfileMenu (hôte plateforme). Il **remplace** le titre « Mon profil » 38 px ET la carte « Identité » de l'onglet Identité (avatar + bouton photo + lignes readonly Prénom/Nom/Email) — ces informations vivent désormais dans le hero.

- **Fond** : `HERO_GRADIENT`, encres fixes `HERO_INK`/`HERO_INK_MUTED` (lisible dans les 2 thèmes, pattern établi — jamais de panneau sombre).
- **Kicker** petites capitales : nom du club (hôte club) ; « Palova » (hôte plateforme).
- **Avatar 80 px** : photo (`objectFit: cover`) ou initiales sur `th.accent` ; anneau blanc 3 px + ombre portée.
  - **Badge niveau** ancré bas-droite (encre `#181510`, texte lime `ACCENTS.lime`, ex. « 6.2 ») — affiché si `rating?.level != null` et `club?.levelSystemEnabled !== false`. Le rating padel est déjà chargé par la page (onglet Niveau) ; il est simplement passé au hero.
  - **Pastille 📷** ancrée bas-gauche (rond blanc, ombre) = déclencheur d'upload d'avatar (`fileRef` existant, `aria-label="Changer la photo"`) ; remplace le bouton « Changer la photo ». Pendant l'upload : avatar en opacité 0.5 (comportement conservé). Les erreurs de format/poids passent par le bandeau d'erreur existant.
- **Nom complet** en display (~26 px, letterSpacing −0.5) + **email** en dessous (encre muted). L'astuce « L'email ne peut pas être modifié » disparaît (plus aucun champ email visible).
- **Chips** (hôte club, membre seulement) : « ⚡ Abonné » (fond blanc translucide `rgba(255,255,255,0.78)`) si `membership.isSubscriber` ; « Membre depuis {année} » (fond encre translucide) depuis le nouveau champ `since` (cf. §6). Chips omises sur l'hôte plateforme ou si non-membre.
- **Onglets « dossier »** fondus dans le bas du hero : rangée horizontale (`.sp-scroll-x` si débordement mobile), onglet actif = fond `th.bg` (il se soude visuellement au fond de page), coins arrondis en haut seulement (`border-radius: 11px 11px 0 0`) ; inactifs = texte `HERO_INK_MUTED` sans fond. Ils remplacent les `PillTabs` de la page. Même liste dynamique qu'aujourd'hui (Niveau/Portefeuille conditionnels), même `changeTab` (URL `?tab=`).
- **Variante compacte** sur les onglets ≠ Identité : avatar 40 px (anneau 2 px, sans badge ni 📷), nom seul sur une ligne, pas d'email ni de chips — le hero reste présent (kicker + identité + onglets) mais léger. Prop `compact` dérivée de `activeTab !== 'identite'`.

## 2. Langage des cartes

Dans `components/profile/shared.ts` (`useProfileStyles`) :

- **`card`** : ombre douce au lieu du liseré — même recette que `cardStyle(th)` du Club-house (`0 14px 34px …` clair / ombre + `inset line` en floodlit), `borderRadius: 18`, padding 16–20.
- **`CardKicker`** (nouveau petit composant dans `shared.ts` ou fichier voisin) : tiret accent 16×3 px arrondi + libellé petites capitales `textFaint` (letterSpacing 1.2). Prop `tone: 'accent' | 'coral'` — coral réservé à la « Zone sensible » (suppression de compte). Remplace tous les `cardTitle` actuels.

## 3. Anatomie des champs — « label intégré »

Nouveaux primitifs dans **`components/profile/Field.tsx`** :

- **`FieldShell`** : bloc arrondi 13 px, fond `th.surface` (blanc en clair) avec bord `th.line` renforcé (`lineStrong` au besoin pour rester visible sur carte blanche), label en petites capitales 9.5–10 px `textFaint` posé en haut du bloc, contenu en dessous (14 px). **Focus** (état React `focus-within` via onFocus/onBlur — pas de CSS globale) : bord `1.5px th.accent` + halo `0 0 0 3px ${th.accent}29` + label qui passe accent.
- **`ProfileInput`** : `<input>` sans bordure propre dans un `FieldShell` (texte, password ; hérite des `aria-label` actuels — contrat de test conservé).
- **`ProfileSelect`** : `<select>` habillé pareil (Langue).
- **Choix courts DANS le champ** : Sexe = deux pills (`Homme`/`Femme`) dans un `FieldShell` — active = pleine `th.accent`/`onAccent`, inactive = `th.surface2`/`textMute`. (Pattern réutilisable si un autre choix court apparaît.)
- **`DateField`** existant : posé dans un `FieldShell` (label « Date de naissance »), `width: 100%`.

Placeholders réels (ex. licence : « Ex. 7512345 ») — le label ne double plus le placeholder.

## 4. Interrupteurs (préférences)

- **`SwitchRow` déménage** `components/admin/settings/` → **`components/ui/SwitchRow.tsx`** (même précédent que la SaveBar : une page joueur n'importe pas un composant d'admin). Importeurs admin mis à jour, sa suite de test aussi. Aucun changement d'API du composant.
- Les 4 préférences Oui/Non (`Segmented`) deviennent des **`SwitchRow`** (`role="switch"`, `aria-checked`) empilées avec **filets fins** entre lignes (`border-bottom: 1px solid th.line`, sauf la dernière) ; descriptions conservées comme sous-texte.

## 5. Contenu par onglet (après refonte)

- **Identité** : ~~carte Identité~~ (absorbée par le hero) ; **Sport préféré** (pills locales dans la carte, active accent — on ne restyle pas `PillTabs` globalement) ; **Informations** (Téléphone, Date de naissance, Sexe en `FieldShell`) ; **Licence** (si membre, kicker « Licence · {club} »).
- **Niveau** : mêmes composants internes (LevelBadge, courbe, calibrage…), simplement posés dans la nouvelle carte + kicker.
- **Préférences** : Langue en `ProfileSelect`, puis les 4 `SwitchRow` à filets.
- **Portefeuille** : les 3 sections gardent leurs composants internes (`WalletSection`, `PaymentMethodSection`, `PaymentsHistory`), nouvelles cartes + kickers.
- **Sécurité** : les 3 champs mot de passe en `ProfileInput` type password ; bouton « Modifier le mot de passe » en pill pleine accent ; carte « Supprimer mon compte » → kicker **coral « Zone sensible »**, le contenu `DeleteAccountSection` est **inchangé** (bouton, garde-fous et dialog existants — seule l'enveloppe carte + kicker change).
- **SaveBar** : strictement inchangée (partagée avec l'admin).
- Bandeau d'erreur haut (`error`) : style actuel conservé.

## 6. Backend — un seul ajout additif

`GET /api/clubs/:slug/me/membership` expose en plus **`since`** (ISO, = `ClubMembership.createdAt`) pour la chip « Membre depuis {année} ». Type front `MyClubMembership.since?: string` (optionnel, convention des champs additifs). Aucune migration (colonne existante). Test de route ajusté.

## 7. Thème sombre

Hero : inchangé par le thème (brume bleue + encres fixes). Onglet actif : fond `th.bg` → se soude au fond sombre. Cartes : recette floodlit de `cardStyle` (ombre + inset line). Champs : fond `th.surface2`, bords `th.line`/`lineStrong`, focus accent identique. Vérification visuelle CDP clair + sombre, desktop 1280 + mobile 390 (`mobile:false`, largeur fixe — piège d'émulation connu), hôte club ET hôte plateforme.

## 8. Tests

- **`MeProfile.test.tsx`** : adapter les assertions — les toggles passent de `Segmented` (boutons Oui/Non) à `role="switch"`/`aria-checked` ; le déclencheur photo devient la pastille (`aria-label="Changer la photo"`) ; les lignes readonly Prénom/Nom/Email disparaissent au profit du hero (asserter nom/email rendus dans le hero) ; aria-labels des inputs conservés (Téléphone, Date de naissance, Langue, mots de passe, licence).
- Nouvelle suite **`ProfileHero.test.tsx`** : kicker club vs Palova, badge niveau présent/absent (rating null, levelSystemEnabled false), chips Abonné/Membre depuis (et absentes si non-membre), onglets dynamiques + clic → onChange, variante compacte.
- Suite **`SwitchRow`** déplacée avec le composant ; importeurs admin (`AdminSettings` etc.) verts sans modification de comportement.
- Backend : test du champ `since` dans la route membership.
- `npx tsc --noEmit` (gate de types séparée de jest).

## Hors périmètre

- Restyle global de `PillTabs`, `Segmented`, `SaveBar`, `DateField`/`TimePicker` (composants partagés — intacts).
- Refonte des dialogs internes (`DeleteAccountSection` : confirmation existante conservée ; `PaymentMethodSection` : contenu inchangé).
- Toute évolution fonctionnelle (champs nouveaux, édition du nom, etc.).
- La page `/me/friends`, `/me/reservations`, le `ProfileMenu` (autres surfaces).
