# Emails automatiques personnalisables par club (admin) — Design

**Date :** 2026-07-01
**Statut :** Spec validée, prête pour le plan d'implémentation

## Problème / Intention

Aujourd'hui, les ~17 emails transactionnels du club (inscriptions, organisateur,
parties ouvertes, matchs, remboursement) sont **codés en dur** dans
`backend/src/email/templates/emails.ts`. Un club ne peut ni modifier le texte, ni
le HTML, ni l'objet de ces emails.

On veut que **chaque club personnalise, depuis `/admin`, le contenu de chacun de
ses emails automatiques**, en pouvant écrire du **HTML** dans le corps, avec
**plusieurs gabarits types** (un par type d'email).

### Décisions de cadrage (validées)

1. **Périmètre** = les emails **automatiques** (déclenchés par le système), pas une
   bibliothèque de campagnes manuelles. Le *broadcast* admin existant
   (`BroadcastService`) reste inchangé et hors périmètre.
2. **Qui édite** = **chaque club**, ses propres emails, depuis `/admin`. Les emails
   **plateforme** (code de validation, reset mot de passe) restent fixes (identité
   Palova) et **hors périmètre**.
3. **Modèle d'édition** = **champs dans le gabarit de marque**. On conserve
   l'en-tête/pied/bouton de marque (`renderLayout`, robuste sur tous les clients
   mail). Le club édite par email : **Objet, Titre, Corps (HTML autorisé), Libellé
   du bouton**. La rangée d'infos structurée (Date, Club, Terrain…) et l'en-tête/pied
   restent **automatiques**. Variables `{{prenom}}`, `{{activite}}`, `{{date}}`,
   `{{lien}}`…
4. **Regroupement par action sémantique** : un même email décliné aujourd'hui en
   *tournoi / événement / cours* via du vocabulaire codé devient **un seul gabarit**
   avec une variable `{{activite}}` (+ `{{type_activite}}`).
5. **Repli** : un gabarit non personnalisé → **défaut codé** (comportement actuel).
   Aucun club n'est forcé d'écrire 17 gabarits.
6. **Canal email seulement** : la customisation n'affecte **que l'email**. Le texte
   de la **cloche in-app** (`title`/`body` passés à `dispatch`) reste tel quel.

## Architecture retenue : registre de définitions

> Alternatives écartées : (B) surcharge en bordure en gardant les `buildXxx` — les
> défauts et surcharges divergent, on duplique quand même le registre de variables ;
> (C) ne rendre éditables que 4-5 emails — contredit « tous les envois ».

Chaque type d'email devient une **définition de données**. Un **seul** moteur de
rendu applique l'éventuelle surcharge du club. L'éditeur admin lit le même registre
(liste des champs + variables disponibles).

### 1. Modèle de données

Nouvelle table **`ClubEmailTemplate`** (migration **additive**) :

| Champ | Type | Note |
|---|---|---|
| `id` | String PK (cuid) | |
| `clubId` | String, FK `Club` (onDelete: Cascade) | |
| `type` | String | clé stable de l'email (cf. catalogue) |
| `subject` | String | peut contenir des `{{variables}}` |
| `heading` | String | le Titre |
| `bodyHtml` | String (`@db.Text`) | HTML **assaini** + `{{variables}}` |
| `ctaLabel` | String? | `null` → libellé par défaut de la définition |
| `footerNote` | String? | optionnel |
| `createdAt` | DateTime @default(now()) | |
| `updatedAt` | DateTime @updatedAt | |

`@@unique([clubId, type])`. **Aucune ligne pour un (club, type) = repli sur le
défaut codé.**

> **Migration** : additive, appliquée **en dev via SQL additif + `prisma migrate
> deploy`** (pas `migrate dev` — dérive de base connue, cf. mémoire projet) ; en prod
> `prisma migrate deploy`. SQL : `CREATE TABLE` + index unique `(clubId, type)`.

### 2. Registre des définitions — `backend/src/email/registry.ts`

