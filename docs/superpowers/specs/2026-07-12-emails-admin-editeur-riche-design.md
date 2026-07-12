# Emails admin : éditeur riche WYSIWYG + gabarit « Éditorial épuré » — Design

**Date** : 2026-07-12
**Statut** : validé par Eric (brainstorming avec companion visuel : éditeur « complet + photos », direction graphique « 3 · Éditorial épuré », accès Staff, TipTap)

## Problème

La personnalisation des emails (`/admin/emails`, 18 types) demande aujourd'hui d'éditer un
**textarea « Corps (HTML) »** en monospace et d'insérer des variables `{{prenom}}` : trop
technique pour un gérant/staff de club. Par ailleurs le gabarit HTML des emails envoyés
(`backend/src/email/templates/layout.ts`) est daté : en-tête dégradé générique, fond beige,
pas de vrai pied de page (ni coordonnées du club, ni lien de gestion des notifications).

## Décisions (validées)

1. **Éditeur riche WYSIWYG (TipTap)** — l'admin formate directement le texte, ne voit jamais de HTML.
2. **Barre d'outils complète + photos** : gras, italique, souligné, listes, lien, couleur du
   texte, alignement, sous-titres (h2/h3), insertion d'images dans le corps.
3. **Variables = jetons insécables lisibles** (« Prénom » au lieu de `{{prenom}}`), menu
   « ＠ Insérer une info » avec libellé + exemple.
4. **Gabarit d'email redessiné, direction « Éditorial épuré »** (maquette validée) : liseré
   couleur club, logo + nom centrés en petites capitales, titre serif centré, bouton pill
   sombre, pied de page complet (coordonnées club, « Gérer mes notifications », « Envoyé avec
   Palova »).
