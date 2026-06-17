# Validation par champ du formulaire Ressources — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sur `/admin/courts`, valider les champs d'une ressource côté front avant l'appel API et afficher un message précis sous le champ fautif (texte rouge + bord rouge), à la création et à l'édition en ligne du tableau.

**Architecture:** Un helper pur `lib/resourceValidation.ts` (miroir exact des règles de `backend/src/services/resource.service.ts`) est la source de vérité. Le composant `app/admin/courts/page.tsx` l'appelle au moment du « Créer » et du « Enregistrer les modifications », stocke les erreurs par champ (création) et par ligne (tableau), et les rend inline. Le backend reste inchangé (filet de sécurité).

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Jest (tests du helper pur). Aucune migration, aucune route.

Spec : `docs/superpowers/specs/2026-06-17-validation-ressources-par-champ-design.md`

---

## File Structure

- **Create:** `frontend/lib/resourceValidation.ts` — helper pur + types.
- **Create:** `frontend/__tests__/resourceValidation.test.ts` — tests unitaires du helper.
- **Modify:** `frontend/app/admin/courts/page.tsx` — câblage création + tableau, rendu inline.

---

## Task 1: Helper pur de validation (TDD)

**Files:**
- Create: `frontend/lib/resourceValidation.ts`
- Test: `frontend/__tests__/resourceValidation.test.ts`

- [ ] **Step 1: Write the failing test**

Créer `frontend/__tests__/resourceValidation.test.ts` :

```ts
import { validateResourceFields } from '@/lib/resourceValidation';

const valid = {
  name: 'Terrain 11',
  price: '52',
  offPeakPrice: '38',
  openHour: '9',
  closeHour: '22',
  slotStepMin: '90',
};

describe('validateResourceFields', () => {
  it('renvoie un objet vide quand tout est valide', () => {
    expect(validateResourceFields(valid)).toEqual({});
  });

  it('le cas de la capture (Ouv. 9 / Ferm. 0) signale closeHour', () => {
    const errs = validateResourceFields({ ...valid, openHour: '9', closeHour: '0' });
    expect(errs.closeHour).toBeTruthy();
    expect(errs.openHour).toBeUndefined();
  });

  it('accepte une fermeture à 24 (fin de journée)', () => {
    expect(validateResourceFields({ ...valid, closeHour: '24' }).closeHour).toBeUndefined();
  });

  it('refuse ouverture == fermeture', () => {
    expect(validateResourceFields({ ...valid, openHour: '10', closeHour: '10' }).closeHour).toBeTruthy();
  });

  it('refuse un nom vide', () => {
    expect(validateResourceFields({ ...valid, name: '   ' }).name).toBeTruthy();
  });

  it('refuse un tarif plein <= 0 ou vide', () => {
    expect(validateResourceFields({ ...valid, price: '0' }).price).toBeTruthy();
    expect(validateResourceFields({ ...valid, price: '' }).price).toBeTruthy();
  });

  it('tarif creux vide est valide, 0 invalide', () => {
    expect(validateResourceFields({ ...valid, offPeakPrice: '' }).offPeakPrice).toBeUndefined();
    expect(validateResourceFields({ ...valid, offPeakPrice: null }).offPeakPrice).toBeUndefined();
    expect(validateResourceFields({ ...valid, offPeakPrice: '0' }).offPeakPrice).toBeTruthy();
  });

  it('refuse une ouverture hors bornes', () => {
    expect(validateResourceFields({ ...valid, openHour: '-1' }).openHour).toBeTruthy();
    expect(validateResourceFields({ ...valid, openHour: '25' }).openHour).toBeTruthy();
  });

  it('créneau: vide valide, 30 valide, 20 invalide', () => {
    expect(validateResourceFields({ ...valid, slotStepMin: '' }).slotStepMin).toBeUndefined();
    expect(validateResourceFields({ ...valid, slotStepMin: '30' }).slotStepMin).toBeUndefined();
    expect(validateResourceFields({ ...valid, slotStepMin: '20' }).slotStepMin).toBeTruthy();
  });

  it('accepte des entrées numériques (pas seulement string)', () => {
    expect(validateResourceFields({ ...valid, price: 52, openHour: 9, closeHour: 22 })).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx jest __tests__/resourceValidation.test.ts`
