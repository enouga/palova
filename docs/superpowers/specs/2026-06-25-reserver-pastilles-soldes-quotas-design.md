# Réserver — redesign des pastilles « soldes & quotas » (direction B)

**Date :** 2026-06-25
**Statut :** validé (mockups visuels, direction B affinée)

## Problème

Sur la page **Réserver**, la rangée d'infos du joueur (soldes prépayés + abonnement + quotas
de réservation) est rendue avec le composant générique `Chip` : trois pastilles plates,
grises ou coral, sans hiérarchie. « Porte-monnaie — 130,00 € » noie le montant dans le label ;
« Heures pleines 30/1 cette semaine » entasse label + ratio + suffixe dans une mini-pilule où
le `30/1` est illisible et où le seul signal d'alerte est un fond coral qui recouvre tout.

Jugé « pas très joli ». Objectif : une rangée **compacte** (on garde la forme « rangée de
pastilles » d'aujourd'hui) mais **lisible et soignée**, avec hiérarchie, icônes porteuses de sens
et jauge de quota.

## Direction retenue — « pastilles intelligentes » (B)

Chaque pastille devient une **`StatPill`** : une tuile-icône ronde teintée à gauche + un corps
à deux niveaux (petit label en capitales au-dessus, valeur en gras dessous). Les quotas
ajoutent une **mini-jauge** (track 50px) sous le label. La forme reste une pilule arrondie en
rangée `flex-wrap` — encombrement quasi identique à l'existant.

### Langage couleur (discipliné — pas d'arc-en-ciel)

| Élément          | Teinte tuile        | Sens                          |
|------------------|---------------------|-------------------------------|
| Porte-monnaie    | `ACCENTS.emerald`   | ton argent                    |
| Carnet           | `ACCENTS.emerald`   | ton crédit (entrées)          |
| Abonné           | `th.accent` (marque)| adhésion / premium            |
| Heures pleines / creuses (calme) | neutre (`th.surface2` / `th.textMute`) | compteur |
| Quota **au plafond** (`used >= limit`) | `ACCENTS.coral` | alerte douce |

La jauge se remplit en `th.accent` en temps normal, **coral** au plafond ; au plafond la
pastille gagne aussi un liseré coral et son icône passe coral. Icônes : `wallet`
(porte-monnaie), `ticket` (carnet), `check` (abonné), `sun` (heures pleines), `moon`
(heures creuses).

### Alignement maison

La tuile-icône suit **exactement** la convention `AgendaCard` :
`background = floodlit ? ${accent}24 : ${accent}40`, `icon color = floodlit ? accent : th.ink`.
La jauge suit la convention `AgendaCard` : `height 5`, `borderRadius 999`, track `th.surface2`,
remplissage `urgent ? ACCENTS.coral : th.accent`. Marche en thème clair **et** sombre (validé
en mockup dans les deux thèmes).

## Composants & contrats

### Nouveau : `frontend/components/ui/StatPill.tsx`

Composant **présentation pure** (source de vérité du look), client (`useTheme`).

```ts
interface StatPillProps {
  icon: IconName;
  accent?: string;        // teinte de la tuile ; absent = tuile neutre (compteur calme)
  label: string;          // petit label capitales ("Porte-monnaie", "Heures pleines"…)
  value?: ReactNode;      // mode simple : valeur en gras ("130,00 €", "Padel · h. creuses")
  meter?: { used: number; limit: number; suffix: string }; // mode jauge (quotas)
  warn?: boolean;         // au plafond → icône + jauge + liseré coral
}
```

- **Mode simple** (`value`) : tuile + label + valeur. Pas de jauge.
- **Mode jauge** (`meter`) : tuile + label + ligne `{used}/{limit}` (un **seul** nœud texte) +
  track (largeur `min(used/limit,1)·100%`) + `suffix` en `th.textFaint`.
