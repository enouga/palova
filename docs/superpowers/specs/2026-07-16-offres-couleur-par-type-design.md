# Offres — couleur par type, à plat (redesign couleurs)

**Date :** 2026-07-16
**Statut :** validé par Eric (maquettes comparées dans le companion visuel : 3 pistes A/B/C, puis 3 distributions de couleurs — « couleur par type » retenue)
**Périmètre :** 100 % frontend, aucune migration, aucun changement backend.

## Contexte

Eric aime la page `/admin/packages` refondue (vitrine miroir + studio, 2026-07-13) mais pas ses couleurs : le **lavis dégradé** en tête de carte déplaît, et les **teintes cyclées par position** (bleu, abricot, émeraude, violet, cyan — `OFFER_TINTS`/`offerAccent(index)`) donnent l'impression de couleurs « étrangères au reste du site », où la couleur est soit l'accent du club, soit porteuse de sens (statuts, tournois abricot / events cyan).

## Décision

La couleur d'une carte d'offre vient désormais de son **type**, plus de sa position :

| Type | Teinte | Valeur |
|------|--------|--------|
| Abonnement | `ACCENTS.blue` | `#5e93da` |
| Carnet (ENTRIES) | `ACCENTS.apricot` | `#ef9f6a` |
| Porte-monnaie (WALLET) | `ACCENTS.emerald` | `#34b27b` |

Deux offres du même type ont toujours la même couleur (couleur = sens, même logique que Tournois/Events dans l'admin). Le **lavis dégradé** en tête de carte est **supprimé partout**. Le reste de l'anatomie et ses formules de couleur sont **inchangés** : liseré (latéral admin / haut joueur), chip de type (`${tint}26`/`${tint}40` + encre selon le thème), pouls teinté, CTA outline joueur, estompage des cartes retirées (`isActive ? tint : th.textFaint`).

## Surfaces touchées (3)

1. **`/admin/packages`** — `components/admin/offers/OfferCard.tsx` : suppression du `<span>` dégradé (52 px) ; `app/admin/packages/page.tsx` passe `offerTint(...)` au lieu d'`offerAccent(i)`.
2. **Club-house** — `components/clubhouse/OffersShowcase.tsx` : suppression du dégradé (72 px) et du doublon local `OFFER_TINTS` ; tint par type importée. La carte admin reste le miroir exact de la carte joueur.
3. **Studio d'édition** — `components/admin/offers/OfferPreviewCard.tsx` (suppression du dégradé) + `OfferStudio.tsx` : la tint de l'aperçu suit le **type sélectionné** (chips ⚡/🎟/💰) au lieu de `previewIndex` — à la création, changer le type change la couleur de l'aperçu en direct.

## Implémentation

Dans `lib/adminOffers.ts` : `OFFER_TINTS` et `offerAccent(index)` sont **remplacés** par un helper pur :

```ts
export type OfferTintKind = 'SUBSCRIPTION' | 'ENTRIES' | 'WALLET';
export const offerTint = (kind: OfferTintKind): string =>
  kind === 'SUBSCRIPTION' ? ACCENTS.blue : kind === 'ENTRIES' ? ACCENTS.apricot : ACCENTS.emerald;
```

Importé par les 3 surfaces. Les teintes violet et cyan sortent des cartes d'offres (elles restent utilisées ailleurs dans le site).

## Tests

- `__tests__/adminOffers.test.ts` : `offerAccent` → `offerTint` (mapping des 3 types).
- Suites existantes `AdminPackages`/`OffersShowcase`/`OfferStudio` : restent vertes (pas d'assertion de couleur) ; adapter si un test référence `offerAccent`.
- Vérification visuelle CDP clair + sombre, desktop 1280 + mobile 390, sur `/admin/packages`, le Club-house (section Offres) et le studio (création avec changement de type).

## Hors périmètre

- Toute autre surface utilisant des teintes cyclées (agenda admin, calendrier, joueurs…).
- La modale de détail d'offre du Club-house (bandeau image, texte) — pas de tint décorative à changer.
- Backend, migrations, API.