Expected: FAIL — `Cannot find module '@/lib/resourceValidation'`.

- [ ] **Step 3: Write minimal implementation**

Créer `frontend/lib/resourceValidation.ts` :

```ts
export type ResourceFieldKey =
  | 'name' | 'price' | 'offPeakPrice' | 'openHour' | 'closeHour' | 'slotStepMin';

export type ResourceFieldErrors = Partial<Record<ResourceFieldKey, string>>;

export interface ResourceFieldInput {
  name: string;
  price: string | number;
  offPeakPrice?: string | number | null;
  openHour: string | number;
  closeHour: string | number;
  slotStepMin?: string | number | null;
}

const MSG: Record<ResourceFieldKey, string> = {
  name: 'Le nom est requis.',
  price: 'Le tarif plein doit être supérieur à 0.',
  offPeakPrice: 'Le tarif creux doit être supérieur à 0.',
  openHour: "L'ouverture doit être un entier entre 0 et 24.",
  closeHour: 'La fermeture doit être après l\'ouverture.',
  slotStepMin: 'Le créneau doit être un multiple de 15.',
};

/** '' / null / undefined => null (champ vide). Sinon le nombre, ou null si non numérique. */
function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isNaN(v) ? null : v;
  const s = v.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

function isBlank(v: string | number | null | undefined): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/** Miroir exact de validateHoursAndPrice / validateOffPeak / validateSlotStep du backend. */
export function validateResourceFields(input: ResourceFieldInput): ResourceFieldErrors {
  const errors: ResourceFieldErrors = {};

  if (!input.name.trim()) errors.name = MSG.name;

  const price = toNum(input.price);
  if (price === null || price <= 0) errors.price = MSG.price;

  if (!isBlank(input.offPeakPrice)) {
    const off = toNum(input.offPeakPrice);
    if (off === null || off <= 0) errors.offPeakPrice = MSG.offPeakPrice;
  }

  const open = toNum(input.openHour);
  const close = toNum(input.closeHour);

  const openValid = open !== null && Number.isInteger(open) && open >= 0 && open <= 24;
  if (!openValid) errors.openHour = MSG.openHour;

  const closeInBounds = close !== null && Number.isInteger(close) && close >= 0 && close <= 24;
  // open >= close est invalide (backend) ; on ne compare que si l'ouverture est elle-même valide.
  const ordering = openValid && closeInBounds ? (open as number) >= (close as number) : false;
  if (!closeInBounds || ordering) errors.closeHour = MSG.closeHour;

  if (!isBlank(input.slotStepMin)) {
    const step = toNum(input.slotStepMin);
    if (step === null || !Number.isInteger(step) || step < 15 || step > 240 || step % 15 !== 0) {
      errors.slotStepMin = MSG.slotStepMin;
    }
  }

  return errors;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx jest __tests__/resourceValidation.test.ts`
Expected: PASS (toutes les assertions).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/resourceValidation.ts frontend/__tests__/resourceValidation.test.ts
git commit -m "feat(courts): helper pur de validation des champs ressource"
```

---

## Task 2: Câblage du formulaire de création (erreurs inline)

**Files:**
- Modify: `frontend/app/admin/courts/page.tsx`

- [ ] **Step 1: Importer le helper, ACCENTS et ajouter l'état + styles**

En haut du fichier, à côté des imports existants, ajouter :

```ts
import { ACCENTS } from '@/lib/theme';
import { validateResourceFields, ResourceFieldErrors, ResourceFieldKey } from '@/lib/resourceValidation';
```

Dans le composant, après `const [creating, setCreating] = useState(false);` (ligne ~24), ajouter :

```ts
  const [createErrors, setCreateErrors] = useState<ResourceFieldErrors>({});
