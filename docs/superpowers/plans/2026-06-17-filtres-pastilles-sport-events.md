# Filtres « pastilles accent » Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un composant de filtre partagé « pastilles accent » (`Pill`/`PillTabs`), appliqué à la page Réserver (filtre par sport + durée compacte) et à la page Events (rangée principale + facettes), avec libellés inactifs pleinement lisibles.

**Architecture:** `Pill` (primitif pastille) + `PillTabs<T>` (single-select) dans `components/ui/atoms.tsx`, stylés inline comme le reste du fichier, theme-safe via `inkOn()`. Réserver et Events consomment ces composants ; aucune logique métier ni backend touchés.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Jest + React Testing Library. Aucune migration.

Spec : `docs/superpowers/specs/2026-06-17-filtres-pastilles-sport-events-design.md`

---

## File Structure

- **Modify:** `frontend/components/ui/atoms.tsx` — ajoute `Pill` + `PillTabs` (le `Segmented` existant reste).
- **Create:** `frontend/__tests__/Pill.test.tsx` — tests du composant.
- **Modify:** `frontend/components/ClubReserve.tsx` — filtre sport + durée compacte.
- **Modify:** `frontend/__tests__/ClubReserve.persport.test.tsx` — adapte au filtrage.
- **Modify:** `frontend/app/events/page.tsx` — habillage des filtres via `Pill`/`PillTabs`.

Commandes :
- Jest 1 fichier : `cd "C:/Users/e.nougayrede/OneDrive - BAYARD PRESSE/IA/05_PERSO/RESERVE/palova/frontend" && npx jest <chemin>`
- Suite + types : `cd "…/frontend" && npm test` et `npx tsc --noEmit`

---

## Task 1: Composant partagé `Pill` + `PillTabs` (TDD)

**Files:**
- Modify: `frontend/components/ui/atoms.tsx`
- Test: `frontend/__tests__/Pill.test.tsx`

- [ ] **Step 1: Write the failing test**

