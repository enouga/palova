# Prix des créneaux (vue cartes Réserver) — étiquette « sticker » heures creuses

**Date** : 2026-07-13 · **Statut** : validé (piste B retenue par Eric sur maquettes comparées dans le companion visuel)

## Contexte

Dans la vue cartes de la page Réserver (`frontend/components/ClubReserve.tsx`), les pilules d'heures
creuses embarquent leur prix inline (« 14h00 20€ », deux polices mélangées dans la pilule) — jugé pas
joli. Le plein tarif n'est affiché qu'une fois en tête de carte (« 25€ / créneau ») : seules les creuses
dévient du prix annoncé, d'où le prix sur ces seules pilules.

4 pistes comparées (prix sous l'heure partout / étiquette sticker / bandes tarifaires / légende à
points), chacune en clair + sombre, face à l'existant. **Piste B retenue : étiquette « sticker ».**

## Design retenu

- **Pilule réservable = l'heure seule** (mono 13, centrée) — le span prix inline et son `gap: 4` disparaissent.
- **Créneau creux réservable** : mini-étiquette posée sur le coin haut-droit de la pilule —
  `position: absolute; top: -7px; right: -4px`, fond plein `th.accentWarm`, encre `inkOn(th.accentWarm)`,
  `fontFamily: th.fontUI`, 9.5px / 800, `padding: 2px 7px`, `borderRadius: 999`,
  `boxShadow: 0 1px 3px rgba(0,0,0,.22)`. Contenu : `{Number(s.price)}€`.

```
        ╭─────────╮ [20€]   ← sticker apricot plein, à cheval sur le coin
        │  14h00  │
        ╰─────────╯
```

- La pilule bouton gagne `position: 'relative'` (le remplissage plein au survol `.rv-slot` passe sous le sticker).
- **Grille** : `gap: 8` → `columnGap: 8, rowGap: 12` (constant — le sticker ne chevauche pas la rangée du dessus).
- Sticker **uniquement sur les pilules réservables** : fantômes pris/passés et chip « ‹ N passés » inchangés.
- **En-tête de carte inchangé** : « 25€ / créneau » en gros + ligne apricot « 20€ en heures creuses ».
- `title="Heures creuses"` conservé. Thème sombre : mêmes couleurs.
- **Hors périmètre** : vue grille (`SportGrid`), BookingModal, planning admin.

## Vérification

Suites `ClubReserve.*` (aucune n'asserte le prix inline), `tsc --noEmit` scopé, vérif visuelle CDP
clair + sombre, desktop 1280 + mobile 390 (données : terrain avec `offPeakPrice` + plages creuses).