```ts
interface EmailVar { key: string; label: string; sample: string; }

interface EmailDef {
  type: string;                         // 'registration.confirmed'
  group: 'inscriptions' | 'organisateur' | 'parties' | 'matchs' | 'paiement';
  title: string;                        // libellé admin "Inscription confirmée"
  description: string;                  // quand c'est envoyé
  vars: EmailVar[];                     // variables + valeurs d'exemple (aperçu)
  defaults: {
    subject: string;
    heading: string;
    bodyHtml: string;
    ctaLabel?: string;
    footerNote?: string;
  };
  infoRows?: (v: Record<string, string>) => InfoRow[];  // rangée structurée AUTO
  hasCta: boolean;
}

export const EMAIL_DEFS: Record<string, EmailDef> = { /* … */ };
```

Les **chaînes par défaut actuelles** (subject/heading/body des `buildXxx`)
**deviennent** les `defaults` du registre, à l'identique → les subjects restent
inchangés et les tests existants restent verts (sauf cas améliorés, cf. catalogue).

### 3. Moteur de rendu unique

```ts
function renderClubEmail(
  type: string,
  vars: Record<string, string>,
  brand: Brand,
  override?: ClubEmailTemplate | null,
): BuiltEmail;     // { subject, html, text }
```

Étapes :
1. `def = EMAIL_DEFS[type]`.
2. Par champ : `override?.champ ?? def.defaults.champ`.
3. **Substitution** `{{key}}` :
   - dans `subject` / `heading` / `footerNote` / `text` : valeur **brute** (texte) ;
   - dans `bodyHtml` : valeur **HTML-échappée** (un nom avec `<` ne casse rien) ;
   - placeholder **inconnu** (`{{xyz}}` non déclaré) → **retiré** (chaîne vide).
4. **Assainissement** du `bodyHtml` (allowlist, cf. §6).
5. `renderLayout({ brand, heading, introHtml: bodyHtml, infoRows: def.infoRows?.(vars) ?? [], ctaLabel, ctaUrl: vars.lien, footerNote, preheader: subject })`.
6. `text` = strip des balises du corps substitué + lignes `label : value` des
   infoRows + `ctaLabel : lien`.

### 4. Intégration dans `notifications.ts`

`notifications.ts` calcule déjà toutes les données (`prenom`, `activite`,
`dateLabel`, `url`…). Pour chaque fonction `notifyXxx` :
1. charger **une fois** la surcharge du type : `const override = await
   emailTemplateService.getOverride(clubId, type)` ;
2. par destinataire, construire l'objet `vars` (les mêmes valeurs qu'aujourd'hui) et
   appeler `renderClubEmail(type, vars, brand, override)` au lieu de
   `buildXxxEmail({...})`.

C'est le gros du travail, mais **mécanique** : on remplace des appels de builders par
des objets `vars`. Les `buildXxx` de `emails.ts` sont **supprimés** au profit des
`defaults` du registre (ou conservés comme helpers internes au registre). Les envois
restent **best-effort** (`safeNotify` inchangé) : un rendu fautif ne casse jamais
l'action métier.

> Les builders **plateforme** (`buildVerificationEmail`, `buildPasswordResetEmail`)
> restent **inchangés** dans `emails.ts` (hors périmètre).

## Catalogue des gabarits (clés `type`)

| Clé `type` | Groupe | Quand | Variables principales |
|---|---|---|---|
| `registration.confirmed` | inscriptions | inscription validée (tournoi/event/cours) | prenom, activite, type_activite, club, date, lien, coequipier? |
| `registration.waitlisted` | inscriptions | mise en liste d'attente | …+ position_attente |
| `registration.cancelled` | inscriptions | désinscription par le joueur | prenom, activite, type_activite, club, date, lien |
| `registration.promoted` | inscriptions | place libérée → confirmé | prenom, activite, type_activite, club, date, lien |
| `activity.cancelled_by_club` | inscriptions | activité annulée par le club | prenom, activite, type_activite, club, date, lien |
| `organizer.registration` | organisateur | nouvelle inscription (→ staff) | prenom, joueurs, statut, nb_inscrits, activite, lien |
| `organizer.cancellation` | organisateur | désinscription (→ staff) | prenom, joueurs, activite, lien |
| `open_match.joined` | parties | un joueur rejoint (→ orga) | prenom, joueur, terrain, date, club, places_restantes, lien |
| `open_match.added` | parties | ajouté à une partie (partenaire / rattachement club) | prenom, par?, terrain, date, club, lien |
| `open_match.removed` | parties | retiré d'une partie | prenom, terrain, date, club, lien |
| `open_match.left` | parties | un joueur quitte (→ orga) | prenom, joueur, terrain, date, club, places_restantes, lien |
| `open_match.proposed` | parties | partie « à ton niveau » | prenom, terrain, date, club, niveau, places_restantes, lien |
| `open_match.message` | parties | nouveau message de chat | prenom, auteur, terrain, message, club, lien |
| `match.pending_confirmation` | matchs | confirme le résultat | prenom, auteur, score, lien |
| `match.disputed` | matchs | résultat **contesté** (1er message) | prenom, auteur, score, extrait, lien |
| `match.comment` | matchs | nouveau message sur litige | prenom, auteur, score, extrait, lien |
| `payment.refunded` | paiement | remboursement auto | prenom, terrain, date, club, montant, support_solde, lien |