5. **Accès élargi** : rôles OWNER/ADMIN/**STAFF** (aujourd'hui OWNER/ADMIN seulement).
6. **Stockage inchangé** : le format persisté reste le HTML avec placeholders `{{clé}}`
   (`ClubEmailTemplate`), aucune migration.

## 1. Éditeur (frontend, `/admin/emails/[type]`)

### Composant `components/admin/email/RichEmailEditor.tsx` (TipTap)

- Extensions : StarterKit (paragraphes, gras, italique, listes, heading limité à h2/h3),
  Underline, Link, TextAlign (p + headings), TextStyle + Color, Image.
- **Jeton de variable** : node TipTap custom `emailVar`, inline + atomique (`atom: true`),
  attribut `data-var="<clé>"`, rendu chip (fond bleu clair, libellé français depuis
  `detail.vars`). Insécable : se supprime d'un coup, ne peut pas être scindé ni édité.
- **Menu « ＠ Insérer une info »** : dropdown listant les variables de l'email courant
  (libellé + exemple, ex. « Prénom — ex. Marie ») ; insertion au curseur.
- **Objet / Titre / Libellé du bouton** : mêmes jetons mais instances TipTap **une ligne**
  (Document custom `content: 'block'`, Enter désactivé, aucune marque de formatage, pas de
  barre d'outils — seulement le menu d'insertion de variable).
- **Toolbar** : boutons du design system (th.*), état actif visible, désactivée pendant le
  chargement.

### Conversion `{{clé}}` ↔ jetons — `frontend/lib/emailTokens.ts` (helpers purs, testés)

- `htmlToEditor(html, vars)` : remplace chaque `{{clé}}` déclarée par
  `<span data-var="clé"></span>` (clé inconnue → laissée en texte brut, visible).
- `editorToHtml(html)` : remplace chaque `<span data-var="clé">…</span>` par `{{clé}}`.
- Appliqués au chargement (défaut ou override → éditeur) et à l'enregistrement / preview
  (éditeur → API). **Le backend continue de recevoir exactement le même format qu'aujourd'hui.**
- **Champs d'une ligne** (Objet, Titre, Libellé du bouton) : le format stocké est du **texte
  brut** avec `{{clé}}` (pas de HTML) — sérialisation dédiée texte ↔ doc TipTap (les jetons
  redeviennent `{{clé}}`, tout balisage est ignoré à la sortie).

### Photos dans le corps

- Bouton 🖼 de la toolbar → sélecteur de fichier → **upload immédiat** vers la nouvelle route
  admin (cf. §4) → insertion `<img src="/uploads/email-images/…">` au curseur.
- Échec d'upload → message d'erreur inline, rien n'est inséré.
- Aperçu dans l'éditeur : image affichée à largeur max 100 %.

### Page éditeur

- Deux colonnes ≥ 900 px (édition / aperçu sticky), une colonne en mobile.
- L'aperçu serveur débouncé (iframe `srcDoc` sandbox) est conservé, avec une **bascule
  mobile/desktop** (largeur d'iframe 600 px / 380 px).
- Boutons conservés : Enregistrer, Envoyer un test, Réinitialiser (+ message unknownVars).
- En-tête : lien retour, titre, description, badge Personnalisé/Défaut.

## 2. Accès Staff

- Backend : toutes les routes emails (`GET/PUT/DELETE /api/clubs/:clubId/admin/emails[/:type]`,
  `POST …/preview`, `POST …/test`, + la nouvelle route d'upload) passent de
  `requireClubMember('ADMIN')` à **`requireClubMember('STAFF')`**.
- Frontend : vérifier que l'entrée « Emails » de la sidebar `/admin` est visible pour un STAFF
  (elle l'est si la nav n'est pas gatée par rôle — sinon dé-gater cette entrée).

## 3. Gabarit « Éditorial épuré » (backend, `templates/layout.ts`)

Réécriture de `renderLayout` — toujours **tables + CSS inline**, `color-scheme: light only`,
600 px max, preheader conservé. Structure de haut en bas :

1. **Liseré** 5 px pleine largeur, couleur `brand.accentColor`.
2. **En-tête centré** : logo (tuile arrondie ~30 px ; repli = tuile encre avec l'initiale) +
   nom du club en Helvetica 13 px bold, `letter-spacing` ~1.5 px, MAJUSCULES.
3. **Titre (heading)** : Georgia/serif ~26 px, centré, encre `#181d26`.
4. **Corps (introHtml)** : Helvetica 15 px / 1.65, `#4a5261`, **aligné à gauche** (le corps est
   du contenu admin : listes et paragraphes doivent rester lisibles ; l'admin peut centrer via
   la barre d'outils). Styles emails pour `h2/h3` (serif), `ul/ol`, `a` (couleur accent),
   `img` (largeur max 100 %, coins arrondis), `blockquote` (filet gauche).
5. **codeBlock** (emails plateforme code de validation) : restylé accordé (fond neutre froid,
   code mono, hairlines) — l'API `LayoutInput` ne change pas.
6. **infoRows** : bloc entre filets fins (`border-top/bottom` 1 px), label gris à gauche,
   valeur bold à droite.
7. **CTA** : pill sombre `#181d26`, `border-radius: 999px`, texte blanc, centré. (L'accent du
   club vit dans le liseré et les liens — décision de la direction 3.)
8. **footerNote** : petit texte gris centré.
9. **Pied de page** : centré, petites tailles —
   `Nom du club · adresse · téléphone · email` (champs disponibles seulement),
   lien **« Gérer mes notifications »** → `https://<slug>.<domaine>/me/profile`,
   ligne **« Envoyé avec Palova »**. Emails plateforme (brand Palova) : pied réduit
   (« Envoyé par Palova » + baseline).

### Extension `Brand`

`Brand` gagne des champs **optionnels** : `address?`, `phone?`, `email?`, `manageUrl?`
(URL « Gérer mes notifications » construite via `links.ts`). `brandFromClub` accepte les
champs supplémentaires (`address`, `city`, `contactPhone`, `contactEmail`, `slug`) ; les deux
callsites qui chargent le brand (`notifications.ts`, `emailTemplate.service.loadBrand`)
élargissent leur `select`. Champs absents → lignes omises (jamais de « null »).

### Défauts du registre

Les 18 défauts (`EMAIL_DEFS[].defaults`) gardent leurs textes ; seuls les défauts portant des
styles inline datés (encadrés gris `background:#f4f4f5` des emails chat/DM/litige) sont
réaccordés au nouveau langage (blockquote à filet). Objets par défaut inchangés.

## 4. Backend — sanitisation & upload

- **`sanitizeBodyHtml`** (registry.ts) : allowlist actuelle **+ `img`** avec attributs
  `src` (http/https **ou** chemin relatif commençant par `/uploads/`), `alt`. Toute autre
  source est retirée. `blockquote` déjà autorisé.
- **Absolutisation** : au rendu (`renderClubEmail`), passe finale qui convertit les
  `src="/uploads/…"` en URL absolues (réutilise `absoluteAsset` de `links.ts`) et injecte le
  style images (`max-width:100%;height:auto;border-radius:12px`).
- **`htmlToText`** : inchangé (les `<img>` sont déjà retirées ; pas de texte alt requis).
- **Nouvelle route** `POST /api/clubs/:clubId/admin/emails/images`
  (`requireClubMember('STAFF')`) : multer memoryStorage, 5 Mo max, JPEG/PNG/WebP, écrit
  `uploads/email-images/<clubId>-<ts>.<ext>` (même pattern que les affiches d'annonces),
  renvoie `{ url }` relatif. Pas de garbage-collection des images orphelines en v1.
- `EmailTemplateService.upsert` : limite `bodyHtml` relevée à **20 000** caractères (les
  balises img allongent le HTML) ; reste inchangé.

## 5. Liste `/admin/emails` (face-lift léger)

- Icône par groupe (tuile teintée, icônes existantes de `Icon.tsx`), badge « Personnalisé »
  en pill accent, description « envoyé quand… » conservée.
- Aucune restructuration (groupes et ordre inchangés).

## 6. Sécurité

- La **sanitisation serveur reste la barrière** : quel que soit ce que l'éditeur produit ou ce
  qu'un client hostile POSTe, `sanitizeBodyHtml` filtre (allowlist balises/styles/schemes,
  `img` restreinte). Les valeurs de variables restent HTML-échappées à la substitution.
- L'aperçu reste rendu dans une `<iframe sandbox>`.
- L'upload d'image est authentifié, scopé club, types/poids bornés.

## 7. Tests

- **Front** : `emailTokens.test.ts` (round-trip `{{clé}}` ↔ jetons, clé inconnue, imbrication
  dans du HTML formaté) ; `AdminEmailEditor` adapté (TipTap monté en jsdom si praticable,
  sinon mock du composant éditeur : chargement défaut/override, insertion de variable,
  enregistrement convertit en `{{clé}}`, upload d'image inséré, bascule d'aperçu) ;
  `AdminEmails` (badges/groupes).
- **Back** : `layout` (liseré, en-tête centré, CTA pill, pied de page avec/sans coordonnées,
  manageUrl), `registry` (sanitisation img : `/uploads/` accepté, `http(s)` accepté,
  `javascript:`/autres retirés ; absolutisation au rendu), routes emails accessibles en STAFF
  (403 avant → 200), route upload (type/poids/écriture).
- Suites existantes `registry`/`emailTemplate.service`/`admin.emails.routes`/
  `notifications.*` : adaptées au nouveau layout (assertions de structure, pas de snapshots
  byte-à-byte).

## Hors périmètre (v1)

- Récupération/GC des images d'email orphelines.
- Éditeur par blocs déplaçables (type Mailchimp), édition du HTML brut.
- Multilingue, désactivation d'un email, WYSIWYG pour les emails plateforme
  (validation/reset : gabarit seulement, contenu codé).
- Photo de bannière d'en-tête par email ou par club (le pied + liseré + logo suffisent en v1).

## Dépendances

- **TipTap** (`@tiptap/react`, `@tiptap/starter-kit` + extensions underline/link/text-align/
  color/text-style/image) — chargé uniquement par la page admin emails (import dynamique si le
  poids le justifie). Vérifier la compatibilité React 19/Next 16 au moment du plan et pinner
  les versions.

## Fichiers touchés (vue d'ensemble)

- `backend/src/email/templates/layout.ts` (réécriture gabarit + Brand étendu)
- `backend/src/email/registry.ts` (sanitize img, absolutisation, défauts réaccordés)
- `backend/src/email/links.ts` (URL « Gérer mes notifications » si absente)
- `backend/src/email/notifications.ts` + `backend/src/services/emailTemplate.service.ts`
  (selects du brand élargis, limite 20 000)
- `backend/src/routes/admin.ts` (minRole STAFF + route upload images)
- `frontend/lib/emailTokens.ts` (nouveau, pur)
- `frontend/components/admin/email/RichEmailEditor.tsx` (nouveau, TipTap)
- `frontend/components/admin/email/EmailPreview.tsx` (bascule mobile/desktop)
- `frontend/app/admin/emails/[type]/page.tsx` (intégration éditeur, layout 2 colonnes)
- `frontend/app/admin/emails/page.tsx` (face-lift)
- `frontend/lib/api.ts` (méthode upload image email)