```

Après la définition de `label` (ligne ~31), ajouter les styles d'erreur :

```ts
  const errText: CSSProperties = { color: ACCENTS.coral, fontSize: 11.5, fontWeight: 600, fontFamily: th.fontUI, marginTop: 2 };
  const errBorder = (on?: string): CSSProperties => (on ? { borderColor: ACCENTS.coral } : {});
```

- [ ] **Step 2: Ajouter le clear d'erreur création et valider dans `create()`**

Avant la fonction `create` (ligne ~133), ajouter le helper de nettoyage :

```ts
  const clearCreateErr = (k: ResourceFieldKey) =>
    setCreateErrors((e) => { if (!e[k]) return e; const n = { ...e }; delete n[k]; return n; });
```

Dans `create`, remplacer le début :

```ts
  const create = async () => {
    if (!token || !clubId || !nr.clubSportId) return;
    setCreating(true);
```

par :

```ts
  const create = async () => {
    if (!token || !clubId || !nr.clubSportId) return;
    const errs = validateResourceFields(nr);
    if (Object.keys(errs).length > 0) { setCreateErrors(errs); return; }
    setCreateErrors({});
    setCreating(true);
```

- [ ] **Step 3: Câbler les onChange et le rendu inline des champs du formulaire**

Dans le bloc « Ajouter une ressource » (lignes ~254-297), pour chaque champ validé, (a) appeler `clearCreateErr` dans l'`onChange`, (b) ajouter `...errBorder(createErrors.<champ>)` au style de l'input, (c) afficher le message sous le champ.

Nom (ligne ~254) :

```tsx
          <label style={label}>Nom
            <input value={nr.name} onChange={(e) => { setNr({ ...nr, name: e.target.value }); clearCreateErr('name'); }} placeholder="Terrain 4" style={{ ...input, width: 170, ...errBorder(createErrors.name) }} />
            {createErrors.name && <span style={errText}>{createErrors.name}</span>}
          </label>
```

€ créneau plein (ligne ~280) :

```tsx
          <label style={label}>€ créneau plein
            <input type="number" min={1} step="0.5" value={nr.price} onChange={(e) => { setNr({ ...nr, price: e.target.value }); clearCreateErr('price'); }} style={{ ...input, width: 90, ...errBorder(createErrors.price) }} />
            {createErrors.price && <span style={errText}>{createErrors.price}</span>}
          </label>
```

€ créneau creux (ligne ~283) :

```tsx
          <label style={label}>€ créneau creux
            <input type="number" min={1} step="0.5" placeholder="—" value={nr.offPeakPrice} onChange={(e) => { setNr({ ...nr, offPeakPrice: e.target.value }); clearCreateErr('offPeakPrice'); }} style={{ ...input, width: 90, ...errBorder(createErrors.offPeakPrice) }} />
            {createErrors.offPeakPrice && <span style={errText}>{createErrors.offPeakPrice}</span>}
          </label>
```

Ouv. (ligne ~286) :

```tsx
          <label style={label}>Ouv.
            <input type="number" min={0} max={24} value={nr.openHour} onChange={(e) => { setNr({ ...nr, openHour: e.target.value }); clearCreateErr('openHour'); }} style={{ ...input, width: 60, ...errBorder(createErrors.openHour) }} />
            {createErrors.openHour && <span style={errText}>{createErrors.openHour}</span>}
          </label>
```

Ferm. (ligne ~289) :

```tsx
          <label style={label}>Ferm.
            <input type="number" min={0} max={24} value={nr.closeHour} onChange={(e) => { setNr({ ...nr, closeHour: e.target.value }); clearCreateErr('closeHour'); }} style={{ ...input, width: 60, ...errBorder(createErrors.closeHour) }} />
            {createErrors.closeHour && <span style={errText}>{createErrors.closeHour}</span>}
          </label>
```

> Le champ « Créneau » est un `<select>` à options fixes (jamais invalide) : pas de câblage nécessaire.

- [ ] **Step 4: Retirer le mapping en dur du message générique (devenu inatteignable) tout en gardant un repli**

Dans le `catch` de `create` (lignes ~147-149), remplacer :

```ts
    } catch (e) {
      const msg = (e as Error).message === 'VALIDATION_ERROR' ? 'champs invalides (tarif > 0, ouverture < fermeture, créneau multiple de 15)' : (e as Error).message;
      setError(`Création : ${msg}`);
    } finally { setCreating(false); }
```

par :

```ts
    } catch (e) {
      setError(`Création : ${(e as Error).message}`);
    } finally { setCreating(false); }
