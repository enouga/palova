# Profil — onglets en tuiles icône + libellé & libellés hors des champs

**Date** : 2026-07-19
**Statut** : validé par Eric (maquettes comparées dans le companion visuel)
**Périmètre** : 100 % frontend, aucune migration, aucun changement backend.

## Problème

Deux irritants signalés sur `/me/profile` (rendu réel, mobile et desktop) :

1. **Les onglets « dossier » du hero ne marchent pas en mobile.** La rangée
   (Identité · Niveau · Préférences · Portefeuille · Sécurité) déborde à 390px :
   scroll horizontal invisible, onglet actif tronqué (« Sécur »), texte inactif
   jugé peu lisible sur le dégradé. Les correctifs de contraste du 2026-07-18
   (encre pleine + `scrollIntoView`) n'ont pas suffi — le pattern lui-même est
   en cause.
2. **Les libellés vivent DANS les champs** (pattern « label intégré » de
   `FieldShell`). Eric n'en veut pas : le libellé doit être au-dessus du champ.

## Décisions (choix sur maquettes)

Trois pistes d'onglets comparées (A tuiles icône+libellé façon barre du club /
B pills qui wrappent façon Réglages admin / C barre segmentée « actif étendu ») :
**A retenue, appliquée partout — mobile ET desktop** (souhait explicite d'Eric,
pas de variante desktop conservant les onglets dossier).