Notes :
- `open_match.added` fusionne les 3 usages actuels de `buildMatchInviteEmail`
  (partenaire invité, ajout par l'orga, rattachement caisse) — `par` vaut le nom de
  l'organisateur ou est vide (rattachement club).
- `match.disputed` vs `match.comment` séparent les 2 états de
  `buildMatchCommentEmail` (formulation très différente).
- `activity.cancelled_by_club` reçoit son **propre objet** (« Activité annulée — … »)
  au lieu de réutiliser le gabarit « Désinscription confirmée » (amélioration).
- `payment.refunded` : `support_solde` = «  sur votre solde (carnet / porte-monnaie) »
  ou chaîne vide (cas Stripe), pour garder une seule formulation paramétrable.

## 5. Interface admin `/admin/emails`

- **Entrée « Emails »** dans la nav `/admin`.
- **Liste** groupée (Inscriptions / Organisateur / Parties / Matchs / Paiement).
  Chaque ligne : titre + description + badge **« Personnalisé »** (surcharge existante)
  ou **« Défaut »**.
- **Éditeur** `/admin/emails/[type]` :
  - Champs **Objet · Titre · Corps (textarea HTML brut) · Libellé du bouton**
    (champs masqués si `hasCta=false`).
  - **Chips de variables** disponibles (`{{prenom}}`…), insertion au curseur dans le
    champ actif.
  - **Aperçu live** : rendu **côté serveur** (mêmes assainissement + `renderLayout`
    que l'envoi réel), avec les **valeurs d'exemple** de la définition, dans une
    `<iframe srcDoc>` (débounce à la frappe).
  - **Envoyer un test** : envoie le rendu (valeurs d'exemple) à l'adresse de l'admin
    connecté.
  - **Réinitialiser** : supprime la surcharge → retour au défaut.
- Corps en **textarea HTML brut + aperçu** (pas de WYSIWYG en v1).

### Routes (admin, `requireClubAdmin`)

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/clubs/:clubId/admin/emails` | liste `{ type, group, title, description, customized }` |
| `GET` | `/api/clubs/:clubId/admin/emails/:type` | `{ def: { vars, defaults, hasCta }, override \| null }` |
| `PUT` | `/api/clubs/:clubId/admin/emails/:type` | upsert (valide + assainit) |
| `DELETE` | `/api/clubs/:clubId/admin/emails/:type` | supprime la surcharge (réinitialise) |
| `POST` | `/api/clubs/:clubId/admin/emails/:type/preview` | corps = brouillon `{subject,heading,bodyHtml,ctaLabel,footerNote}` → `{ subject, html }` |
| `POST` | `/api/clubs/:clubId/admin/emails/:type/test` | corps = brouillon → envoie un test à l'admin |

Service **`EmailTemplateService`** : `listForAdmin(clubId)`, `getForAdmin(clubId,
type)`, `upsert(clubId, type, draft)`, `remove(clubId, type)`, `renderPreview(type,
draft, brand)`, `sendTest(type, draft, brand, toEmail)`, et `getOverride(clubId,
type)` (consommé par `notifications.ts`). `type` inconnu → 404 `EMAIL_TYPE_UNKNOWN`.

`preview`/`test` opèrent sur le **brouillon** (non sauvegardé) → l'aperçu et le test
reflètent la frappe en cours.

## 6. Sécurité / robustesse

- **Assainissement** du corps via **`sanitize-html`** (nouvelle dépendance backend),
  allowlist serrée :
  - balises : `p, br, strong, b, em, i, u, a, ul, ol, li, span, h2, h3, blockquote` ;
  - attributs : `a[href]` (schemes `http`/`https`/`mailto` only), `style` sur
    `span`/`p`/`h2`/`h3` limité à `color, font-weight, font-style, text-align,
    text-decoration` ;
  - tout le reste (`script`, `style`, `iframe`, `on*`…) **supprimé**.
  - Assaini **à la sauvegarde** (stocké propre) et **au rendu** (défense en
    profondeur). Les `defaults` du registre sont de confiance (déjà sûrs).
- Valeurs de variables **HTML-échappées** avant injection dans le corps.
- **Validation à la sauvegarde** : `subject`, `heading`, `bodyHtml` non vides ;
  longueurs bornées (objet ≤ 200, titre ≤ 200, corps ≤ 10 000). Placeholders inconnus
  **signalés** (réponse `unknownVars: string[]`) mais **non bloquants**.

## 7. Hors périmètre (YAGNI)

- HTML brut « document complet » (on garde le gabarit de marque).
- Désactiver/couper un email transactionnel (les préférences par **canal** existent
  déjà côté utilisateur).
- Multilingue : **FR seul** en v1 (le champ `User.locale` existe mais l'UI reste FR).
- Éditeur WYSIWYG (textarea HTML + aperçu suffit).
- Emails **plateforme** (validation, reset mot de passe).
- Bibliothèque de **modèles de campagne** réutilisables (lecture B écartée).
- Édition de la rangée d'infos / en-tête / pied / styles du bouton.

## 8. Tests

**Backend**
- `registry.test.ts` : chaque `def.defaults` ne référence que des `vars` déclarées ;
  `renderClubEmail` substitue correctement (subject/heading/body) ; valeurs
  HTML-échappées dans le corps ; placeholder inconnu retiré ; assainissement strip les
  balises interdites ; génération du `text` ; **repli** sur défaut quand `override`
  null ; subjects par défaut **identiques** à l'existant.
- `emailTemplate.service.test.ts` : `upsert` assainit + valide (vides refusés) ;
  `remove` supprime ; `getOverride` lit la bonne ligne ; `renderPreview`/`sendTest`
  utilisent les valeurs d'exemple ; `type` inconnu → erreur.
- routes admin : garde `requireClubAdmin`, CRUD, preview, test (mock `sendMail`).
- Adapter les suites email existantes (`emails.test.ts`,
  `notifications.*.test.ts`) au nouveau moteur — assertions de subject/contenu
  conservées via les défauts.

**Frontend**
- `AdminEmails.test.tsx` : liste groupée, badge Personnalisé/Défaut.
- `AdminEmailEditor.test.tsx` : édition, insertion de variable, aperçu (mock route),
  envoi de test, réinitialiser.
- Types `lib/api.ts` (`AdminEmailSummary`, `AdminEmailDetail`, méthodes) + entrée nav
  admin.

## 9. Fichiers touchés (indicatif)

**Backend**
- `prisma/schema.prisma` (+ migration `add_club_email_templates`).
- `src/email/registry.ts` (**nouveau** — défs + `renderClubEmail`).
- `src/email/templates/emails.ts` (retrait des builders club, conservation
  plateforme).
- `src/services/emailTemplate.service.ts` (**nouveau**).
- `src/email/notifications.ts` (bascule sur `renderClubEmail` + `getOverride`).
- `src/routes/admin.ts` (routes emails).
- dépendance `sanitize-html` (+ `@types/sanitize-html`).

**Frontend**
- `app/admin/emails/page.tsx`, `app/admin/emails/[type]/page.tsx`.
- `components/admin/email/*` (liste, éditeur, chips variables, aperçu iframe).
- `lib/api.ts` (types + méthodes), nav `/admin`.