```

- [ ] **Step 5: Vérifier la compilation des types**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/admin/courts/page.tsx
git commit -m "feat(courts): erreurs de validation inline à la création d'une ressource"
```

---

## Task 3: Câblage de l'édition en ligne du tableau (erreurs par ligne)

**Files:**
- Modify: `frontend/app/admin/courts/page.tsx`

- [ ] **Step 1: Ajouter l'état des erreurs par ligne et le clear par cellule**

Après `const [createErrors, setCreateErrors] = useState<ResourceFieldErrors>({});` (ajouté en Task 2), ajouter :

```ts
  const [rowErrors, setRowErrors] = useState<Record<string, ResourceFieldErrors>>({});
```

Après le helper `markDirty` (ligne ~51), ajouter :

```ts
  const clearRowErr = (id: string, k: ResourceFieldKey) =>
    setRowErrors((m) => {
      const e = m[id];
      if (!e || !e[k]) return m;
      const ne = { ...e }; delete ne[k];
      return { ...m, [id]: ne };
    });
```

- [ ] **Step 2: Effacer l'erreur de la cellule lors de l'édition**

Dans `editField` (ligne ~53), ajouter le clear (le champ a le même nom que la clé) :

```ts
  const editField = (id: string, field: 'name' | 'price' | 'offPeakPrice' | 'openHour' | 'closeHour', value: string) => {
    setResources((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    markDirty(id);
    clearRowErr(id, field);
  };
```

Dans `editStep` (ligne ~76), ajouter :

```ts
  const editStep = (id: string, value: string) => {
    setResources((prev) => prev.map((r) => (r.id === id ? { ...r, slotStepMin: value === '' ? null : Number(value) } : r)));
    markDirty(id);
    clearRowErr(id, 'slotStepMin');
  };
```

- [ ] **Step 3: Valider chaque ligne dirty avant la sauvegarde dans `saveAll`**

Dans `saveAll` (ligne ~84), remplacer :

```ts
    const toSave = resources.filter((r) => dirty.has(r.id));
    if (toSave.some((r) => !r.name.trim())) { setError('Le nom d\'un terrain ne peut pas être vide.'); return; }
    setSaving(true);
```

par :

```ts
    const toSave = resources.filter((r) => dirty.has(r.id));
    const errsByRow: Record<string, ResourceFieldErrors> = {};
    for (const r of toSave) {
      const e = validateResourceFields({
        name: r.name, price: r.price, offPeakPrice: r.offPeakPrice,
        openHour: r.openHour, closeHour: r.closeHour, slotStepMin: r.slotStepMin,
      });
      if (Object.keys(e).length) errsByRow[r.id] = e;
    }
    if (Object.keys(errsByRow).length) {
      setRowErrors(errsByRow);
      setError('Corrigez les champs en rouge avant d\'enregistrer.');
      return;
    }
    setRowErrors({});
    setSaving(true);
```

- [ ] **Step 4: Rendu inline des erreurs dans les cellules du tableau**

Dans le `<tbody>`, pour chaque cellule éditable, ajouter `...errBorder(rowErrors[r.id]?.<champ>)` au style de l'input et un message sous l'input.

Cellule Nom (ligne ~191) :

```tsx
                  <td style={cell}>
                    <input value={r.name} onChange={(e) => editField(r.id, 'name', e.target.value)} placeholder="Nom du terrain" style={{ ...input, width: 200, fontWeight: 600, ...errBorder(rowErrors[r.id]?.name) }} />
                    {rowErrors[r.id]?.name && <div style={errText}>{rowErrors[r.id]!.name}</div>}
                  </td>
```

Cellule € créneau plein (ligne ~222) :

