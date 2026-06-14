# Emails à la charte du site + email de validation brandé — spec

**Date** : 2026-06-14 · **Statut** : validé (maquettes approuvées : avec logo + heure de fin)

## Problème

- L'**email de validation** (code d'inscription) part en **texte brut** (`mailer.ts` n'utilise pas le gabarit) → « pas beau ».
- Le gabarit HTML existant (`templates/layout.ts` `renderLayout`, utilisé par les 6 notifications tournois/events) a une **couleur de marque périmée** `#d6ff3f` (vert lime) alors que le **site est passé au bleu** (`ACCENTS.blue = #5e93da`, dégradé hero `#5e93da`→`#2c4668`, fond papier `#f1eee5`).

Objectif : un **seul gabarit** cohérent avec le site, appliqué à **tous** les emails ; en-tête avec **logo** ; et afficher l'**heure de fin** du tournoi/event quand elle existe.

## Décisions (validées avec l'utilisateur)

1. **Charte = site** : marque Palova bleue `#5e93da` ; en-tête en **dégradé `linear-gradient(115deg, accent, #2c4668)`** (repli `bgcolor=accent` pour Outlook) ; fond papier `#f1eee5` ; encre `#181510`, libellés `#6d6a5d`.
2. **En-tête avec logo** : logo dans une **tuile blanche arrondie** (contraste sur le dégradé) + wordmark « Palova » (ou nom du club). Emails plateforme (validation) = logo Palova ; emails liés à un club = **logo + accent du club** (déjà supporté par `Brand`).
3. **Email de validation brandé** : passe par `renderLayout`, avec le **code à 6 chiffres en gros dans un cadre** (`#eef3fb`/`#d4e1f4`, chiffres `#2c4668` espacés), mention « expire dans 15 min ». **Repli texte conservé** (délivrabilité).
4. **Heure de fin** : le `dateLabel` des notifications inclut la fin quand `endTime` existe — même jour → « … à 14h00 → 18h00 » ; jour différent → « … → <date+heure de fin> ». `endTime` est nullable et déjà chargé.

## Architecture (surface minimale, dans `backend/src/email/`)

- **`links.ts`** : nouveau `formatDateRangeFr(start, end|null, tz)` (réutilise `formatDateFr`, Luxon `hasSame('day')`) ; nouveau `platformAsset(path)` → URL absolue côté domaine canonique (`https://<ROOT>/icon-192.png` en prod, `http://localhost:3000…` en dev) pour le logo Palova des emails.
- **`templates/layout.ts`** : `PALOVA_BRAND.accentColor = '#5e93da'` ; en-tête dégradé + tuile logo + wordmark ; fond papier + encres du site ; nouveau champ optionnel `LayoutInput.codeBlock?: { code; caption? }` rendant le cadre du code. Helpers `escapeHtml`/`readableTextOn` inchangés.
- **`templates/emails.ts`** : nouveau `buildVerificationEmail(code, brand)` → `BuiltEmail` (html via `renderLayout` + `codeBlock`, texte de repli). `buildPlayerEmail`/`buildOrganizerEmail` inchangés (ils reçoivent déjà `dateLabel` tout fait).
- **`mailer.ts`** : `sendVerificationEmail` construit `buildVerificationEmail(code, PALOVA_BRAND_WITH_LOGO)` et envoie **html + text** (au lieu du texte seul). Repli console dev conservé. `PALOVA_BRAND` complété d'un `logoUrl` = `platformAsset('/icon-192.png')`.
- **`notifications.ts`** : `dateLabel = formatDateRangeFr(startTime, endTime, tz)` pour tournois **et** events.

## Tests

- `links` : `formatDateRangeFr` (sans fin / même jour / jour différent).
- `templates/layout` : marque bleue, présence du dégradé + tuile logo, rendu `codeBlock`.
- `templates/emails` : `buildVerificationEmail` → html contient le code + sujet ; texte de repli présent.
- Mise à jour des tests existants qui asserteraient l'ancienne couleur `#d6ff3f`.

## Hors scope

Refonte du contenu des notifications (vocabulaire/actions inchangés) ; envoi d'emails nouveaux ; images embarquées en data-URI (le logo reste une **URL absolue**). Personnalisation par club au-delà de l'accent/logo déjà géré.
