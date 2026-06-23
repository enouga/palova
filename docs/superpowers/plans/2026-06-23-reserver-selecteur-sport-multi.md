# Réserver : sélecteur de sport discret + multi-sports + défaut préféré — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sur la page Réserver, remplacer la rangée de pastilles de sport par un lien discret « Padel, Tennis · changer » ouvrant une liste à cocher (multi-sports), avec défaut = sport préféré sans saut et mémorisation par club.

**Architecture :** 100 % frontend. Un nouveau composant `SportPicker` (lien résumé + panneau de cases à cocher, garde ≥1). `ClubReserve.tsx` passe d'une sélection mono (`selectedSportId: string`) à multi (`selectedSportIds: string[]`), résout le défaut proprement (localStorage → sport préféré → 1ᵉʳ sport), persiste par club, et rend une section de grille par sport sélectionné. La disponibilité de tous les sports est **déjà** chargée (`reloadAll`) et la grille sait **déjà** rendre une section par sport — on élargit donc surtout l'affichage.

**Tech Stack :** Next.js 16 (client components), React 19, TypeScript, thème via `useTheme()`, `localStorage`, tests Jest + React Testing Library (jsdom).

**Spec :** `docs/superpowers/specs/2026-06-23-reserver-selecteur-sport-multi-design.md`
**Branche :** `feat/reserver-selecteur-sport-multi` (déjà créée, contient la spec).

---

## Structure des fichiers

- **Créer** `frontend/components/reserve/SportPicker.tsx` — le sélecteur discret (lien résumé + panneau à cocher, garde ≥1, fermeture clic-extérieur). Responsabilité unique.
- **Créer** `frontend/__tests__/SportPicker.test.tsx` — tests unitaires du composant.
- **Modifier** `frontend/components/ClubReserve.tsx` — état mono→multi, résolution du défaut, persistance, remplacement du sélecteur, grille multi-sections, lien profond.
- **Modifier** `frontend/__tests__/ClubReserve.persport.test.tsx` — adapter les tests qui dépendaient des pastilles `PillTabs`.

Commandes depuis `frontend/` :
```bash
cd "C:/Users/e.nougayrede/OneDrive - BAYARD PRESSE/IA/05_PERSO/RESERVE/palova/frontend"
```

---

### Task 1 : Composant `SportPicker`

Lien discret résumant la sélection (« Padel · changer », « Padel, Tennis · changer », « Padel +2 · changer ») qui ouvre un panneau de cases à cocher. Garde : au moins un sport reste coché. Fermeture au clic extérieur. Cocher conserve l'ordre fourni (= ordre du club).

**Files:**
- Create: `frontend/components/reserve/SportPicker.tsx`
- Test: `frontend/__tests__/SportPicker.test.tsx`

- [ ] **Step 1 : Écrire le test (échoue)**

Créer `frontend/__tests__/SportPicker.test.tsx` :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { SportPicker, SportOption } from '../components/reserve/SportPicker';
import { ThemeProvider } from '../lib/ThemeProvider';

const sports: SportOption[] = [
  { id: 'p', name: 'Padel', icon: null },
  { id: 't', name: 'Tennis', icon: null },
  { id: 's', name: 'Squash', icon: null },
];

function setup(selectedIds: string[]) {
  const onChange = jest.fn();
  render(<ThemeProvider><SportPicker sports={sports} selectedIds={selectedIds} onChange={onChange} /></ThemeProvider>);
  return onChange;
}