```tsx
                  <td style={cell}>
                    <input type="number" min={1} step="0.5" value={r.price} onChange={(e) => editField(r.id, 'price', e.target.value)} style={{ ...input, width: 90, ...errBorder(rowErrors[r.id]?.price) }} />
                    {rowErrors[r.id]?.price && <div style={errText}>{rowErrors[r.id]!.price}</div>}
                  </td>
```

Cellule € créneau creux (ligne ~223) :

```tsx
                  <td style={cell}>
                    <input type="number" min={1} step="0.5" placeholder="—" value={r.offPeakPrice ?? ''} onChange={(e) => editField(r.id, 'offPeakPrice', e.target.value)} style={{ ...input, width: 90, ...errBorder(rowErrors[r.id]?.offPeakPrice) }} />
                    {rowErrors[r.id]?.offPeakPrice && <div style={errText}>{rowErrors[r.id]!.offPeakPrice}</div>}
                  </td>
```

Cellule Ouv. (ligne ~224) :

```tsx
                  <td style={cell}>
                    <input type="number" min={0} max={24} value={r.openHour} onChange={(e) => editField(r.id, 'openHour', e.target.value)} style={{ ...input, width: 60, ...errBorder(rowErrors[r.id]?.openHour) }} />
                    {rowErrors[r.id]?.openHour && <div style={errText}>{rowErrors[r.id]!.openHour}</div>}
                  </td>
```

Cellule Ferm. (ligne ~225) :

```tsx
                  <td style={cell}>
                    <input type="number" min={0} max={24} value={r.closeHour} onChange={(e) => editField(r.id, 'closeHour', e.target.value)} style={{ ...input, width: 60, ...errBorder(rowErrors[r.id]?.closeHour) }} />
                    {rowErrors[r.id]?.closeHour && <div style={errText}>{rowErrors[r.id]!.closeHour}</div>}
                  </td>
```

> La cellule « Créneau » est un `<select>` à options fixes : pas de câblage.

- [ ] **Step 5: Vérifier la compilation des types**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Lancer la suite de tests front pour non-régression**

Run: `cd frontend && npm test`
Expected: PASS (dont le nouveau `resourceValidation.test.ts`).

- [ ] **Step 7: Commit**

```bash
git add frontend/app/admin/courts/page.tsx
git commit -m "feat(courts): erreurs de validation inline à l'édition du tableau des ressources"
```

---

## Vérification manuelle finale

1. Démarrer le dev (`backend` puis `frontend`, cf. CLAUDE.md), se connecter en gérant, aller sur `/admin/courts`.
2. **Création** : Sport Padel, Nom « Terrain 11 », plein 52, creux 38, **Ouv. 09, Ferm. 00**, cliquer « Créer ».
   - Attendu : pas d'appel API ; message rouge **sous « Ferm. »** « La fermeture doit être après l'ouverture. » + bord rouge ; les autres champs sans erreur.
   - Corriger Ferm. → 24, l'erreur disparaît au changement, « Créer » fonctionne.
3. Tester un tarif plein à 0 → message sous « € créneau plein » ; tarif creux vide → accepté.
4. **Tableau** : éditer une ligne pour mettre Ferm. = Ouv., cliquer « Enregistrer les modifications ».
   - Attendu : sauvegarde bloquée, message rouge sous la cellule « Ferm. » de cette ligne, bandeau « Corrigez les champs en rouge avant d'enregistrer. » ; corriger fait disparaître l'erreur ; ré-enregistrer fonctionne.

---

## Self-Review (couverture spec)

- Helper pur miroir des règles backend → Task 1 (avec test du cas `Ouv.9/Ferm.0`, bornes, offPeak vide/0, step 30/20). ✅
- Affichage inline sous chaque champ (texte rouge + bord rouge) → `errText` / `errBorder`, Tasks 2 & 3. ✅
- Création : validation avant API, clear au changement, repli si erreur API inattendue → Task 2. ✅
- Édition tableau : validation par ligne, blocage tout-ou-rien, clear par cellule → Task 3. ✅
- Pas de backend, pas de migration → respecté (aucune tâche backend). ✅