Créer `frontend/__tests__/Pill.test.tsx` :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { Pill, PillTabs } from '../components/ui/atoms';
import { ThemeProvider } from '../lib/ThemeProvider';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('Pill', () => {
  it('rend le libellé et signale l’état actif', () => {
    wrap(<Pill label="Padel" active onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Padel' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('appelle onClick au clic', () => {
    const fn = jest.fn();
    wrap(<Pill label="Tennis" active={false} onClick={fn} />);
    fireEvent.click(screen.getByText('Tennis'));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('PillTabs', () => {
  const options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];

  it('rend une pastille par option et marque la valeur active', () => {
    wrap(<PillTabs options={options} value="a" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'A' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'B' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('appelle onChange avec la valeur cliquée', () => {
    const fn = jest.fn();
    wrap(<PillTabs options={options} value="a" onChange={fn} />);
    fireEvent.click(screen.getByText('B'));
    expect(fn).toHaveBeenCalledWith('b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "C:/Users/e.nougayrede/OneDrive - BAYARD PRESSE/IA/05_PERSO/RESERVE/palova/frontend" && npx jest __tests__/Pill.test.tsx`
Expected: FAIL — `Pill`/`PillTabs` non exportés.

- [ ] **Step 3: Implement**

Dans `frontend/components/ui/atoms.tsx`, ajouter l'import `inkOn` à côté des imports existants :

```ts
import { inkOn } from '@/lib/theme';
```

Puis ajouter ces deux exports (par ex. juste après la fonction `Segmented`) :

```tsx
type PillSize = 'md' | 'sm';

const PILL_SIZE: Record<PillSize, { padding: string; fontSize: number }> = {
  md: { padding: '8px 16px', fontSize: 14 },
  sm: { padding: '5px 13px', fontSize: 13 },
};

// Pastille de filtre (standard Palova). Actif = fond plein `activeBg` (défaut accent),
// texte lisible via inkOn ; inactif = blanc + fin filet + texte plein. Theme-safe.
export function Pill({ label, active, onClick, size = 'md', activeBg, ...rest }: {
  label: ReactNode; active: boolean; onClick: () => void;
  size?: PillSize; activeBg?: string; 'aria-label'?: string;
}) {
  const { th } = useTheme();
  const bg = activeBg ?? th.accent;
  const s = PILL_SIZE[size];
  return (
    <button onClick={onClick} aria-pressed={active} {...rest}
      style={{
        border: 'none', cursor: 'pointer', borderRadius: 999, padding: s.padding,
        fontFamily: th.fontUI, fontSize: s.fontSize, fontWeight: active ? 700 : 600,
        background: active ? bg : th.surface,
        color: active ? inkOn(bg) : th.text,
        boxShadow: active ? 'none' : `inset 0 0 0 1px ${th.line}`,
        transition: 'all .15s',
      }}>{label}</button>
  );
}

// Groupe de pastilles single-select bâti sur Pill.
export function PillTabs<T extends string | number>({ options, value, onChange, size = 'md', activeBg }: {
  options: { value: T; label: ReactNode }[];
  value: T; onChange: (v: T) => void; size?: PillSize; activeBg?: string;
}) {
  return (
    <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: size === 'sm' ? 6 : 8 }}>
      {options.map((o) => (
        <Pill key={String(o.value)} label={o.label} active={o.value === value} size={size} activeBg={activeBg} onClick={() => onChange(o.value)} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "…/frontend" && npx jest __tests__/Pill.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/e.nougayrede/OneDrive - BAYARD PRESSE/IA/05_PERSO/RESERVE/palova"
git add frontend/components/ui/atoms.tsx frontend/__tests__/Pill.test.tsx
git commit -m "feat(ui): composant de filtre partagé Pill + PillTabs (pastilles accent)"
```

---

## Task 2: Page Réserver — filtre sport + durée compacte

**Files:**
- Modify: `frontend/components/ClubReserve.tsx`
- Test: `frontend/__tests__/ClubReserve.persport.test.tsx`

- [ ] **Step 1: Adapter le test (rouge d'abord)**

Dans `frontend/__tests__/ClubReserve.persport.test.tsx` :

Remplacer la ligne d'import RTL :
```tsx
import { render, screen, waitFor } from '@testing-library/react';
```
par :
```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
```

Remplacer le test `it('affiche les deux sections de sport', …)` (le second `it`) par :
```tsx
  it('affiche les onglets sport et bascule la section au clic', async () => {
    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);
    expect(await screen.findByRole('button', { name: 'Padel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Squash' })).toBeInTheDocument();
    // Par défaut Padel (durée unique) → aucune pastille de durée propre à Squash.
    expect(screen.queryByText('45 min')).not.toBeInTheDocument();
    // Bascule sur Squash → ses durées (45/60) apparaissent.
    fireEvent.click(screen.getByRole('button', { name: 'Squash' }));
    expect(await screen.findByText('45 min')).toBeInTheDocument();
    expect(screen.getByText('1 h')).toBeInTheDocument();
  });
```

Run: `cd "…/frontend" && npx jest __tests__/ClubReserve.persport.test.tsx`
Expected: FAIL (pas encore d'onglets / boutons `Padel`/`Squash`).

- [ ] **Step 2: Import + état du sport sélectionné**

Dans `frontend/components/ClubReserve.tsx` :

Remplacer l'import des atoms :
```ts
import { Chip, Placeholder, Segmented } from '@/components/ui/atoms';
```
par :
```ts
import { Chip, Placeholder, PillTabs } from '@/components/ui/atoms';
```

Après la déclaration `const [tab, setTab] = useState<'book' | 'courts'>('book');`, ajouter :
```ts
  const [selectedSportId, setSelectedSportId] = useState<string>(club.clubSports[0]?.id ?? '');
```

- [ ] **Step 3: Lien profond → sélectionne le sport du terrain**

Dans l'effet de résolution du lien profond, le bloc :
```ts
      if (res && slot) {
        setBooking({ resourceId: res.resource.id, price: slot.price, slot, duration: durationBySport[cs.id], format: typeof res.resource.attributes?.format === 'string' ? res.resource.attributes.format : undefined });
        setDeepSlot(null);
        return;
      }
```
devient (ajout d'une ligne `setSelectedSportId`) :
```ts
      if (res && slot) {
        setSelectedSportId(cs.id);
        setBooking({ resourceId: res.resource.id, price: slot.price, slot, duration: durationBySport[cs.id], format: typeof res.resource.attributes?.format === 'string' ? res.resource.attributes.format : undefined });
        setDeepSlot(null);
        return;
      }
```

- [ ] **Step 4: Onglets sport + rendu filtré**

Le bloc :
```tsx
            {/* grille : une section par sport — durée propre + terrains + créneaux libres */}
            <div style={{ padding: '8px 20px 0' }}>
              {club.clubSports.map((cs) => {
```
devient :
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
            {/* grille : section du sport sélectionné — durée propre + terrains + créneaux libres */}
            <div style={{ padding: '8px 20px 0' }}>
              {club.clubSports.filter((cs) => cs.id === selectedSportId).map((cs) => {
```

- [ ] **Step 5: Masquer l'en-tête de sport redondant + durée compacte**

Dans la section rendue par sport, l'en-tête :
```tsx
                    <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 10 }}>{cs.sport.icon ? `${cs.sport.icon} ` : ''}{cs.sport.name}</div>
```
devient (masqué quand il y a plusieurs sports — l'onglet actif nomme déjà le sport) :
```tsx
                    {club.clubSports.length === 1 && (
                      <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 10 }}>{cs.sport.icon ? `${cs.sport.icon} ` : ''}{cs.sport.name}</div>
                    )}
```

Le sélecteur de durée :
```tsx
                    {durations.length > 1 && (
                      <div style={{ marginBottom: 12 }}>
                        <Segmented<number> value={selDur} onChange={(d) => changeDuration(cs.id, d)} options={durations.map((d) => ({ value: d, label: durationLabel(d) }))} />
                      </div>
                    )}
```
devient :
```tsx
                    {durations.length > 1 && (
                      <div style={{ marginBottom: 12 }}>
                        <PillTabs<number> size="sm" activeBg={th.text} value={selDur} onChange={(d) => changeDuration(cs.id, d)} options={durations.map((d) => ({ value: d, label: durationLabel(d) }))} />
                      </div>
                    )}
```

- [ ] **Step 6: Run tests + types**

Run: `cd "…/frontend" && npx jest __tests__/ClubReserve.persport.test.tsx __tests__/ClubReserve.deeplink.test.tsx __tests__/ClubReserve.pastslots.test.tsx`
Expected: PASS (le filtrage avec 1 sport ne change rien pour deeplink/pastslots ; persport vert).

Run: `cd "…/frontend" && npx tsc --noEmit`
Expected: aucune erreur (notamment, `Segmented` n'est plus importé/inutilisé dans ClubReserve).

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/e.nougayrede/OneDrive - BAYARD PRESSE/IA/05_PERSO/RESERVE/palova"
git add frontend/components/ClubReserve.tsx frontend/__tests__/ClubReserve.persport.test.tsx
git commit -m "feat(reserver): filtre par sport + durée compacte (pastilles)"
```

---

## Task 3: Page Events — habillage des filtres via Pill/PillTabs

**Files:**
- Modify: `frontend/app/events/page.tsx`

- [ ] **Step 1: Importer le composant**

Dans `frontend/app/events/page.tsx`, ajouter sous les imports de composants existants :
```ts
import { Pill, PillTabs } from '@/components/ui/atoms';
```

- [ ] **Step 2: Supprimer les helpers `chip`/`secChip`**

Supprimer ces deux blocs (les définitions `const chip = …` et `const secChip = …`) :
```ts
  const chip = (active: boolean) => ({
    border: 'none', cursor: 'pointer', borderRadius: 999, padding: '8px 16px',
    fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700,
    background: active ? th.ink : th.surface, color: active ? (th.mode === 'floodlit' ? th.text : '#f7f5ee') : th.textMute,
    boxShadow: active ? 'none' : `inset 0 0 0 1px ${th.line}`,
  });

  // Pastille de facette secondaire (multi-sélection, plus petite que la rangée 1).
  const secChip = (active: boolean) => ({
    border: 'none', cursor: 'pointer', borderRadius: 999, padding: '5px 12px',
    fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600,
    background: active ? th.accent : th.surface, color: active ? th.onAccent : th.textMute,
    boxShadow: active ? 'none' : `inset 0 0 0 1px ${th.line}`,
  });
```

- [ ] **Step 3: Rangée principale → `PillTabs` (accent)**

Le bloc :
```tsx
        <div style={{ padding: '16px 20px 0', display: 'flex', gap: 8 }}>
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => selectSource(f.key)} style={chip(filter === f.key)}>{f.label}</button>
          ))}
        </div>
```
devient :
```tsx
        <div style={{ padding: '16px 20px 0' }}>
          <PillTabs<AgendaFilter>
            options={FILTERS.map((f) => ({ value: f.key, label: f.label }))}
            value={filter}
            onChange={selectSource}
          />
        </div>
```

- [ ] **Step 4: Rangée secondaire → `Pill` `sm` (foncé)**

Le bloc des facettes :
```tsx
            {showCategories && facets!.categories.map((c) => (
              <button key={`cat-${c}`} onClick={() => toggle(setCategories, c)} style={secChip(categories.has(c))}>{c}</button>
            ))}
            {showGenders && (showCategories ? sep : null)}
            {showGenders && facets!.genders.map((g) => (
              <button key={`gen-${g}`} onClick={() => toggle(setGenders, g)} style={secChip(genders.has(g))}>{GENDER_LABEL[g]}</button>
            ))}
            {showKinds && (showCategories ? sep : null)}
            {showKinds && facets!.kinds.map((k) => (
              <button key={`kind-${k}`} onClick={() => toggle(setKinds, k)} style={secChip(kinds.has(k))}>{KIND_LABEL[k]}</button>
            ))}
            {showMemberOnly && (
              <button onClick={() => setMemberOnly((v) => !v)} style={secChip(memberOnly)}>Membres</button>
            )}
```
devient :
```tsx
            {showCategories && facets!.categories.map((c) => (
              <Pill key={`cat-${c}`} size="sm" activeBg={th.text} label={c} active={categories.has(c)} onClick={() => toggle(setCategories, c)} />
            ))}
            {showGenders && (showCategories ? sep : null)}
            {showGenders && facets!.genders.map((g) => (
              <Pill key={`gen-${g}`} size="sm" activeBg={th.text} label={GENDER_LABEL[g]} active={genders.has(g)} onClick={() => toggle(setGenders, g)} />
            ))}
            {showKinds && (showCategories ? sep : null)}
            {showKinds && facets!.kinds.map((k) => (
              <Pill key={`kind-${k}`} size="sm" activeBg={th.text} label={KIND_LABEL[k]} active={kinds.has(k)} onClick={() => toggle(setKinds, k)} />
            ))}
            {showMemberOnly && (
              <Pill size="sm" activeBg={th.text} label="Membres" active={memberOnly} onClick={() => setMemberOnly((v) => !v)} />
            )}
```

Le lien « Effacer » et les séparateurs `sep` restent inchangés.

- [ ] **Step 5: Run types + suite**

Run: `cd "…/frontend" && npx tsc --noEmit`
Expected: aucune erreur (`chip`/`secChip` supprimés, plus référencés).

Run: `cd "…/frontend" && npm test`
Expected: tout vert (la logique de facettes `__tests__/events.test.ts` est inchangée ; aucun test ne rend la page Events).

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/e.nougayrede/OneDrive - BAYARD PRESSE/IA/05_PERSO/RESERVE/palova"
git add frontend/app/events/page.tsx
git commit -m "feat(events): filtres au style pastilles partagé (Pill/PillTabs)"
```

---

## Vérification manuelle finale

1. Démarrer back + front (cf. CLAUDE.md), se connecter.
2. **Réserver** (`/reserver`) : sur un club **multi-sports**, les onglets sport apparaissent (actif = accent), un seul sport affiché, bascule instantanée. Sur un club **mono-sport**, pas d'onglets, l'en-tête du sport reste. Le sélecteur de durée est en **petites pastilles** (actif foncé). Le sélecteur de **dates est inchangé**.
3. **Events** (`/events`) : rangée principale en pastilles accent, facettes secondaires en petites pastilles foncées, libellés inactifs **bien lisibles** ; filtrage/persistance URL identiques.
4. Vérifier en thème **sombre** que tout reste lisible (fond actif foncé `th.text` s'inverse).

---

## Self-Review (couverture spec)

- Composant partagé `Pill` + `PillTabs`, tailles md/sm, `activeBg` (défaut accent), inactif lisible `th.text`, theme-safe `inkOn` → Task 1. ✅
- Réserver : filtre sport (≥ 2 sports), rendu du sport sélectionné, en-tête masqué si ≥ 2, durée `sm` foncée, lien profond sélectionne le sport, dates intactes → Task 2. ✅
- Events : principale `PillTabs md` accent, facettes `Pill sm` foncé, logique/URL inchangées, helpers `chip`/`secChip` supprimés → Task 3. ✅
- Règle de couleur (principal=accent/md, sous-filtre=`th.text`/sm) appliquée des deux côtés. ✅
- Pas de backend, pas de migration. ✅