Deux traitements de libellé hors du champ comparés (petites capitales grises de
la convention `Field` d'atoms.tsx / encre pleine casse normale) : **petites
capitales retenues** (choix 1) — cohérence avec les pages d'inscription prime,
la sortie du champ suffit à régler la lisibilité.

## 1. Onglets → pills icône + libellé (`components/profile/ProfileHero.tsx`)

Chaque onglet devient **icône + libellé**, icônes existantes d'`Icon.tsx`
(aucune icône nouvelle) :

| Onglet | Icône |
|---|---|
| Identité | `user` |
| Niveau | `chart` |
| Préférences | `settings` |
| Portefeuille | `wallet` |
| Sécurité | `lock` |

- **Desktop** : pills horizontales (icône ~17px à gauche du libellé 13.5px,
  radius 999, padding ~9px 16px). Actif = pill pleine `th.accent`, encre
  `inkOn(th.accent)`, ombre portée teintée. Inactifs = fond **blanc translucide
  `rgba(255,255,255,0.45)`** (chip « verre », se détache du dégradé) + encre
  fixe `HERO_INK`.
- **Mobile (≤ 600px, même breakpoint que ClubNav)** : les mêmes pills passent
  en **colonnes** — icône (~20-22px) au-dessus du libellé (~10.5px), `flex:1`
  sur chaque tuile → les 5 onglets tiennent TOUJOURS dans la largeur, sans
  scroll ni troncature, quel que soit le nombre d'onglets dynamiques (3 sur
  l'hôte plateforme, 4-5 sur un hôte club). Actif = pill accent radius 13 ;
  inactifs = transparents, encre `HERO_INK`.
- **Libellés courts sur mobile** (validés en maquette) : « Préférences » →
  **« Préfs »**, « Portefeuille » → **« Solde »** ; Identité, Niveau, Sécurité
  inchangés. Même technique double-span que ClubNav (`.cn-lbl-full`/`.cn-lbl-short`) :
  les deux spans sont rendus, la bascule est CSS pure.
- **Bascule responsive en CSS pur** : classes dédiées dans `globals.css`
  (préfixe `ph-` p.ex.), média query `max-width: 600px` — pas de
  `useIsDesktop`, pas de flash d'hydration. ⚠️ Piège connu : un `globals.css`
  édité pendant que Turbopack tourne peut rester périmé → `start.ps1` après
  l'ajout des classes.
- **Le hero se referme** : `borderRadius: 18` sur les quatre coins,
  padding bas restauré, la rangée d'onglets vit à l'intérieur du hero (fondue
  dans le bas du dégradé). L'artifice « onglet soudé au fond de page »
  (`background: th.bg` sur l'actif, coins bas carrés) disparaît — et avec lui
  le cas piégeux du thème sombre (l'actif accent est lisible dans les deux
  thèmes via `inkOn`).
- **Nettoyage** : `sp-scroll-x`, `scrollerRef`, `activeTabRef` et l'effet
  `scrollIntoView` ajoutés le 2026-07-18 sont **supprimés** (plus rien ne
  déborde). Les stubs `scrollIntoView` posés dans `ProfileHero.test.tsx` et
  `MeProfile.test.tsx` sont retirés.
- **Accessibilité / contrat de test** : chaque bouton d'onglet porte
  `aria-label` avec le **libellé complet** ; les spans peints (long + court)
  sont `aria-hidden`. Les tests ciblent `getByRole('button', { name: 'Préférences' })`
  comme aujourd'hui — contrat stable, insensible à la bascule CSS.
- La **variante compacte** (onglets ≠ Identité : avatar 40px, pas d'email/chips)
  est conservée telle quelle ; seule la rangée d'onglets change d'habillage.

## 2. Libellés hors des champs (`components/profile/ProfileFields.tsx`)

`FieldShell` est inversé — le libellé sort du bloc :

- **Libellé au-dessus** : petites capitales `12.5px`, `fontWeight 600`,
  `letterSpacing 0.4`, `textTransform: uppercase`, couleur **`th.textMute`**,
  `marginBottom ~7px` — la convention exacte du composant `Field` d'atoms.tsx
  (pages /login, /register, /clubs/new). Au focus, le libellé passe à
  `th.accent` (conservé).
- **Le champ devient une boîte propre** : fond `th.surface2`, radius 13,
  hauteur ~46px (padding vertical), bord fin `inset 0 0 0 1px th.lineStrong`,
  **focus = bord accent 1.5px + halo `th.accent29`** (mécanique actuelle
  conservée, seule la position du libellé change).
- **APIs inchangées** : `ProfileInput`, `ProfileSelect`, `PillChoice` gardent
  leurs props (`label`, `value`, `onChange`, `options`…) — les 5 onglets qui
  les consomment (`ProfileIdentity`, `ProfilePreferences`, `ProfileSecurity`)
  ne sont **pas touchés**.
- **`PillChoice`** (sexe, sport préféré) : libellé au-dessus + rangée de pills
  **nue** (plus de boîte `surface2` autour — les pills portent déjà leur fond).
- **A11y inchangée** : le champ garde son `aria-label`, le libellé peint reste
  `aria-hidden` (pas de double annonce) — le contrat `getByLabelText` des
  suites existantes tient tel quel.

## Ce que cette spec remplace

Les retouches du 2026-07-18 sur les mêmes fichiers (encre pleine des onglets
inactifs, `scrollIntoView`, libellés `th.text` dans `FieldShell`) sont des
correctifs d'attente **absorbés/remplacés** par ce redesign : les onglets
changent de pattern, les libellés sortent du champ en `textMute` (lisibles car
posés sur la carte blanche, plus dans la boîte beige).

## Tests

- `ProfileHero.test.tsx` : contrat `getByRole('button', { name })` conservé ;
  cas ajoutés — icône par onglet rendue, `aria-label` complet même quand le
  span court existe ; retrait du stub `scrollIntoView`.
- `ProfileFields.test.tsx` : libellés toujours trouvés (aria-label), structure
  boîte + libellé externe.
- `MeProfile.test.tsx` : doit rester vert sans modification de fond (retrait
  du stub `scrollIntoView` seulement).
- **Vérification visuelle CDP** : clair + sombre, desktop 1280 + mobile 390
  (`mobile:false` pour attraper un vrai débordement), hôte club (5 onglets)
  ET hôte plateforme (3 onglets), onglet actif = dernier (Sécurité) pour
  vérifier qu'il est entier à 390px.

## Hors périmètre

- Les autres surfaces à onglets (`/admin/settings`, fiche membre, Events) —
  elles gardent leurs `PillTabs`/`Segmented`.
- Le contenu des onglets du profil (mécanique brouillon/SaveBar, champs,
  sections) — strictement inchangé.
- Toute évolution backend.