- `warn` force tuile/icône/jauge en `ACCENTS.coral` et ajoute un liseré coral.
- Expose `data-warn={warn ? '1' : undefined}` pour les tests.

### Modifié : `frontend/components/ui/Icon.tsx`

Ajout d'un glyphe **`wallet`** à `IconName` + au `switch` (porte-monnaie ; `card`/`euro`
existants ne conviennent pas visuellement). `ticket`, `sun`, `moon`, `check` existent déjà.

### Modifié : `frontend/lib/packages.ts`

Ajout d'un helper **pur** `packageParts(p: MemberPackage)` →
`{ icon: 'wallet' | 'ticket', label: 'Porte-monnaie' | 'Carnet', value: string }`
(value = `7 entrées` / `130,00 €`, même formatage que `packageLabel`).
**`packageLabel` reste inchangé** (utilisé tel quel par `BookingModal` comme libellé de bouton).

### Modifié : `frontend/components/quota/QuotaStatus.tsx`

Réécrit pour rendre une `StatPill` par classe au lieu d'un `Chip` :
`sun`/`moon`, `meter={{ used, limit, suffix }}`, `warn = used >= limit`, teinte neutre.
**Props inchangées** (`status: MyQuotaStatus | null`). Comme `BookingModal` rend déjà
`<QuotaStatus>`, la modale de réservation est upgradée gratuitement.

**Contrat de texte préservé** (sinon casse `QuotaStatus.test.tsx`) : les nœuds texte exacts
restent `Heures pleines` / `Heures creuses` (label), `{used}/{limit}` en **un seul nœud**
(ex. `3/5`), et le suffixe **non abrégé** `cette semaine` (WEEKLY) / `à venir` (UPCOMING).

### Modifié : `frontend/components/ClubReserve.tsx`

La rangée actuelle (≈ lignes 182-191) qui mappe `myPackages`/`mySubs` en `Chip` passe à
`StatPill` :
- packages → `StatPill` via `packageParts(p)`, `accent = ACCENTS.emerald`.
- abonnements → `StatPill` `icon="check"`, `accent = th.accent`, `label="Abonné"`,
  `value = sportKeys.join('/') + (offPeakOnly ? ' · h. creuses' : '')`.

Retirer l'import `Chip` s'il devient inutilisé dans le fichier (à vérifier).

## Hors périmètre

- Aucun changement backend (les compteurs viennent déjà de `getMyQuotaStatus`).
- Pas de nouvelle donnée, pas de migration.
- Les autres usages de `Chip` ailleurs dans l'app ne changent pas.
- `BookingModal` n'est pas édité directement (il hérite du nouveau `QuotaStatus` ; sa ligne
  `packageLabel(p)` reste un libellé de bouton, inchangée).

## Tests

- **`packages.test.ts`** : ajout d'un bloc `packageParts` (carnet 1/7 entrées, porte-monnaie €).
  Les tests `packageLabel` existants restent verts.
- **`QuotaStatus.test.tsx`** : reste vert tel quel (contrat de texte préservé). Ajout d'un cas
  « au plafond → `data-warn` » et « sous le plafond → pas de `data-warn` ».
- **Nouveau `StatPill.test.tsx`** : mode simple (label + value, pas de jauge), mode jauge
  (ratio en un nœud, suffixe), `warn` (présence `data-warn`), largeur de jauge plafonnée à 100 %
  quand `used > limit`.

## Fichiers touchés (récap)

1. `frontend/components/ui/Icon.tsx` — glyphe `wallet`.
2. `frontend/components/ui/StatPill.tsx` — **nouveau** composant partagé.
3. `frontend/lib/packages.ts` — helper pur `packageParts`.
4. `frontend/components/quota/QuotaStatus.tsx` — réécrit sur `StatPill`.
5. `frontend/components/ClubReserve.tsx` — rangée soldes/abonnements sur `StatPill`.
6. Tests : `packages.test.ts`, `QuotaStatus.test.tsx`, `StatPill.test.tsx`.
