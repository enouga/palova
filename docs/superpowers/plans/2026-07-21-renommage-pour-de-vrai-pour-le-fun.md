# Renommage « Pour de vrai / Pour le fun » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renommer partout côté joueur les types de partie « Compétitive / Amicale » en « Pour de vrai / Pour le fun » (spec `docs/superpowers/specs/2026-07-21-renommage-pour-de-vrai-pour-le-fun-design.md`).

**Architecture:** Renommage 100 % frontend de libellés dans 7 composants + leurs tests. Aucune migration, aucun changement backend, aucun changement de comportement : le champ API `competitive` (booléen), le défaut (`true` = « Pour de vrai »), le verrouillage du type à la saisie sur une partie ouverte et le gate Glicko restent intacts. Les sous-titres pédagogiques existants (« Compte pour le niveau » / « Le niveau ne bouge pas ») sont conservés tels quels.

**Tech Stack:** Next.js 16 / React, Jest + React Testing Library.

---

## ⚠️ Contexte d'exécution — À LIRE AVANT TOUTE MODIFICATION

1. **NE PAS exécuter ce plan dans l'arbre de travail principal.** La branche `feat/seo-referencement` porte du WIP **non committé** (chantier « validation de match ») qui touche 4 fichiers du périmètre : `frontend/components/match/MyMatchesList.tsx`, `frontend/components/openmatch/OpenMatchCard.tsx`, `frontend/lib/api.ts`, `frontend/__tests__/MyMatchesList.test.tsx`. Un `git add` de ces fichiers dans l'arbre principal embarquerait le WIP.
2. **Exécuter dans un worktree isolé** (skill `superpowers:using-git-worktrees`), branché depuis `feat/seo-referencement` (HEAD). Toutes les chaînes cibles de ce plan ont été vérifiées présentes à HEAD. Setup minimal pour lancer les tests (le worktree n'a pas de `node_modules`) :
   ```powershell
   cmd /c mklink /J "<worktree>\frontend\node_modules" "C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend\node_modules"
   ```
3. **INTERDIT : `git stash`** (la pile de stash est partagée entre worktrees — un stash/pop peut détruire le WIP d'une autre session).
4. Les shims `node_modules\.bin` sont cassés sur cette machine : lancer jest via `node node_modules/jest/bin/jest.js` et tsc via `node node_modules/typescript/bin/tsc` (depuis `frontend/`). Toujours `--runTestsByPath` pour cibler un fichier (un chemin nu est traité comme un motif et attrape d'autres suites).
5. Le cwd PowerShell se réinitialise entre les commandes : préfixer chaque commande de test par `cd <worktree>\frontend;`.

---

### Task 1: OpenMatchQuickSwitch (switch de publication, écran de succès)

**Files:**
- Modify: `frontend/__tests__/OpenMatchQuickSwitch.test.tsx` (~lignes 147-160)
- Modify: `frontend/components/reservations/OpenMatchQuickSwitch.tsx` (~lignes 160-161)

- [ ] **Step 1: Mettre à jour les assertions du test (elles décrivent les nouveaux libellés)**

Dans `frontend/__tests__/OpenMatchQuickSwitch.test.tsx`, remplacer :

```tsx
  it('segmenté Amicale/Compétitive présent sur une partie ouverte, Compétitive actif par défaut', async () => {
    wrap({ visibility: 'PUBLIC', competitive: true, targetLevelMin: 3, targetLevelMax: 5 });
    expect(await screen.findByRole('button', { name: /Compétitive/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Amicale/ })).toBeInTheDocument();
  });

  it('cliquer « Amicale » republie avec competitive=false', async () => {
    wrap({ visibility: 'PUBLIC', competitive: true, targetLevelMin: 3, targetLevelMax: 5 });
    fireEvent.click(await screen.findByRole('button', { name: /Amicale/ }));
```

par :

```tsx
  it('segmenté Pour le fun/Pour de vrai présent sur une partie ouverte, Pour de vrai actif par défaut', async () => {
    wrap({ visibility: 'PUBLIC', competitive: true, targetLevelMin: 3, targetLevelMax: 5 });
    expect(await screen.findByRole('button', { name: /Pour de vrai/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pour le fun/ })).toBeInTheDocument();
  });

  it('cliquer « Pour le fun » republie avec competitive=false', async () => {
    wrap({ visibility: 'PUBLIC', competitive: true, targetLevelMin: 3, targetLevelMax: 5 });
    fireEvent.click(await screen.findByRole('button', { name: /Pour le fun/ }));
```

(le reste du second test — le `waitFor` sur `competitive: false` — ne change pas).

- [ ] **Step 2: Vérifier que le test échoue**

Run: `cd <worktree>\frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchQuickSwitch.test.tsx`
Expected: FAIL — « Unable to find an accessible element with the role "button" and name `/Pour de vrai/` »

- [ ] **Step 3: Renommer les libellés dans le composant**

Dans `frontend/components/reservations/OpenMatchQuickSwitch.tsx`, remplacer :

```tsx
            {([['competitive', 'Compétitive', 'Le résultat compte pour le niveau'],
               ['friendly', 'Amicale', 'Le niveau ne bouge pas']] as const).map(([key, label, sub]) => {
```

par :

```tsx
            {([['competitive', 'Pour de vrai', 'Le résultat compte pour le niveau'],
               ['friendly', 'Pour le fun', 'Le niveau ne bouge pas']] as const).map(([key, label, sub]) => {
```

- [ ] **Step 4: Vérifier que la suite passe**

Run: `cd <worktree>\frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchQuickSwitch.test.tsx`
Expected: PASS (toute la suite)

- [ ] **Step 5: Commit**

```bash
git add frontend/__tests__/OpenMatchQuickSwitch.test.tsx frontend/components/reservations/OpenMatchQuickSwitch.tsx
git commit -m "feat(parties): renomme Competitive/Amicale en Pour de vrai/Pour le fun -- OpenMatchQuickSwitch"
```

---

### Task 2: OpenMatchToggle (switch de publication, calendrier)

**Files:**
- Modify: `frontend/__tests__/OpenMatchToggle.test.tsx` (~lignes 75-78)
- Modify: `frontend/components/reservations/OpenMatchToggle.tsx` (~lignes 113-114)

- [ ] **Step 1: Mettre à jour les assertions du test**

Dans `frontend/__tests__/OpenMatchToggle.test.tsx`, remplacer :

```tsx
  it('publie une partie AMICALE (competitive=false) quand « Amicale » est choisi', async () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: /Ouvrir la partie/ }));
    fireEvent.click(screen.getByRole('button', { name: /Amicale/ }));
```

par :

```tsx
  it('publie une partie POUR LE FUN (competitive=false) quand « Pour le fun » est choisi', async () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: /Ouvrir la partie/ }));
    fireEvent.click(screen.getByRole('button', { name: /Pour le fun/ }));
```

(le `waitFor` sur `competitive: false` ne change pas).

- [ ] **Step 2: Vérifier que le test échoue**

Run: `cd <worktree>\frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchToggle.test.tsx`
Expected: FAIL — bouton `/Pour le fun/` introuvable

- [ ] **Step 3: Renommer les libellés dans le composant**

Dans `frontend/components/reservations/OpenMatchToggle.tsx`, remplacer :

```tsx
            {([['competitive', 'Compétitive', 'Compte pour le niveau'],
               ['friendly', 'Amicale', 'Le niveau ne bouge pas']] as const).map(([key, label, sub]) => {
```

par :

```tsx
            {([['competitive', 'Pour de vrai', 'Compte pour le niveau'],
               ['friendly', 'Pour le fun', 'Le niveau ne bouge pas']] as const).map(([key, label, sub]) => {
```

(⚠️ le sous-titre de ce switch est « Compte pour le niveau », légèrement différent de celui de Task 1 — c'est voulu, on ne les unifie pas.)

- [ ] **Step 4: Vérifier que la suite passe**

Run: `cd <worktree>\frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchToggle.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/__tests__/OpenMatchToggle.test.tsx frontend/components/reservations/OpenMatchToggle.tsx
git commit -m "feat(parties): renomme les types dans OpenMatchToggle"
```

---

### Task 3: OpenMatchCard (badge sur la carte de partie)

**Files:**
- Modify: `frontend/__tests__/OpenMatchCard.test.tsx` (~lignes 67-75)
- Modify: `frontend/components/openmatch/OpenMatchCard.tsx` (badge ~lignes 124-126 + 3 commentaires ~lignes 93, 111, 114)

- [ ] **Step 1: Mettre à jour les assertions du test**

Dans `frontend/__tests__/OpenMatchCard.test.tsx`, remplacer :

```tsx
  it('affiche le badge Amicale quand competitive=false', () => {
    render(<ThemeProvider><OpenMatchCard {...makeProps(makeMatch({ competitive: false }))} /></ThemeProvider>);
    expect(screen.getByText('Amicale')).toBeInTheDocument();
  });

  it('affiche le badge Compétitive par défaut (competitive=true ou absent)', () => {
    render(<ThemeProvider><OpenMatchCard {...makeProps(makeMatch({ competitive: true }))} /></ThemeProvider>);
    expect(screen.getByText('Compétitive')).toBeInTheDocument();
  });
```

par :

```tsx
  it('affiche le badge Pour le fun quand competitive=false', () => {
    render(<ThemeProvider><OpenMatchCard {...makeProps(makeMatch({ competitive: false }))} /></ThemeProvider>);
    expect(screen.getByText('Pour le fun')).toBeInTheDocument();
  });

  it('affiche le badge Pour de vrai par défaut (competitive=true ou absent)', () => {
    render(<ThemeProvider><OpenMatchCard {...makeProps(makeMatch({ competitive: true }))} /></ThemeProvider>);
    expect(screen.getByText('Pour de vrai')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `cd <worktree>\frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchCard.test.tsx`
Expected: FAIL — « Unable to find an element with the text: Pour le fun »

- [ ] **Step 3: Renommer le badge dans le composant**

Dans `frontend/components/openmatch/OpenMatchCard.tsx`, remplacer :

```tsx
          {m.competitive === false
            ? <Chip tone="line">Amicale</Chip>
            : <Chip tone="accent">Compétitive</Chip>}
```

par :

```tsx
          {m.competitive === false
            ? <Chip tone="line">Pour le fun</Chip>
            : <Chip tone="accent">Pour de vrai</Chip>}
```

- [ ] **Step 4: Réécrire les 3 commentaires devenus obsolètes**

Toujours dans `OpenMatchCard.tsx` — remplacer, dans le commentaire au-dessus de la rangée 1/2 :

```
          Rangée 2 : niveau à gauche (optionnel, par match) / type Compétitive-Amicale
```

par :

```
          Rangée 2 : niveau à gauche (optionnel, par match) / type Pour de vrai-Pour le fun
```

puis, dans le commentaire « Preuve sociale », remplacer :

```
            (pastille Compétitive épinglée à droite), et l'icône+texte est plus bas que les pastilles,
```

par :

```
            (pastille de type épinglée à droite), et l'icône+texte est plus bas que les pastilles,
```

et :

```
            la pastille Compétitive ou de faire wrapper la rangée. */}
```

par :

```
            la pastille de type ou de faire wrapper la rangée. */}
```

- [ ] **Step 5: Vérifier que la suite passe**

Run: `cd <worktree>\frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchCard.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/__tests__/OpenMatchCard.test.tsx frontend/components/openmatch/OpenMatchCard.tsx
git commit -m "feat(parties): renomme le badge de type sur OpenMatchCard"
```

---

### Task 4: MatchesFilterBar + intégration OpenMatches (filtre /parties)

**Files:**
- Modify: `frontend/__tests__/MatchesFilterBar.test.tsx` (~lignes 35-38)
- Modify: `frontend/__tests__/OpenMatches.test.tsx` (~lignes 100-112 et le commentaire ~ligne 232)
- Modify: `frontend/components/openmatch/MatchesFilterBar.tsx` (~lignes 113-114)

- [ ] **Step 1: Mettre à jour les assertions des deux tests**

Dans `frontend/__tests__/MatchesFilterBar.test.tsx`, remplacer :

```tsx
    fireEvent.click(screen.getByRole('button', { name: 'Compétitives' }));
    expect(onKindChange).toHaveBeenCalledWith('competitive');
    fireEvent.click(screen.getByRole('button', { name: 'Amicales' }));
    expect(onKindChange).toHaveBeenCalledWith('friendly');
```

par :

```tsx
    fireEvent.click(screen.getByRole('button', { name: 'Pour de vrai' }));
    expect(onKindChange).toHaveBeenCalledWith('competitive');
    fireEvent.click(screen.getByRole('button', { name: 'Pour le fun' }));
    expect(onKindChange).toHaveBeenCalledWith('friendly');
```

Dans `frontend/__tests__/OpenMatches.test.tsx`, remplacer :

```tsx
  it('filtre les parties amicales via les chips Toutes/Compétitives/Amicales', async () => {
```

par :

```tsx
  it('filtre les parties pour le fun via les chips Toutes/Pour de vrai/Pour le fun', async () => {
```

et, dans ce même test :

```tsx
    fireEvent.click(screen.getByRole('button', { name: 'Amicales' }));
```

par :

```tsx
    fireEvent.click(screen.getByRole('button', { name: 'Pour le fun' }));
```

Enfin, supprimer la ligne de commentaire devenue caduque (le chip ne s'appelle plus « Amicales », la collision regex a disparu — le matcher exact `name: 'Ami'` reste) :

```tsx
    // `name: 'Ami'` (exact) et non `/Ami/` : le chip de filtre « Amicales » matcherait aussi la regex.
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `cd <worktree>\frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MatchesFilterBar.test.tsx __tests__/OpenMatches.test.tsx`
Expected: FAIL — boutons « Pour de vrai » / « Pour le fun » introuvables (2 suites en échec)

- [ ] **Step 3: Renommer les chips dans le composant**

Dans `frontend/components/openmatch/MatchesFilterBar.tsx`, remplacer :

```tsx
              <Chip label="Compétitives" active={kindFilter === 'competitive'} onClick={() => onKindChange('competitive')} />
              <Chip label="Amicales" active={kindFilter === 'friendly'} onClick={() => onKindChange('friendly')} />
```

par :

```tsx
              <Chip label="Pour de vrai" active={kindFilter === 'competitive'} onClick={() => onKindChange('competitive')} />
              <Chip label="Pour le fun" active={kindFilter === 'friendly'} onClick={() => onKindChange('friendly')} />
```

- [ ] **Step 4: Vérifier que les deux suites passent**

Run: `cd <worktree>\frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MatchesFilterBar.test.tsx __tests__/OpenMatches.test.tsx`
Expected: PASS (les deux suites entières)

- [ ] **Step 5: Commit**

```bash
git add frontend/__tests__/MatchesFilterBar.test.tsx frontend/__tests__/OpenMatches.test.tsx frontend/components/openmatch/MatchesFilterBar.tsx
git commit -m "feat(parties): renomme les chips du filtre Type de partie"
```

---

### Task 5: MatchResultModal (saisie du résultat)

**Files:**
- Modify: `frontend/__tests__/MatchResultModal.test.tsx` (~lignes 101-115)
- Modify: `frontend/components/match/MatchResultModal.tsx` (~lignes 99, 103, 121)

- [ ] **Step 1: Mettre à jour les assertions du test**

Dans `frontend/__tests__/MatchResultModal.test.tsx`, remplacer :

```tsx
describe('Amicale / Compétitive', () => {
  it('résa privée : segmented Compétitive par défaut, envoie competitive=false si Amicale', async () => {
    renderModal({ initialTeams: fullTeams });
    fireEvent.click(screen.getByRole('button', { name: /Amicale/ }));
```

par :

```tsx
describe('Pour le fun / Pour de vrai', () => {
  it('résa privée : segmented Pour de vrai par défaut, envoie competitive=false si Pour le fun', async () => {
    renderModal({ initialTeams: fullTeams });
    fireEvent.click(screen.getByRole('button', { name: /Pour le fun/ }));
```

et :

```tsx
  it('partie ouverte (locked) : badge statique, pas de bouton de bascule', () => {
    renderModal({ initialTeams: fullTeams, locked: true, competitive: false });
    expect(screen.getByText(/Partie amicale/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Compétitive/ })).toBeNull();
  });
```

par :

```tsx
  it('partie ouverte (locked) : badge statique, pas de bouton de bascule', () => {
    renderModal({ initialTeams: fullTeams, locked: true, competitive: false });
    expect(screen.getByText(/Pour le fun — le niveau ne bouge pas/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pour de vrai/ })).toBeNull();
  });
```

(⚠️ asserter la phrase complète `/Pour le fun — le niveau ne bouge pas/` et non `/Pour le fun/` seul : en mode locked le badge d'en-tête affiche aussi « Pour le fun », un `getByText` court matcherait deux éléments.)

- [ ] **Step 2: Vérifier que le test échoue**

Run: `cd <worktree>\frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MatchResultModal.test.tsx`
Expected: FAIL — bouton `/Pour le fun/` et texte `/Pour le fun — le niveau ne bouge pas/` introuvables

- [ ] **Step 3: Renommer badge, segmenté et phrase explicative dans le composant**

Dans `frontend/components/match/MatchResultModal.tsx` — trois remplacements :

Badge locked (ligne ~99) :

```tsx
              {competitiveState ? 'Compétitive' : 'Amicale'}
```

devient :

```tsx
              {competitiveState ? 'Pour de vrai' : 'Pour le fun'}
```

Segmenté (ligne ~103) :

```tsx
              {([['competitive', 'Compétitive'], ['friendly', 'Amicale']] as const).map(([key, label]) => {
```

devient :

```tsx
              {([['competitive', 'Pour de vrai'], ['friendly', 'Pour le fun']] as const).map(([key, label]) => {
```

Phrase explicative en mode locked (ligne ~121 ; la ligne suivante — mode segmenté « Compte pour le niveau. / Le niveau ne bouge pas. » — ne change PAS) :

```tsx
            ? (competitiveState ? 'Partie compétitive — le résultat compte pour le niveau.' : 'Partie amicale — le niveau ne bouge pas.')
```

devient :

```tsx
            ? (competitiveState ? 'Pour de vrai — le résultat compte pour le niveau.' : 'Pour le fun — le niveau ne bouge pas.')
```

- [ ] **Step 4: Vérifier que la suite passe**

Run: `cd <worktree>\frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MatchResultModal.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/__tests__/MatchResultModal.test.tsx frontend/components/match/MatchResultModal.tsx
git commit -m "feat(parties): renomme le type dans la modale de saisie du resultat"
```

---

### Task 6: MyMatchesList (puce sur un résultat confirmé)

**Files:**
- Modify: `frontend/__tests__/MyMatchesList.test.tsx` (assertions « Amicale » — ~lignes 58-66 à HEAD)
- Modify: `frontend/components/match/MyMatchesList.tsx` (puce — ~ligne 106 à HEAD)

- [ ] **Step 1: Mettre à jour les assertions du test**

Dans `frontend/__tests__/MyMatchesList.test.tsx`, remplacer :

```tsx
it('marque un résultat amical (competitive=false)', () => {
  renderWithTheme(<MyMatchesList matches={[{ ...base, competitive: false }] as any} token="t" onChanged={() => {}} />);
  expect(screen.getByText('Amicale')).toBeInTheDocument();
});

it('un match compétitif ne montre pas « Amicale »', () => {
  renderWithTheme(<MyMatchesList matches={[{ ...base, competitive: true }] as any} token="t" onChanged={() => {}} />);
  expect(screen.queryByText('Amicale')).toBeNull();
});
```

par :

```tsx
it('marque un résultat pour le fun (competitive=false)', () => {
  renderWithTheme(<MyMatchesList matches={[{ ...base, competitive: false }] as any} token="t" onChanged={() => {}} />);
  expect(screen.getByText('Pour le fun')).toBeInTheDocument();
});

it('un match pour de vrai ne montre pas « Pour le fun »', () => {
  renderWithTheme(<MyMatchesList matches={[{ ...base, competitive: true }] as any} token="t" onChanged={() => {}} />);
  expect(screen.queryByText('Pour le fun')).toBeNull();
});
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `cd <worktree>\frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MyMatchesList.test.tsx`
Expected: FAIL — « Unable to find an element with the text: Pour le fun »

- [ ] **Step 3: Renommer la puce dans le composant**

Dans `frontend/components/match/MyMatchesList.tsx`, remplacer :

```tsx
                  <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 600, color: th.textMute, background: th.surface2, borderRadius: 8, padding: '2px 8px' }}>Amicale</span>
```

par :

```tsx
                  <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 600, color: th.textMute, background: th.surface2, borderRadius: 8, padding: '2px 8px' }}>Pour le fun</span>
```

- [ ] **Step 4: Vérifier que la suite passe**

Run: `cd <worktree>\frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MyMatchesList.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/__tests__/MyMatchesList.test.tsx frontend/components/match/MyMatchesList.tsx
git commit -m "feat(parties): renomme la puce de type dans MyMatchesList"
```

---

### Task 7: ResultsToRecord (carte « Résultats à saisir »)

**Files:**
- Modify: `frontend/__tests__/ResultsToRecord.test.tsx` (~lignes 70-75)
- Modify: `frontend/components/match/ResultsToRecord.tsx` (~ligne 90)

- [ ] **Step 1: Mettre à jour les assertions du test**

Dans `frontend/__tests__/ResultsToRecord.test.tsx`, remplacer :

```tsx
it('pas de chip Compétitive sur la carte (défaut), chip Amicale si competitive=false', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([row, { ...row, reservationId: 'r2', competitive: false }]);
  wrap();
  await waitFor(() => expect(screen.getByText('Amicale')).toBeInTheDocument());
  expect(screen.queryByText('Compétitive')).not.toBeInTheDocument();
});
```

par :

```tsx
it('pas de chip Pour de vrai sur la carte (défaut), chip Pour le fun si competitive=false', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([row, { ...row, reservationId: 'r2', competitive: false }]);
  wrap();
  await waitFor(() => expect(screen.getByText('Pour le fun')).toBeInTheDocument());
  expect(screen.queryByText('Pour de vrai')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `cd <worktree>\frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ResultsToRecord.test.tsx`
Expected: FAIL — « Unable to find an element with the text: Pour le fun »

- [ ] **Step 3: Renommer la chip dans le composant**

Dans `frontend/components/match/ResultsToRecord.tsx`, remplacer :

```tsx
              {m.competitive === false && <Chip tone="line">Amicale</Chip>}
```

par :

```tsx
              {m.competitive === false && <Chip tone="line">Pour le fun</Chip>}
```

- [ ] **Step 4: Vérifier que la suite passe**

Run: `cd <worktree>\frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ResultsToRecord.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/__tests__/ResultsToRecord.test.tsx frontend/components/match/ResultsToRecord.tsx
git commit -m "feat(parties): renomme la chip de type dans ResultsToRecord"
```

---

### Task 8: Finitions — commentaire api.ts, note CLAUDE.md, validation globale

**Files:**
- Modify: `frontend/lib/api.ts` (commentaire du champ `competitive` du type `OpenMatch`, ~ligne 1674 à HEAD)
- Modify: `CLAUDE.md` (note d'évolution sous la section « Parties Amicale / Compétitive (v1) »)

- [ ] **Step 1: Mettre à jour le commentaire dans api.ts**

Dans `frontend/lib/api.ts`, remplacer :

```ts
  competitive?: boolean; // Amicale (false) / Compétitive (true) ; défaut true si absent
```

par :

```ts
  competitive?: boolean; // Pour le fun (false) / Pour de vrai (true) ; défaut true si absent
```

- [ ] **Step 2: Ajouter la note d'évolution dans CLAUDE.md**

Dans `CLAUDE.md`, section « ## Parties Amicale / Compétitive (v1) ✅ implémenté », insérer un nouveau paragraphe blockquote juste APRÈS le blockquote existant « **Évolution (2026-07-16) — « Résultats à saisir » compacts… » (qui se termine par « Spec & plan : `docs/superpowers/{specs,plans}/2026-07-16-resultats-a-saisir-compact*`. ») :

```markdown
> **Évolution (2026-07-21) — renommage « Pour de vrai / Pour le fun » :** les libellés joueurs « Compétitive / Amicale » deviennent **« Pour de vrai » / « Pour le fun »** partout (inspiré du passage de Pista à « Partie classée / Partie loisir » — on garde la clarté de la conséquence sans reprendre leurs mots ; la pédagogie reste portée par les sous-titres « Compte pour le niveau » / « Le niveau ne bouge pas », conservés tels quels). **100 % frontend, 7 composants + tests** (`OpenMatchQuickSwitch`, `OpenMatchToggle`, `OpenMatchCard`, `MatchesFilterBar` + intégration `OpenMatches`, `MatchResultModal`, `MyMatchesList`, `ResultsToRecord`) ; le champ API `competitive`, le défaut (`true`), le verrouillage à la saisie et le gate Glicko backend sont **inchangés** (les commentaires backend parlant d'« amicale » restent valides — vocabulaire interne non affiché). Spec : `docs/superpowers/specs/2026-07-21-renommage-pour-de-vrai-pour-le-fun-design.md`.
```

- [ ] **Step 3: Lancer les 8 suites du périmètre ensemble**

Run: `cd <worktree>\frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchQuickSwitch.test.tsx __tests__/OpenMatchToggle.test.tsx __tests__/OpenMatchCard.test.tsx __tests__/MatchesFilterBar.test.tsx __tests__/OpenMatches.test.tsx __tests__/MatchResultModal.test.tsx __tests__/MyMatchesList.test.tsx __tests__/ResultsToRecord.test.tsx`
Expected: PASS — 8 suites vertes

- [ ] **Step 4: Type-check (jest ne type-vérifie pas)**

Run: `cd <worktree>\frontend; node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune erreur (un renommage de littéraux ne peut pas en produire ; toute erreur qui apparaît est à investiguer avant de conclure)

- [ ] **Step 5: Contrôle d'exhaustivité — plus aucune occurrence utilisateur**

Run: `cd <worktree>; git grep -inE "amical|compétiti" -- frontend`
Expected: **aucun résultat** (motif insensible à la casse qui attrape aussi « AMICALE », « amical », « compétitif/compétitives » — composants, tests et commentaire api.ts tous renommés). Les occurrences backend (commentaires/tests de `match.service` et `reservation.service`) sont hors périmètre et ne doivent PAS être touchées.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/api.ts CLAUDE.md
git commit -m "docs(parties): commentaire api.ts + note CLAUDE.md pour le renommage"
```

---

### Task 9: Vérification visuelle (CDP)

- [ ] **Step 1: Vérifier visuellement sur la stack de dev**

Via la skill `verify` (Chrome headless + CDP, session `test@palova.fr`), sur `/parties` du club seedé (`padel-arena-paris.localhost:3000`) : badges « Pour de vrai » (accent) / « Pour le fun » (neutre) lisibles sur les cartes, chips de filtre « Toutes · Pour de vrai · Pour le fun » sans débordement horizontal — clair + sombre, 390 (⚠️ `mobile:false` + largeur fixe, sinon l'émulation masque le débordement) + 1280.

Si la stack de dev tourne sur l'arbre principal (WIP) et pas sur le worktree, faire cette vérification **après le merge** sur la stack principale — la noter alors explicitement comme reste-à-faire dans le message de fin.

- [ ] **Step 2: Fin de branche**

Utiliser la skill `superpowers:finishing-a-development-branch` (merge vers `feat/seo-referencement` ou PR, au choix d'Eric — ⚠️ ne pas merger aveuglément si le WIP « validation de match » a committé entre-temps des changements sur les mêmes fichiers : relire le diff du merge).