describe('SportPicker', () => {
  it('libellé : 1 sport', () => {
    setup(['p']);
    expect(screen.getByRole('button', { name: /Padel · changer/ })).toBeInTheDocument();
  });

  it('libellé : 2 sports (noms listés)', () => {
    setup(['p', 't']);
    expect(screen.getByRole('button', { name: /Padel, Tennis · changer/ })).toBeInTheDocument();
  });

  it('libellé : 3+ sports (+N)', () => {
    setup(['p', 't', 's']);
    expect(screen.getByRole('button', { name: /Padel \+2 · changer/ })).toBeInTheDocument();
  });

  it('ouvre le panneau et coche un sport → onChange dans l\'ordre du club', () => {
    const onChange = setup(['p']);
    fireEvent.click(screen.getByRole('button', { name: /· changer/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tennis' }));
    expect(onChange).toHaveBeenCalledWith(['p', 't']);
  });

  it('décoche un sport quand il en reste au moins un', () => {
    const onChange = setup(['p', 't']);
    fireEvent.click(screen.getByRole('button', { name: /· changer/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tennis' }));
    expect(onChange).toHaveBeenCalledWith(['p']);
  });

  it('empêche de décocher le dernier sport', () => {
    const onChange = setup(['p']);
    fireEvent.click(screen.getByRole('button', { name: /· changer/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Padel' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Voir le test échouer**

Run: `npm test -- SportPicker`
Expected: FAIL (`Cannot find module '../components/reserve/SportPicker'`).

- [ ] **Step 3 : Implémenter le composant**

Créer `frontend/components/reserve/SportPicker.tsx` :

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';

export type SportOption = { id: string; name: string; icon?: string | null };

// Résumé de la sélection : "Padel", "Padel, Tennis", "Padel +2" (1er nom + reste).
function summarize(sports: SportOption[], selectedIds: string[]): string {
  const names = sports.filter((s) => selectedIds.includes(s.id)).map((s) => s.name);
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]}, ${names[1]}`;
  return `${names[0]} +${names.length - 1}`;
}

// Sélecteur de sport discret : lien « <résumé> · changer » qui ouvre un panneau de cases
// à cocher. Au moins un sport reste toujours coché. Ferme au clic extérieur. Cocher conserve
// l'ordre fourni (ordre du club).
export function SportPicker({ sports, selectedIds, onChange }: {
  sports: SportOption[]; selectedIds: string[]; onChange: (ids: string[]) => void;
}) {
  const { th } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      if (selectedIds.length === 1) return; // garde : au moins un sport affiché
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      // ajout en conservant l'ordre du club
      onChange(sports.filter((s) => selectedIds.includes(s.id) || s.id === id).map((s) => s.id));
    }
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
        <span style={{ color: th.text, fontWeight: 600 }}>{summarize(sports, selectedIds)}</span>
        <span>· changer</span>
      </button>
      {open && (
        <div role="group" aria-label="Choisir les sports affichés"
          style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 20, minWidth: 200, background: th.surface, border: `1px solid ${th.line}`, borderRadius: 13, boxShadow: th.shadow, padding: 6 }}>
          {sports.map((s) => {
            const on = selectedIds.includes(s.id);
            return (
              <button key={s.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(s.id)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', padding: '9px 10px', borderRadius: 9, fontFamily: th.fontUI, fontSize: 14, color: th.text, textAlign: 'left' }}>
                <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1.6px solid ${on ? th.accent : th.line}`, background: on ? th.accent : 'transparent', color: th.onAccent, fontSize: 12 }}>{on ? '✓' : ''}</span>
                {s.icon ? `${s.icon} ` : ''}{s.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4 : Voir le test passer**

Run: `npm test -- SportPicker`
Expected: PASS (6 tests).

- [ ] **Step 5 : Typecheck**

Run: `npx tsc --noEmit`
Expected: aucune erreur liée à `SportPicker.tsx`.

- [ ] **Step 6 : Commit**

```bash
git add components/reserve/SportPicker.tsx __tests__/SportPicker.test.tsx
git commit -m "feat(reserver): composant SportPicker (lien discret + cases à cocher, garde ≥1)"
```

---

### Task 2 : Intégration multi-sports dans `ClubReserve`

Passer de `selectedSportId: string` à `selectedSportIds: string[] | null`, résoudre le défaut (localStorage → préféré → 1ᵉʳ sport) sans saut, persister par club, remplacer `PillTabs` par `SportPicker`, rendre une section par sport, et faire que le lien profond **ajoute** son sport. Adapter le test `persport`.

**Files:**
- Modify: `frontend/components/ClubReserve.tsx`
- Modify: `frontend/__tests__/ClubReserve.persport.test.tsx`

- [ ] **Step 1 : Importer `SportPicker`**

Dans `ClubReserve.tsx`, après l'import `QuotaStatus` (≈ ligne 18), ajouter :

```typescript
import { SportPicker } from '@/components/reserve/SportPicker';
```

Et retirer `PillTabs` de l'import s'il n'est plus utilisé ailleurs — **attention** : `PillTabs` reste utilisé pour les **durées** (≈ ligne 200). Donc **garder** `PillTabs` dans l'import `from '@/components/ui/atoms'`.

- [ ] **Step 2 : Remplacer l'état de sélection**

Remplacer la ligne (≈ 34) :

```typescript
  const [selectedSportId, setSelectedSportId] = useState<string>(club.clubSports[0]?.id ?? '');
```

par :

```typescript
  // Sélection multi-sports (ids de clubSport, ordre du club). null = pas encore résolue
  // (on évite d'afficher le mauvais sport le temps de lire le profil). Jamais vide une fois résolue.
  const SPORTS_KEY = `palova:reserve-sports:${club.id}`;
  const [selectedSportIds, setSelectedSportIds] = useState<string[] | null>(null);
  // Persiste un changement manuel (l'utilisateur a coché/décoché) et le mémorise par club.
  const changeSports = (ids: string[]) => {
    setSelectedSportIds(ids);
    try { localStorage.setItem(SPORTS_KEY, JSON.stringify(ids)); } catch { /* localStorage indispo */ }
  };
```

- [ ] **Step 3 : Remplacer l'effet « sport préféré » par la résolution complète du défaut**

Remplacer le bloc (≈ 89-99) :

```typescript
  // Sport par défaut = sport préféré du joueur si le club le propose, sinon clubSports[0].
  // On ne réécrase pas un changement manuel : on bascule uniquement si la valeur courante
  // est encore le défaut initial (clubSports[0]).
  useEffect(() => {
    if (!token) return;
    const defaultId = club.clubSports[0]?.id ?? '';
    api.getMyProfile(token).then((p) => {
      const match = club.clubSports.find((cs) => cs.sport.key === p.preferredSport?.key);
      if (match) setSelectedSportId((cur) => (cur === defaultId ? match.id : cur));
    }).catch(() => {});
  }, [token, club.clubSports]);
```

par :

```typescript
  // Résolution de la sélection initiale, sans saut (client only → pas de mismatch d'hydratation) :
  // 1) localStorage (ids encore proposés) → 2) sport préféré si connecté → 3) clubSports[0].
  useEffect(() => {
    if (selectedSportIds !== null) return; // déjà résolu
    const valid = (ids: string[]) => ids.filter((id) => club.clubSports.some((cs) => cs.id === id));
    try {
      const raw = localStorage.getItem(SPORTS_KEY);
      if (raw) { const ids = valid(JSON.parse(raw)); if (ids.length) { setSelectedSportIds(ids); return; } }
    } catch { /* localStorage indispo */ }
    const fallback = club.clubSports[0]?.id ? [club.clubSports[0].id] : [];
    if (token) {
      api.getMyProfile(token).then((p) => {
        const match = club.clubSports.find((cs) => cs.sport.key === p.preferredSport?.key);
        setSelectedSportIds(match ? [match.id] : fallback);
      }).catch(() => setSelectedSportIds(fallback));
    } else {
      setSelectedSportIds(fallback);
    }
  }, [token, club.clubSports, SPORTS_KEY, selectedSportIds]);
```

- [ ] **Step 4 : Lien profond → ajouter le sport au lieu de remplacer**

Dans l'effet du lien profond, remplacer la ligne (≈ 127) :

```typescript
        setSelectedSportId(cs.id);
```

par :

```typescript
        setSelectedSportIds((cur) => (cur && cur.includes(cs.id)) ? cur : [...(cur ?? []), cs.id]);
```

- [ ] **Step 5 : Remplacer le sélecteur de sport (PillTabs → SportPicker)**

Remplacer le bloc (≈ 176-185) :

```tsx
            {/* filtre par sport — affiché seulement si le club propose plusieurs sports */}
            {club.clubSports.length > 1 && (
              <div style={{ padding: '12px 20px 0' }}>
                <PillTabs<string>
                  options={club.clubSports.map((cs) => ({ value: cs.id, label: cs.sport.name }))}
                  value={selectedSportId}
                  onChange={setSelectedSportId}
                />
              </div>
            )}
```

par :

```tsx
            {/* sélecteur de sport discret — affiché seulement si le club propose plusieurs sports */}
            {club.clubSports.length > 1 && selectedSportIds !== null && (
              <div style={{ padding: '12px 20px 0' }}>
                <SportPicker
                  sports={club.clubSports.map((cs) => ({ id: cs.id, name: cs.sport.name, icon: cs.sport.icon }))}
                  selectedIds={selectedSportIds}
                  onChange={changeSports}
                />
              </div>
            )}
```

- [ ] **Step 6 : Grille multi-sections (filtre + garde « Chargement… » + titre conditionnel)**

Remplacer l'ouverture du bloc grille (≈ 186-188) :

```tsx
            {/* grille : section du sport sélectionné — durée propre + terrains + créneaux libres */}
            <div style={{ padding: '8px 20px 0' }}>
              {club.clubSports.filter((cs) => cs.id === selectedSportId).map((cs) => {
```

par :

```tsx
            {/* grille : une section par sport sélectionné — durée propre + terrains + créneaux libres */}
            <div style={{ padding: '8px 20px 0' }}>
              {selectedSportIds === null && (
                <div style={{ padding: '20px', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
              )}
              {selectedSportIds !== null && club.clubSports.filter((cs) => selectedSportIds.includes(cs.id)).map((cs) => {
```

Puis, dans le corps de ce `.map`, remplacer la condition du titre de section (≈ 195) :

```tsx
                    {club.clubSports.length === 1 && (
```

par :

```tsx
                    {(selectedSportIds.length > 1 || club.clubSports.length === 1) && (
```

(Le reste du corps de la section — durées, terrains, créneaux, prix — est inchangé. La parenthèse/accolade de fermeture du `.map` et le `</div>` du conteneur restent identiques.)

- [ ] **Step 7 : Typecheck**

Run: `npx tsc --noEmit`
Expected: aucune erreur. (Dans le `&&`, `selectedSportIds` est narrowé en `string[]` → `.includes`/`.length` OK. Si TS signalait un `possibly null`, capter `const ids = selectedSportIds;` juste avant le `.map` et l'utiliser — mais le narrowing du `&&` doit suffire.)

- [ ] **Step 8 : Adapter le test `persport` (pastilles supprimées)**

Dans `frontend/__tests__/ClubReserve.persport.test.tsx` :

(a) Ajouter `localStorage.clear();` dans **les deux** `beforeEach` (la sélection est désormais mémorisée → éviter toute fuite entre tests). Par exemple le 1er `beforeEach` devient :

```tsx
  beforeEach(() => {
    document.cookie = 'token=abc; path=/';
    localStorage.clear();
    mocked.getClubAvailability.mockResolvedValue([] as never);
    window.history.pushState({}, '', '/reserver');
  });
```

(faire le même ajout de `localStorage.clear();` dans le `beforeEach` du describe « sport préféré par défaut »).

(b) Remplacer le test `'affiche les onglets sport et bascule la section au clic'` (≈ 70-80) par :

```tsx
  it('le sélecteur multi ajoute la section d\'un sport coché', async () => {
    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);
    // Défaut = Padel (preferredSport absent du mock → clubSports[0]). Durée unique [90] → pas de pastille Squash.
    expect(await screen.findByRole('button', { name: /Padel · changer/ })).toBeInTheDocument();
    expect(screen.queryByText('45 min')).not.toBeInTheDocument();
    // Ouvrir le sélecteur et cocher Squash → sa section s'ajoute (durées 45/60 apparaissent).
    fireEvent.click(screen.getByRole('button', { name: /· changer/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Squash' }));
    expect(await screen.findByText('45 min')).toBeInTheDocument();
    // Padel reste affiché (multi) → libellé « Padel, Squash · changer ».
    expect(screen.getByRole('button', { name: /Padel, Squash · changer/ })).toBeInTheDocument();
  });

  it('mémorise la sélection par club (localStorage)', async () => {
    localStorage.setItem('palova:reserve-sports:c1', JSON.stringify(['cs2'])); // Squash mémorisé
    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);
    // Au montage, on restaure Squash (durées 45/60) sans repasser par Padel.
    expect(await screen.findByText('45 min')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Squash · changer/ })).toBeInTheDocument();
  });
```

(c) Ajouter, à la fin du fichier (nouveau `describe`), un test « club mono-sport = pas de sélecteur » :

```tsx
describe('ClubReserve — club mono-sport', () => {
  beforeEach(() => {
    document.cookie = 'token=abc; path=/';
    localStorage.clear();
    mocked.getClubAvailability.mockResolvedValue([] as never);
    window.history.pushState({}, '', '/reserver');
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; jest.clearAllMocks(); });

  const soloClub = {
    id: 'c3', slug: 'solo', name: 'Club Solo', timezone: 'Europe/Paris', description: null,
    memberBookingDays: 7, publicBookingDays: 7,
    clubSports: [
      { id: 'only', durationsMin: [90], sport: { key: 'padel', defaultDurationsMin: [90], name: 'Padel', icon: null }, resources: [] },
    ],
  } as never;

  it('n\'affiche pas de sélecteur « changer » quand le club n\'a qu\'un sport', async () => {
    render(<ThemeProvider><ClubReserve club={soloClub} /></ThemeProvider>);
    await waitFor(() => expect(mocked.getClubAvailability).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /· changer/ })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 9 : Lancer les tests ciblés**

Run: `npm test -- ClubReserve`
Expected: PASS — `ClubReserve.persport`, `ClubReserve.deeplink` et `ClubReserve.pastslots` verts. (Le test « charge chaque sport… » reste valide : `reloadAll` charge toujours tous les sports. Les tests deeplink/pastslots utilisent un club mono-sport → résolution synchrone, pas de régression.)

- [ ] **Step 10 : Commit (chemins explicites)**

```bash
git add components/ClubReserve.tsx __tests__/ClubReserve.persport.test.tsx
git commit -m "feat(reserver): sélecteur de sport multi (défaut préféré sans saut, mémorisé, sections par sport)"
```

---

### Task 3 : Vérification finale + doc

**Files:**
- Modify: `palova/CLAUDE.md`

- [ ] **Step 1 : Suite frontend complète**

Run: `npm test`
Expected: PASS, aucune régression (notamment `SportPicker`, `ClubReserve.*`).

- [ ] **Step 2 : Typecheck**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3 : Vérif visuelle manuelle (dev)**

Démarrer le front (`npm run dev`) sur un sous-domaine club multi-sports, page `/reserver` :
- Pas de rangée de pastilles ; la grille du sport préféré s'affiche directement, sans saut.
- « Padel · changer » ouvre la liste à cocher ; cocher Tennis ajoute une section « Tennis » et le lien devient « Padel, Tennis · changer ».
- On ne peut pas tout décocher.
- Recharger la page → la sélection est conservée (localStorage).
- Club mono-sport : aucun lien « changer ».

- [ ] **Step 4 : Note d'évolution CLAUDE.md**

Ajouter, sous la section pertinente de `palova/CLAUDE.md` (réservation / `ClubReserve`), une note d'évolution résumant : sélecteur de sport remplacé par `SportPicker` (lien discret « … · changer » + cases à cocher, garde ≥1, mémorisé par club via `localStorage['palova:reserve-sports:<clubId>']`), défaut = sport préféré résolu sans saut (localStorage → préféré → `clubSports[0]`), grille multi-sections (une section par sport, titre dès 2 sports), lien profond qui ajoute son sport. Disponibilité toujours chargée pour tous les sports (`reloadAll` inchangé).

```bash
git add ../CLAUDE.md
git commit -m "docs: note d'évolution Réserver (sélecteur de sport multi + défaut préféré)"
```

---

## Self-review (effectuée)

**Couverture spec :**
- Plus de pastilles, grille du préféré directe → Task 2 (Steps 5-6). ✓
- Défaut net sans saut (localStorage → préféré → clubSports[0], garde « Chargement… ») → Task 2 (Steps 2-3, 6). ✓
- Lien « Padel, Tennis · changer » + « +N » + liste à cocher → Task 1. ✓
- Multi-sections (titre dès 2 sports) → Task 2 (Step 6). ✓
- Garde « ≥1 coché » → Task 1 (toggle) + test. ✓
- Mémorisation par club → Task 2 (Steps 2-3) + test restore. ✓
- Club mono-sport / non connecté sans régression → Task 2 (gate `length > 1`, résolution synchrone) + test mono-sport + tests deeplink/pastslots verts. ✓

**Placeholders :** aucun ; tout le code est fourni. Les commentaires « localStorage indispo » documentent les `catch` volontairement vides (pas des TODO).

**Cohérence des types :** `SportOption { id; name; icon? }` défini en Task 1, réutilisé identiquement en Task 2 (Step 5) ; `selectedSportIds: string[] | null`, `changeSports`, `SPORTS_KEY` cohérents entre Steps 2/3/5/6 ; `onChange: (ids: string[]) => void` identique composant/appelant.
