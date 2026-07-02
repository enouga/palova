# MatchTeams « mini-terrain » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refondre le bloc d'équipes padel en mini-terrain vu de dessus (4 places précises G/D), avec noms abrégés « Prénom N. » en étroit, feuille d'actions au tap sur un joueur, feuille d'ajout de joueur (recherche + amis), et rangée « Mes amis » redessinée.

**Architecture:** Frontend uniquement, aucune migration. `MatchTeams.tsx` est réécrit (présentation terrain + détection étroit + feuille d'actions interne) en gardant ses props (ajouts optionnels : `onAddToTeam(team, slot?)`, `activeTarget`). Deux nouvelles feuilles (`PlayerActionSheet`, `AddPlayerSheet`) partagent un chrome `SheetShell` (bottom-sheet mobile / dialogue centré desktop). Les 3 surfaces éditables (ReservationPlayersInline, OpenMatchCard, BookingModal) remplacent leur `PartnerSearch` inline par `AddPlayerSheet` sur le chemin padel ; `PartnerSearch` reste intact pour les tournois et le non-padel.

**Tech Stack:** Next.js 16 / React 19, styles inline + `lib/theme.ts`, jest + React Testing Library (⚠️ ts-jest ne type-vérifie pas → `tsc --noEmit` en garde finale).

**Specs:** `docs/superpowers/specs/2026-07-02-matchteams-terrain-redesign-design.md` + `docs/superpowers/specs/2026-07-02-matchteams-noms-abreges-design.md`.

**Conventions repo à respecter :**
- Tous les tests se lancent depuis `frontend/` : `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend`.
- Ne jamais lancer la full-suite pour valider (flake BookingModal connu) — suites scoped + `npx tsc --noEmit`.
- Commits : un par tâche, ajouter uniquement les fichiers de la tâche (l'utilisateur a du WIP parallèle dans l'arbre). Vérifier `git branch --show-current` = `main` avant chaque commit.
- Apostrophes françaises dans du texte JSX : passer par une expression string (`{`Passer dans l'équipe ${n}`}`) pour éviter react/no-unescaped-entities.

---

### Task 1: Helper pur `shortNamesById` (noms abrégés)

**Files:**
- Create: `frontend/lib/names.ts`
- Test: `frontend/__tests__/names.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/__tests__/names.test.ts
import { shortNamesById } from '@/lib/names';

describe('shortNamesById', () => {
  it('rend « Prénom N. »', () => {
    expect(shortNamesById([{ id: 'a', firstName: 'Adam', lastName: 'Bernard' }]))
      .toEqual({ a: 'Adam B.' });
  });

  it('nom vide → prénom seul', () => {
    expect(shortNamesById([{ id: 'a', firstName: 'Adam', lastName: '' }]))
      .toEqual({ a: 'Adam' });
  });

  it('nom d'une seule lettre → nom complet (aussi court que l'abréviation)', () => {
    expect(shortNamesById([{ id: 'a', firstName: 'Marc', lastName: 'A' }]))
      .toEqual({ a: 'Marc A' });
  });

  it('collision → initiales allongées, les non-collidants restent à 1 lettre', () => {
    expect(shortNamesById([
      { id: 'a', firstName: 'Adam', lastName: 'Bernard' },
      { id: 'b', firstName: 'Adam', lastName: 'Bonnet' },
      { id: 'c', firstName: 'Ines', lastName: 'Andre' },
    ])).toEqual({ a: 'Adam Be.', b: 'Adam Bo.', c: 'Ines A.' });
  });

  it('prénom + nom identiques → nom complet (rendu identique accepté)', () => {
    expect(shortNamesById([
      { id: 'a', firstName: 'Adam', lastName: 'Bernard' },
      { id: 'b', firstName: 'Adam', lastName: 'Bernard' },
    ])).toEqual({ a: 'Adam Bernard', b: 'Adam Bernard' });
  });

  it('nom composé : initiale = 1er caractère majusculé, préfixe de collision sans espaces', () => {
    expect(shortNamesById([{ id: 'a', firstName: 'Jean', lastName: 'de la Fuente' }]))
      .toEqual({ a: 'Jean D.' });
    expect(shortNamesById([
      { id: 'a', firstName: 'Jean', lastName: 'de la Fuente' },
      { id: 'b', firstName: 'Jean', lastName: 'Dupont' },
    ])).toEqual({ a: 'Jean De.', b: 'Jean Du.' });
  });
});
```

⚠️ Les apostrophes dans les libellés `it('nom d'une seule lettre …')` doivent être échappées (`\'`) ou le libellé mis entre guillemets doubles.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/names.test.ts`
Expected: FAIL — `Cannot find module '@/lib/names'`

- [ ] **Step 3: Write the implementation**

```ts
// frontend/lib/names.ts
// Rendus de nom courts « Prénom N. » avec désambiguïsation par lot
// (spec 2026-07-02-matchteams-noms-abreges). Pur, sans dépendance UI —
// réutilisable au-delà de MatchTeams (PlayerPills plus tard).

export interface NamedPlayer {
  id: string;
  firstName: string;
  lastName: string;
}

// Préfixe de collision : nom débarrassé des espaces, coupé à n caractères,
// première lettre majusculée (« de la Fuente », n=2 → « De »).
function prefix(lastName: string, n: number): string {
  const compact = lastName.replace(/\s+/g, '');
  const p = compact.slice(0, n);
  return p.charAt(0).toUpperCase() + p.slice(1);
}

// « Prénom N. » pour chaque joueur. En cas de collision entre rendus, l'initiale
// s'allonge d'un caractère — seulement pour les joueurs en collision — jusqu'à
// distinction ; nom épuisé → nom complet (deux homonymes complets restent identiques).
export function shortNamesById(players: NamedPlayer[]): Record<string, string> {
  const lens = new Map<string, number>(players.map((p) => [p.id, 1]));
  const label = (p: NamedPlayer): string => {
    const compact = p.lastName.replace(/\s+/g, '');
    if (!compact) return p.firstName;
    const n = lens.get(p.id)!;
    if (n >= compact.length) return `${p.firstName} ${p.lastName}`.trim();
    return `${p.firstName} ${prefix(p.lastName, n)}.`;
  };
  // Boucle bornée : chaque tour allonge d'au moins 1 les joueurs en collision.
  for (let guard = 0; guard < 40; guard++) {
    const byLabel = new Map<string, NamedPlayer[]>();
    for (const p of players) {
      const l = label(p);
      byLabel.set(l, [...(byLabel.get(l) ?? []), p]);
    }
    let changed = false;
    for (const group of byLabel.values()) {
      if (group.length < 2) continue;
      for (const p of group) {
        const compact = p.lastName.replace(/\s+/g, '');
        const n = lens.get(p.id)!;
        if (n < compact.length) { lens.set(p.id, n + 1); changed = true; }
      }
    }
    if (!changed) break;
  }
  return Object.fromEntries(players.map((p) => [p.id, label(p)]));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/names.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```powershell
git add frontend/lib/names.ts frontend/__tests__/names.test.ts
git commit -m "feat(match): helper shortNamesById — noms abrégés « Prénom N. » désambiguïsés"
```

---

### Task 2: `.sp-scroll-x` (CSS) + FriendsQuickRow redessinée

**Files:**
- Modify: `frontend/app/globals.css` (après les `@keyframes sp-*`, ~l.68)
- Modify: `frontend/components/social/FriendsQuickRow.tsx` (réécriture du rendu)
- Test: `frontend/__tests__/FriendsQuickRow.test.tsx` (ajouts)

- [ ] **Step 1: Add the failing test cases**

Ajouter à la fin du `describe` de `frontend/__tests__/FriendsQuickRow.test.tsx` (les 2 tests existants restent inchangés — le mock `th` doit gagner `textFaint: '#999'` et `lineStrong: '#bbb'` s'il ne les a pas) :

```tsx
  it('rend la rangée en avatars : prénom sous l'avatar, défilement sans barre (.sp-scroll-x)', async () => {
    listClubFriends.mockResolvedValue([
      { id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, level: null, mutual: true },
    ]);
    const { container } = render(<FriendsQuickRow slug="demo" token="t" excludeIds={[]} onPick={jest.fn()} />);
    await screen.findByRole('button', { name: /léa/i });
    expect(container.querySelector('.sp-scroll-x')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify the new case fails**

Run: `npx jest __tests__/FriendsQuickRow.test.tsx`
Expected: FAIL sur le nouveau cas (`.sp-scroll-x` introuvable), les 2 anciens PASS.

- [ ] **Step 3: Add the CSS utility**

Dans `frontend/app/globals.css`, après la ligne `@keyframes sp-sheet-in-top …` (l.68) :

```css
/* Rangée défilante sans barre visible (FriendsQuickRow, feuilles de match) */
.sp-scroll-x { overflow-x: auto; scrollbar-width: none; -ms-overflow-style: none; }
.sp-scroll-x::-webkit-scrollbar { display: none; }
```

- [ ] **Step 4: Rewrite the row rendering**

Remplacer intégralement le `return` de `FriendsQuickRow` (et sa signature — ajout de la prop optionnelle `fadeColor`) :

```tsx
// Rangée « Mes amis » : avatars en colonne (niveau accroché sous l'avatar, prénom dessous),
// ajout en un tap. Barre de défilement masquée (.sp-scroll-x) + fondu sur le bord droit.
// Filtre par `query` (optionnel) et masque `excludeIds` (déjà ajoutés). Rien si liste vide.
export function FriendsQuickRow({ slug, token, excludeIds, query, onPick, fadeColor }: {
  slug: string;
  token: string;
  excludeIds: string[];
  query?: string;
  onPick: (friend: Friend) => void;
  /** Couleur du fondu de débordement = fond du conteneur hôte (défaut th.surface). */
  fadeColor?: string;
}) {
  const { th } = useTheme();
  const [friends, setFriends] = useState<Friend[]>([]);

  useEffect(() => {
    let alive = true;
    api.listClubFriends(slug, token).then((fs) => { if (alive) setFriends(fs); }).catch(() => {});
    return () => { alive = false; };
  }, [slug, token]);

  const q = (query ?? '').trim().toLowerCase();
  const visible = friends.filter((f) =>
    !excludeIds.includes(f.id) &&
    (!q || `${f.firstName} ${f.lastName}`.toLowerCase().includes(q)));

  if (visible.length === 0) return null;

  const fade = fadeColor ?? th.surface;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Mes amis</div>
      <div style={{ position: 'relative' }}>
        <div className="sp-scroll-x" style={{ display: 'flex', gap: 8, paddingBottom: 6 }}>
          {visible.map((f) => (
            <button key={f.id} type="button"
              // preventDefault sur mousedown : garde le focus de l'input pour que le dropdown ne se
              // ferme pas avant le clic (même robustesse que la liste de résultats de PartnerSearch).
              onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(f)}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, width: 56, flexShrink: 0, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}>
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <Avatar firstName={f.firstName} lastName={f.lastName} avatarUrl={f.avatarUrl} size={40} color={colorForSeed(f.id)} />
                {f.level && (
                  <span style={{ position: 'absolute', bottom: -5, left: '50%', transform: 'translateX(-50%)' }}>
                    <LevelChip level={f.level} size="xs" />
                  </span>
                )}
              </span>
              <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, color: th.text, maxWidth: 56, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 4 }}>{f.firstName}</span>
            </button>
          ))}
        </div>
        <div aria-hidden="true" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 28, background: `linear-gradient(90deg, ${fade}00, ${fade})`, pointerEvents: 'none' }} />
      </div>
    </div>
  );
}
```

(Imports inchangés : `Avatar`, `LevelChip`, `colorForSeed`, `api`, `Friend`, `useTheme`.)

- [ ] **Step 5: Run the suites**

Run: `npx jest __tests__/FriendsQuickRow.test.tsx __tests__/PartnerSearch.friends.test.tsx`
Expected: PASS (le dropdown PartnerSearch monte la nouvelle rangée ; le pick par « Léa » marche toujours — le nom accessible du bouton contient le prénom).

- [ ] **Step 6: Commit**

```powershell
git add frontend/app/globals.css frontend/components/social/FriendsQuickRow.tsx frontend/__tests__/FriendsQuickRow.test.tsx
git commit -m "feat(social): FriendsQuickRow en rangée d'avatars, scrollbar masquée + fondu"
```

---

### Task 3: Chrome partagé `SheetShell`

**Files:**
- Create: `frontend/components/ui/SheetShell.tsx`
- Test: `frontend/__tests__/SheetShell.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/__tests__/SheetShell.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { SheetShell } from '@/components/ui/SheetShell';

describe('SheetShell', () => {
  it('rend un dialogue avec son contenu', () => {
    render(<ThemeProvider><SheetShell onClose={jest.fn()} label="Ma feuille"><p>Contenu</p></SheetShell></ThemeProvider>);
    expect(screen.getByRole('dialog', { name: 'Ma feuille' })).toBeInTheDocument();
    expect(screen.getByText('Contenu')).toBeInTheDocument();
  });

  it('ferme sur Échap et sur clic overlay', () => {
    const onClose = jest.fn();
    const { container } = render(
      <ThemeProvider><SheetShell onClose={onClose} label="Ma feuille"><p>Contenu</p></SheetShell></ThemeProvider>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('[data-overlay]')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/SheetShell.test.tsx`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Write the implementation**

```tsx
// frontend/components/ui/SheetShell.tsx
'use client';
import { useEffect } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { useIsDesktop } from '@/lib/useIsDesktop';

// Chrome partagé des feuilles de match : bottom-sheet pleine largeur en mobile,
// dialogue centré (~420px) en desktop. Ferme sur clic overlay et Échap.
export function SheetShell({ onClose, label, children }: {
  onClose: () => void;
  /** aria-label du dialogue. */
  label: string;
  children: React.ReactNode;
}) {
  const { th } = useTheme();
  const isDesktop = useIsDesktop();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 120, display: 'flex', flexDirection: 'column', justifyContent: isDesktop ? 'center' : 'flex-end', alignItems: isDesktop ? 'center' : 'stretch' }}>
      <div data-overlay onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', animation: 'sp-fade .25s ease' }} />
      <div role="dialog" aria-modal="true" aria-label={label}
        style={{ position: 'relative', width: isDesktop ? 'min(420px, 92vw)' : '100%', boxSizing: 'border-box', maxHeight: '85dvh', overflowY: 'auto', background: th.bgElev,
          borderRadius: isDesktop ? 18 : '18px 18px 0 0', boxShadow: '0 -8px 40px rgba(0,0,0,0.3)',
          animation: isDesktop ? 'sp-fade .2s ease' : 'sp-sheet-in .3s cubic-bezier(.2,.8,.2,1)', padding: '8px 14px 14px' }}>
        {!isDesktop && <div aria-hidden="true" style={{ width: 36, height: 4, borderRadius: 999, background: th.lineStrong, margin: '2px auto 10px' }} />}
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/SheetShell.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add frontend/components/ui/SheetShell.tsx frontend/__tests__/SheetShell.test.tsx
git commit -m "feat(ui): SheetShell — chrome bottom-sheet mobile / dialogue centré desktop"
```

---

### Task 4: `PlayerActionSheet` (feuille d'actions d'un joueur)

**Files:**
- Create: `frontend/components/match/PlayerActionSheet.tsx`
- Test: `frontend/__tests__/PlayerActionSheet.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/__tests__/PlayerActionSheet.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { PlayerActionSheet } from '@/components/match/PlayerActionSheet';

const player = { userId: 'u1', firstName: 'Karim', lastName: 'Benali', team: 2 as const };

const base = {
  player, playerName: 'Karim Benali', slotLabel: 'G', teamColor: '#ff7a4d', team: 2 as const,
  canMove: true, canReplace: true, canRemove: true,
  onMove: jest.fn(), onReplace: jest.fn(), onRemove: jest.fn(), onClose: jest.fn(),
};

const wrap = (over = {}) => render(<ThemeProvider><PlayerActionSheet {...base} {...over} /></ThemeProvider>);

describe('PlayerActionSheet', () => {
  beforeEach(() => jest.clearAllMocks());

  it('affiche l'identité, la chip d'équipe et les 3 actions', () => {
    wrap();
    expect(screen.getByText('Karim Benali')).toBeInTheDocument();
    expect(screen.getByText(/ÉQ\. 2 · G/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Passer dans l'équipe 1/ }));
    expect(base.onMove).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Remplacer par un autre joueur/ }));
    expect(base.onReplace).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Retirer de la partie/ }));
    expect(base.onRemove).toHaveBeenCalled();
  });

  it('masque les actions non permises (organisateur : pas de retrait/remplacement)', () => {
    wrap({ canReplace: false, canRemove: false });
    expect(screen.getByRole('button', { name: /Passer dans l'équipe 1/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remplacer/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retirer de la partie/ })).not.toBeInTheDocument();
  });

  it('« Annuler » ferme la feuille', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(base.onClose).toHaveBeenCalled();
  });
});
```

(Échapper les apostrophes des libellés `it(...)`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/PlayerActionSheet.test.tsx`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Write the implementation**

```tsx
// frontend/components/match/PlayerActionSheet.tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';
import { SheetShell } from '@/components/ui/SheetShell';
import type { MatchPlayerData } from '@/components/match/MatchTeams';

// Feuille d'actions d'un joueur du mini-terrain (déplacer / remplacer / retirer,
// en toutes lettres). Rendue par MatchTeams au tap sur un joueur en mode editable.
export function PlayerActionSheet({ player, playerName, slotLabel, teamColor, team, busy = false, canMove, canReplace, canRemove, onMove, onReplace, onRemove, onClose }: {
  player: MatchPlayerData;
  playerName: string;
  slotLabel?: string;
  teamColor: string;
  team: 1 | 2;
  busy?: boolean;
  canMove: boolean;
  canReplace: boolean;
  canRemove: boolean;
  onMove: () => void;
  onReplace: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { th } = useTheme();
  const other = team === 1 ? 2 : 1;
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', border: 'none', background: 'transparent', borderRadius: 11, padding: '12px 10px', fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 600, color: th.text, cursor: busy ? 'default' : 'pointer' };
  return (
    <SheetShell onClose={onClose} label={`Actions pour ${playerName}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px 8px' }}>
        <Avatar firstName={player.firstName} lastName={player.lastName} avatarUrl={player.avatarUrl ?? null} size={30} color={colorForSeed(player.userId)} />
        <span style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 800, color: th.text }}>{playerName}</span>
        <LevelChip level={player.level} size="xs" />
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, background: `${teamColor}22`, borderRadius: 999, padding: '3px 10px', fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.3, color: th.text, whiteSpace: 'nowrap' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: teamColor, flexShrink: 0 }} />
          {`ÉQ. ${team}${slotLabel ? ` · ${slotLabel}` : ''}`}
        </span>
      </div>
      <div aria-hidden="true" style={{ height: 1, background: th.line, marginBottom: 4 }} />
      {canMove && (
        <button type="button" disabled={busy} style={row} onClick={onMove}>
          <span style={{ display: 'inline-flex', transform: team === 2 ? 'scaleX(-1)' : undefined }}><Icon name="arrowR" size={17} color={th.textMute} /></span>
          {`Passer dans l'équipe ${other}`}
        </button>
      )}
      {canReplace && (
        <button type="button" disabled={busy} style={row} onClick={onReplace}>
          <Icon name="search" size={16} color={th.textMute} />
          Remplacer par un autre joueur
        </button>
      )}
      {canRemove && (
        <button type="button" disabled={busy} style={{ ...row, color: ACCENTS.coral }} onClick={onRemove}>
          <Icon name="x" size={17} color={ACCENTS.coral} />
          Retirer de la partie
        </button>
      )}
      <button type="button" style={{ ...row, justifyContent: 'center', color: th.textMute }} onClick={onClose}>Annuler</button>
    </SheetShell>
  );
}
```

Note : l'import `type { MatchPlayerData }` depuis MatchTeams est type-only → pas de cycle à l'exécution (MatchTeams importera PlayerActionSheet en Task 5).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/PlayerActionSheet.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add frontend/components/match/PlayerActionSheet.tsx frontend/__tests__/PlayerActionSheet.test.tsx
git commit -m "feat(match): PlayerActionSheet — actions joueur en feuille (déplacer/remplacer/retirer)"
```

---

### Task 5: Réécriture de `MatchTeams` en mini-terrain

**Files:**
- Rewrite: `frontend/components/match/MatchTeams.tsx`
- Rewrite: `frontend/__tests__/MatchTeams.test.tsx`

- [ ] **Step 1: Rewrite the test file (failing)**

```tsx
// frontend/__tests__/MatchTeams.test.tsx
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { MatchTeams, MatchPlayerData } from '@/components/match/MatchTeams';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

const players: MatchPlayerData[] = [
  { userId: 'a', firstName: 'Marc', lastName: 'A', isOrganizer: true, team: 1 },
  { userId: 'b', firstName: 'Paul', lastName: 'B', team: 1 },
  { userId: 'c', firstName: 'Lea',  lastName: 'C', team: 2 },
];

describe('MatchTeams (mini-terrain)', () => {
  it('rend le terrain : deux équipes, VS, noms complets (large par défaut)', () => {
    wrap(<MatchTeams players={players} capacity={4} />);
    expect(screen.getByText('VS')).toBeInTheDocument();
    expect(screen.getByText('Équipe 1')).toBeInTheDocument();
    expect(screen.getByText('Équipe 2')).toBeInTheDocument();
    expect(screen.getByText('Marc A')).toBeInTheDocument();
    expect(screen.getByText('Lea C')).toBeInTheDocument();
  });

  it('lecture seule : « Place libre » sur les places vides, aucun bouton', () => {
    wrap(<MatchTeams players={players} capacity={4} />);
    expect(screen.getAllByText('Place libre')).toHaveLength(1);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('affiche le repère G (1er) / D (2e) par équipe en double, places vides comprises', () => {
    wrap(<MatchTeams players={players} capacity={4} />);
    // team1: Marc=G, Paul=D ; team2: Lea=G + place vide D → 2×G, 2×D
    expect(screen.getAllByText('G')).toHaveLength(2);
    expect(screen.getAllByText('D')).toHaveLength(2);
  });

  it('editable : tap joueur → feuille → « Passer dans l'équipe 2 » émet la map', () => {
    const onSetTeams = jest.fn();
    wrap(<MatchTeams players={players} capacity={4} editable onSetTeams={onSetTeams} />);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Marc A' }));
    fireEvent.click(screen.getByRole('button', { name: /Passer dans l'équipe 2/ }));
    expect(onSetTeams).toHaveBeenCalledWith({ a: 2, b: 1, c: 2 });
    // La feuille se referme après l'action.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('editable : la feuille propose Remplacer / Retirer pour un non-organisateur', () => {
    const onReplace = jest.fn(), onRemove = jest.fn();
    wrap(<MatchTeams players={players} capacity={4} editable onReplace={onReplace} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Paul B' }));
    fireEvent.click(screen.getByRole('button', { name: /Remplacer par un autre joueur/ }));
    expect(onReplace).toHaveBeenCalledWith(expect.objectContaining({ userId: 'b' }));
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Paul B' }));
    fireEvent.click(screen.getByRole('button', { name: /Retirer de la partie/ }));
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ userId: 'b' }));
  });

  it('editable : la feuille de l'organisateur n'a ni Retirer ni Remplacer (défauts)', () => {
    wrap(<MatchTeams players={players} capacity={4} editable onReplace={jest.fn()} onRemove={jest.fn()} onSetTeams={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Marc A' }));
    expect(screen.queryByRole('button', { name: /Retirer de la partie/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remplacer/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Passer dans l'équipe 2/ })).toBeInTheDocument();
  });

  it('editable : un « + » par place libre appelle onAddToTeam(côté, emplacement)', () => {
    const onAddToTeam = jest.fn();
    wrap(<MatchTeams players={players} capacity={4} editable onAddToTeam={onAddToTeam} />);
    fireEvent.click(screen.getByRole('button', { name: /Ajouter un joueur à l'équipe 2/ }));
    expect(onAddToTeam).toHaveBeenCalledWith(2, 1);
  });

  it('retirer le joueur de gauche laisse le droit à droite (emplacements fixes)', () => {
    const A: MatchPlayerData = { userId: 'a', firstName: 'Marc', lastName: 'A', team: 1 };
    const B: MatchPlayerData = { userId: 'b', firstName: 'Paul', lastName: 'B', team: 1 };
    const View = ({ pl }: { pl: MatchPlayerData[] }) => (
      <ThemeProvider><MatchTeams players={pl} capacity={4} onSetTeams={jest.fn()} /></ThemeProvider>
    );
    const { rerender } = render(<View pl={[A, B]} />);
    expect(screen.getByText('Paul B').closest('[data-player-slot]')).toHaveAttribute('data-player-slot', 'D');
    rerender(<View pl={[B]} />);
    expect(screen.getByText('Paul B').closest('[data-player-slot]')).toHaveAttribute('data-player-slot', 'D');
    expect(screen.queryByText('Marc A')).not.toBeInTheDocument();
  });

  it('étroit (ResizeObserver) : noms « Prénom N. », nom complet en title', () => {
    type ROEntry = { contentRect: { width: number } };
    let cb: ((entries: ROEntry[]) => void) | null = null;
    class ROCapture {
      constructor(fn: (entries: ROEntry[]) => void) { cb = fn; }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    const prev = global.ResizeObserver;
    // @ts-expect-error stub de test piloté
    global.ResizeObserver = ROCapture;
    try {
      const pl: MatchPlayerData[] = [
        { userId: 'a', firstName: 'Adam', lastName: 'Bernard', team: 1 },
        { userId: 'b', firstName: 'Karim', lastName: 'Benali', team: 2 },
      ];
      wrap(<MatchTeams players={pl} capacity={4} />);
      expect(screen.getByText('Adam Bernard')).toBeInTheDocument();
      act(() => cb?.([{ contentRect: { width: 300 } }]));
      expect(screen.getByText('Adam B.')).toBeInTheDocument();
      expect(screen.getByText('Adam B.')).toHaveAttribute('title', 'Adam Bernard');
      // Repasse en large → noms complets.
      act(() => cb?.([{ contentRect: { width: 600 } }]));
      expect(screen.getByText('Adam Bernard')).toBeInTheDocument();
    } finally {
      global.ResizeObserver = prev;
    }
  });
});
```

(Échapper les apostrophes des libellés `it(...)`.)

- [ ] **Step 2: Run to verify the new expectations fail**

Run: `npx jest __tests__/MatchTeams.test.tsx`
Expected: FAIL (ancienne implémentation : pas de « Modifier … », pas d'« Équipe 1 » etc.)

- [ ] **Step 3: Rewrite the component**

Remplacer intégralement `frontend/components/match/MatchTeams.tsx` :

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, inkOn } from '@/lib/theme';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { UserLevel } from '@/lib/api';
import { LevelChip } from '@/components/player/LevelChip';
import { shortNamesById } from '@/lib/names';
import { PlayerActionSheet } from '@/components/match/PlayerActionSheet';

export interface MatchPlayerData {
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  isOrganizer?: boolean;
  participantId?: string;
  level?: UserLevel | null;
  team: 1 | 2;
}

// Couleurs d'équipe (Éq.1 bleu / Éq.2 corail) — partagées avec les feuilles d'ajout/actions.
export const SIDE_COLOR: Record<1 | 2, string> = { 1: ACCENTS.blue, 2: ACCENTS.coral };
export const SLOT_LABELS = ['G', 'D'] as const;
// Sous cette largeur (px) du composant, les noms passent en « Prénom N. » (spec noms abrégés).
export const NARROW_WIDTH = 380;

// Mini-terrain de padel vu de dessus (spec 2026-07-02) : deux moitiés teintées côte à côte,
// filet central pointillé + badge VS, chaque quadrant = une place précise (G = 1er, D = 2e).
// Emplacements FIXES par équipe, mémorisés pendant la session (ref, aucun backend) : retirer
// le joueur de gauche laisse un trou à gauche et le droit reste à droite.
// En `editable`, un tap sur un joueur ouvre une feuille d'actions (déplacer / remplacer /
// retirer) ; chaque place libre est un « + » d'ajout ciblé → `onAddToTeam(team, slot)`.
export function MatchTeams({
  players, capacity, friendIds, size = 'md', busy = false,
  onRemove, canRemove, onReplace, canReplace, onAddToTeam, editable = false, onSetTeams,
  activeTarget,
}: {
  players: MatchPlayerData[];
  capacity: number;
  friendIds?: Set<string>;
  size?: 'sm' | 'md';
  busy?: boolean;
  onRemove?: (player: MatchPlayerData) => void;
  canRemove?: (player: MatchPlayerData) => boolean;
  onReplace?: (player: MatchPlayerData) => void;
  canReplace?: (player: MatchPlayerData) => boolean;
  /** Tap sur une place libre : côté + emplacement visé (0=G, 1=D). */
  onAddToTeam?: (team: 1 | 2, slot?: number) => void;
  editable?: boolean;
  onSetTeams?: (teamsByUserId: Record<string, 1 | 2>) => void;
  /** Place visée par la feuille d'ajout ouverte → reste en surbrillance. */
  activeTarget?: { team: 1 | 2; slot?: number } | null;
}) {
  const { th } = useTheme();
  const av = size === 'sm' ? 34 : 38;
  const fs = size === 'sm' ? 12 : 12.5;
  const half = Math.max(1, Math.floor(capacity / 2));
  const showGD = half >= 2;               // repère Gauche/Droite seulement en double
  const canMove = editable && !!onSetTeams;

  // Étroit → noms « Prénom N. » (mesure du conteneur, pas du viewport ; 1er rendu = large,
  // hydration-safe, et le stub jsdom neutre laisse les tests en noms complets).
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width ?? 0;
      // setState seulement au franchissement du seuil (identité conservée sinon).
      setNarrow((prev) => { const next = w > 0 && w < NARROW_WIDTH; return next === prev ? prev : next; });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shortNames = narrow
    ? shortNamesById(players.map((p) => ({ id: p.userId, firstName: p.firstName, lastName: p.lastName })))
    : null;
  const fullName = (p: MatchPlayerData) => `${p.firstName} ${p.lastName}`;
  const displayName = (p: MatchPlayerData) => shortNames?.[p.userId] ?? fullName(p);

  // Position mémorisée par joueur (équipe + emplacement), stable sur la session.
  const posRef = useRef<Record<string, { team: 1 | 2; slot: number }>>({});

  // Layout : chaque équipe = `half` emplacements. On honore d'abord la position mémorisée,
  // puis on place les nouveaux au 1er emplacement libre — d'où la stabilité au retrait.
  const layout: Record<1 | 2, (MatchPlayerData | null)[]> = {
    1: new Array<MatchPlayerData | null>(half).fill(null),
    2: new Array<MatchPlayerData | null>(half).fill(null),
  };
  for (const p of players) {
    const rem = posRef.current[p.userId];
    if (rem && rem.team === p.team && rem.slot < half && layout[p.team][rem.slot] === null) {
      layout[p.team][rem.slot] = p;
    }
  }
  for (const p of players) {
    if (layout[1].includes(p) || layout[2].includes(p)) continue;
    const arr = layout[p.team];
    let slot = arr.findIndex((s) => s === null);
    if (slot < 0) slot = 0;
    arr[slot] = p;
    posRef.current[p.userId] = { team: p.team, slot };
  }

  const currentTeams = (): Record<string, 1 | 2> =>
    Object.fromEntries(players.map((p) => [p.userId, p.team]));

  // Déplace le joueur dans l'autre équipe : place libre → déplacement (même emplacement si
  // libre) ; sinon échange avec le joueur du même emplacement en face. Émet la map complète.
  const onMove = (p: MatchPlayerData) => {
    if (busy) return;
    const target: 1 | 2 = p.team === 1 ? 2 : 1;
    const pSlot = layout[p.team].indexOf(p);
    const next = currentTeams();
    const freeInTarget = layout[target].findIndex((s) => s === null);
    if (freeInTarget >= 0) {
      const dest = layout[target][pSlot] === null ? pSlot : freeInTarget;
      next[p.userId] = target;
      posRef.current[p.userId] = { team: target, slot: dest };
    } else {
      const opp = layout[target][pSlot];
      next[p.userId] = target;
      posRef.current[p.userId] = { team: target, slot: pSlot };
      if (opp) { next[opp.userId] = p.team; posRef.current[opp.userId] = { team: p.team, slot: pSlot }; }
    }
    onSetTeams?.(next);
  };

  // Feuille d'actions : joueur sélectionné (re-résolu à chaque rendu — un joueur retiré
  // pendant que la feuille est ouverte la fait disparaître proprement).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? players.find((p) => p.userId === selectedId) ?? null : null;

  const repAllowed = (p: MatchPlayerData) => !!onReplace && (canReplace ? canReplace(p) : !p.isOrganizer);
  const remAllowed = (p: MatchPlayerData) => !!onRemove && (canRemove ? canRemove(p) : !p.isOrganizer);
  const hasActions = (p: MatchPlayerData) => canMove || repAllowed(p) || remAllowed(p);

  const renderPlayer = (p: MatchPlayerData, idx: number) => {
    const c = colorForSeed(p.userId);           // couleur individuelle → avatar
    const teamColor = SIDE_COLOR[p.team];       // couleur d'équipe → quadrant
    const isFriend = !!friendIds?.has(p.userId);
    const isSelected = selected?.userId === p.userId;
    const tappable = editable && hasActions(p);
    const avatar = <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl ?? null} size={av} color={c} />;
    const inner = (
      <>
        {showGD && (
          <span aria-label={idx === 0 ? 'Côté gauche' : 'Côté droit'}
            style={{ position: 'absolute', top: 6, [p.team === 1 ? 'left' : 'right']: 6, fontSize: 9, fontWeight: 800, lineHeight: 1, padding: '2px 5px', borderRadius: 5, background: teamColor, color: inkOn(teamColor), letterSpacing: 0.3 }}>
            {SLOT_LABELS[idx]}
          </span>
        )}
        {isFriend ? (
          <span title="Vous suivez ce joueur" style={{ display: 'inline-flex', borderRadius: '50%', padding: 1.5, background: th.accent }}>{avatar}</span>
        ) : avatar}
        <span title={fullName(p)} style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: th.fontUI, fontSize: fs, fontWeight: 700, color: th.text }}>
          {displayName(p)}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', justifyContent: 'center' }}>
          <LevelChip level={p.level} size="xs" />
          {p.isOrganizer && (
            <span style={{ fontSize: 9.5, fontWeight: 800, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.4, fontFamily: th.fontUI }}>orga</span>
          )}
        </span>
      </>
    );
    const cellStyle: React.CSSProperties = {
      position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      width: '100%', boxSizing: 'border-box', minWidth: 0, padding: '12px 6px 10px',
      border: 'none', background: isSelected ? `${teamColor}1c` : 'transparent', borderRadius: 12,
      outline: isSelected ? `2.5px solid ${teamColor}` : 'none', outlineOffset: -2.5,
    };
    if (!tappable) return <div data-player-slot={SLOT_LABELS[idx]} style={cellStyle}>{inner}</div>;
    return (
      <button type="button" data-player-slot={SLOT_LABELS[idx]} disabled={busy}
        aria-label={`Modifier ${fullName(p)}`} onClick={() => setSelectedId(p.userId)}
        style={{ ...cellStyle, cursor: busy ? 'default' : 'pointer', font: 'inherit' }}>
        {inner}
      </button>
    );
  };

  const renderFree = (side: 1 | 2, slotIdx: number) => {
    const teamColor = SIDE_COLOR[side];
    const isTarget = !!activeTarget && activeTarget.team === side && (activeTarget.slot == null || activeTarget.slot === slotIdx);
    const base: React.CSSProperties = {
      position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      width: '100%', boxSizing: 'border-box', padding: '12px 6px 10px', border: 'none', borderRadius: 12,
      background: isTarget ? `${teamColor}1c` : 'transparent',
      outline: isTarget ? `2px dashed ${teamColor}` : 'none', outlineOffset: -4,
      fontFamily: th.fontUI,
    };
    const badge = showGD ? (
      <span aria-hidden="true" style={{ position: 'absolute', top: 6, [side === 1 ? 'left' : 'right']: 6, fontSize: 9, fontWeight: 800, lineHeight: 1, padding: '2px 5px', borderRadius: 5, background: `${teamColor}55`, color: inkOn(teamColor), letterSpacing: 0.3 }}>
        {SLOT_LABELS[slotIdx]}
      </span>
    ) : null;
    if (editable && onAddToTeam) {
      return (
        <button type="button" disabled={busy} data-target={isTarget || undefined}
          aria-label={`Ajouter un joueur à l'équipe ${side}`}
          onClick={() => onAddToTeam(side, slotIdx)}
          style={{ ...base, cursor: busy ? 'default' : 'pointer' }}>
          {badge}
          <span aria-hidden="true" style={{ width: av, height: av, borderRadius: '50%', border: `1.5px dashed ${teamColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: teamColor, fontSize: 17, lineHeight: 1 }}>+</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: teamColor }}>Ajouter</span>
        </button>
      );
    }
    return (
      <div style={base}>
        {badge}
        <span aria-hidden="true" style={{ width: av, height: av, borderRadius: '50%', border: `1.5px dashed ${th.lineStrong}` }} />
        <span style={{ fontSize: 11.5, color: th.textFaint }}>Place libre</span>
      </div>
    );
  };

  const halfCol = (side: 1 | 2) => {
    const teamColor = SIDE_COLOR[side];
    // Dégradé léger orienté vers le filet (moitié 1 vers la droite, moitié 2 vers la gauche).
    const grad = side === 1
      ? `linear-gradient(160deg, ${teamColor}10, ${teamColor}26)`
      : `linear-gradient(200deg, ${teamColor}10, ${teamColor}26)`;
    return (
      <div style={{ flex: 1, minWidth: 0, background: grad, borderTop: `3px solid ${teamColor}`, display: 'flex', flexDirection: 'column' }}>
        {layout[side].map((p, i) => (
          <div key={p ? p.userId : `free-${side}-${i}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            {i > 0 && <div aria-hidden="true" style={{ height: 1, background: th.line, margin: '0 8px' }} />}
            {p ? renderPlayer(p, i) : renderFree(side, i)}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div ref={rootRef}>
      {/* Libellés d'équipe au-dessus du terrain */}
      <div style={{ display: 'flex', marginBottom: 6 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: SIDE_COLOR[1], flexShrink: 0 }} />
          <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 11.5, letterSpacing: 0.3, textTransform: 'uppercase', color: th.textMute }}>Équipe 1</span>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
          <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 11.5, letterSpacing: 0.3, textTransform: 'uppercase', color: th.textMute }}>Équipe 2</span>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: SIDE_COLOR[2], flexShrink: 0 }} />
        </div>
      </div>
      {/* Terrain : moitiés teintées, filet pointillé, badge VS */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'stretch', borderRadius: 14, overflow: 'hidden', border: `1px solid ${th.lineStrong}` }}>
        {halfCol(1)}
        <div aria-hidden="true" style={{ width: 0, borderLeft: `2px dashed ${th.lineStrong}` }} />
        {halfCol(2)}
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 32, height: 32, borderRadius: '50%', background: th.surface, border: `1px solid ${th.lineStrong}`, boxShadow: th.shadowSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, fontSize: 10, fontWeight: 800, color: th.textMute, letterSpacing: 0.5, pointerEvents: 'none' }}>VS</div>
      </div>
      {selected && (
        <PlayerActionSheet
          player={selected}
          playerName={fullName(selected)}
          slotLabel={showGD ? SLOT_LABELS[Math.max(0, layout[selected.team].findIndex((x) => x?.userId === selected.userId))] : undefined}
          teamColor={SIDE_COLOR[selected.team]}
          team={selected.team}
          busy={busy}
          canMove={canMove}
          canReplace={repAllowed(selected)}
          canRemove={remAllowed(selected)}
          onMove={() => { setSelectedId(null); onMove(selected); }}
          onReplace={() => { setSelectedId(null); onReplace!(selected); }}
          onRemove={() => { setSelectedId(null); onRemove!(selected); }}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the suite**

Run: `npx jest __tests__/MatchTeams.test.tsx __tests__/PlayerActionSheet.test.tsx __tests__/names.test.ts`
Expected: PASS

- [ ] **Step 5: Check the read-only consumers still pass**

Run: `npx jest __tests__/MyAgendaListItem.test.tsx __tests__/DayPanel.test.tsx __tests__/MyReservationsCalendar.test.tsx`
Expected: PASS (lecture seule : noms + « Place libre » conservés). Si un test compte les textes `G`/`D`, ajuster le compte (les places vides portent désormais un badge).

- [ ] **Step 6: Commit**

```powershell
git add frontend/components/match/MatchTeams.tsx frontend/__tests__/MatchTeams.test.tsx
git commit -m "feat(match): MatchTeams en mini-terrain — quadrants G/D, VS sur filet, noms abrégés en étroit, feuille d'actions"
```

---

### Task 6: `AddPlayerSheet` (feuille d'ajout / remplacement)

**Files:**
- Create: `frontend/components/match/AddPlayerSheet.tsx`
- Test: `frontend/__tests__/AddPlayerSheet.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/__tests__/AddPlayerSheet.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { AddPlayerSheet } from '@/components/match/AddPlayerSheet';

jest.mock('@/lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    searchClubMembers: jest.fn().mockResolvedValue([]),
    listClubFriends: jest.fn().mockResolvedValue([]),
  },
}));
import { api } from '@/lib/api';
const mocked = api as jest.Mocked<typeof api>;

const base = { slug: 'demo', token: 't', team: 2 as const, slot: 1, excludeIds: [] as string[], onPick: jest.fn(), onClose: jest.fn() };
const wrap = (over = {}) => render(<ThemeProvider><AddPlayerSheet {...base} {...over} /></ThemeProvider>);

describe('AddPlayerSheet', () => {
  beforeEach(() => jest.clearAllMocks());

  it('affiche le titre, la chip de destination « ÉQUIPE 2 · D » et la recherche', async () => {
    wrap();
    expect(screen.getByText('Ajouter un joueur')).toBeInTheDocument();
    expect(screen.getByText(/ÉQUIPE 2 · D/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Rechercher un membre/)).toBeInTheDocument();
    await waitFor(() => expect(mocked.searchClubMembers).toHaveBeenCalledWith('demo', '', 't'));
  });

  it('mode remplacement : titre « Remplacer {nom} »', () => {
    wrap({ replaceName: 'Karim B.' });
    expect(screen.getByText('Remplacer Karim B.')).toBeInTheDocument();
  });

  it('liste les membres (excludeIds filtrés) et émet onPick', async () => {
    mocked.searchClubMembers.mockResolvedValue([
      { id: 'u-new', firstName: 'New', lastName: 'Player' },
      { id: 'u-out', firstName: 'Deja', lastName: 'La' },
    ] as never);
    wrap({ excludeIds: ['u-out'] });
    fireEvent.click(await screen.findByRole('button', { name: /New Player/ }));
    expect(base.onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'u-new' }));
    expect(screen.queryByText('Deja La')).not.toBeInTheDocument();
  });

  it('la rangée « Mes amis » émet onPick', async () => {
    mocked.listClubFriends.mockResolvedValue([
      { id: 'f1', firstName: 'Léa', lastName: 'M', avatarUrl: null, level: null, mutual: true },
    ] as never);
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: /léa/i }));
    expect(base.onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }));
  });

  it('le bouton Fermer appelle onClose', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(base.onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/AddPlayerSheet.test.tsx`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Write the implementation**

```tsx
// frontend/components/match/AddPlayerSheet.tsx
'use client';
import { useEffect, useState } from 'react';
import { api, ClubMemberSearchResult, Friend, UserLevel } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';
import { FriendsQuickRow } from '@/components/social/FriendsQuickRow';
import { SheetShell } from '@/components/ui/SheetShell';
import { SIDE_COLOR, SLOT_LABELS } from '@/components/match/MatchTeams';

/** Joueur choisi dans la feuille (membre de l'annuaire ou ami). */
export interface PickedMember {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  level?: UserLevel | null;
}

// Feuille d'ajout/remplacement de joueur du mini-terrain : chip de destination colorée
// « ÉQUIPE X · G/D », recherche d'annuaire (mêmes API que PartnerSearch, qui reste
// intact pour les tournois), rangée « Mes amis », liste des membres avec bouton +.
export function AddPlayerSheet({ slug, token, team, slot, replaceName, excludeIds, busy = false, onPick, onClose }: {
  slug: string;
  token: string;
  team: 1 | 2;
  /** Emplacement visé (0=G, 1=D) — affiché dans la chip en double. */
  slot?: number;
  /** Mode remplacement : nom du joueur remplacé (sinon ajout). */
  replaceName?: string;
  excludeIds: string[];
  busy?: boolean;
  onPick: (m: PickedMember) => void;
  onClose: () => void;
}) {
  const { th } = useTheme();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ClubMemberSearchResult[]>([]);

  // Même mécanique que PartnerSearch : liste complète à vide, débounce 250 ms en saisie.
  useEffect(() => {
    const query = q.trim();
    const handle = setTimeout(() => {
      api.searchClubMembers(slug, query, token).then(setResults).catch(() => setResults([]));
    }, query ? 250 : 0);
    return () => clearTimeout(handle);
  }, [q, slug, token]);

  const visible = results.filter((m) => !excludeIds.includes(m.id));
  const teamColor = SIDE_COLOR[team];
  const slotLabel = slot != null && slot < SLOT_LABELS.length ? SLOT_LABELS[slot] : undefined;
  const title = replaceName ? `Remplacer ${replaceName}` : 'Ajouter un joueur';

  return (
    <SheetShell onClose={onClose} label={title}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '2px 2px 0' }}>
        <span style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 800, color: th.text }}>{title}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: `${teamColor}22`, borderRadius: 999, padding: '3px 10px', fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.3, color: th.text, whiteSpace: 'nowrap' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: teamColor, flexShrink: 0 }} />
          {`ÉQUIPE ${team}${slotLabel ? ` · ${slotLabel}` : ''}`}
        </span>
        <button type="button" onClick={onClose} aria-label="Fermer"
          style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 4 }}>✕</button>
      </div>
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <span aria-hidden="true" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', display: 'flex', pointerEvents: 'none' }}>
          <Icon name="search" size={17} color={th.textMute} />
        </span>
        <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus disabled={busy}
          placeholder="Rechercher un membre…"
          style={{ width: '100%', boxSizing: 'border-box', background: th.surface2, border: `1px solid ${th.line}`, borderRadius: 11, padding: '11px 13px 11px 40px', fontFamily: th.fontUI, fontSize: 14.5, color: th.text, outline: 'none' }} />
      </div>
      <FriendsQuickRow slug={slug} token={token} excludeIds={excludeIds} query={q} fadeColor={th.bgElev}
        onPick={(f: Friend) => onPick(f)} />
      <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.4, margin: '2px 0 4px' }}>Membres du club</div>
      {visible.length === 0
        ? <div style={{ padding: '10px 5px', fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>Aucun membre trouvé.</div>
        : visible.map((m) => (
            <button key={m.id} type="button" disabled={busy} onClick={() => onPick(m)}
              style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 10, padding: '8px 6px', fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
              <Avatar firstName={m.firstName} lastName={m.lastName} avatarUrl={null} size={28} color={colorForSeed(m.id)} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{m.firstName} {m.lastName}</span>
              <LevelChip level={m.level} size="xs" />
              <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: '50%', background: `${th.accent}22`, color: th.accent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>+</span>
            </button>
          ))}
    </SheetShell>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/AddPlayerSheet.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add frontend/components/match/AddPlayerSheet.tsx frontend/__tests__/AddPlayerSheet.test.tsx
git commit -m "feat(match): AddPlayerSheet — feuille d'ajout/remplacement avec destination d'équipe"
```

---

### Task 7: Câbler `ReservationPlayersInline` (calendrier)

**Files:**
- Modify: `frontend/components/reservations/ReservationPlayersInline.tsx`
- Modify: `frontend/__tests__/ReservationPlayersInline.test.tsx` (ajout de cas padel)

- [ ] **Step 1: Add failing padel tests**

Dans `frontend/__tests__/ReservationPlayersInline.test.tsx`, les 4 tests existants couvrent le chemin **non-padel** (la ressource mockée n'a pas de `sport`) et restent inchangés. Ajouter au `describe` :

```tsx
  // Chemin padel : MatchTeams (terrain) + feuilles.
  const padel = {
    resource: { id: 'res1', name: 'Terrain 1', sport: { key: 'padel', name: 'Padel' }, club: { name: 'Club', slug: 'demo', timezone: 'Europe/Paris' } },
  };

  it('padel : tap joueur → feuille d'actions → Retirer', async () => {
    const onChanged = jest.fn();
    wrap(padel, onChanged);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Ines B' }));
    fireEvent.click(screen.getByRole('button', { name: /Retirer de la partie/ }));
    await waitFor(() => expect(mocked.removeReservationPlayer).toHaveBeenCalledWith('r1', 'p2', 'abc'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('padel : l'organisateur n'a pas d'action Retirer dans sa feuille', () => {
    wrap(padel);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Org A' }));
    expect(screen.queryByRole('button', { name: /Retirer de la partie/ })).not.toBeInTheDocument();
  });

  it('padel : « + » d'équipe ouvre la feuille d'ajout, ajoute et épingle l'équipe', async () => {
    mocked.searchClubMembers.mockResolvedValue([{ id: 'u-new', firstName: 'New', lastName: 'Player' }] as never);
    const onChanged = jest.fn();
    wrap(padel, onChanged);
    // Org et Ines sont team 1 (défaut) → 2 places libres côté 2.
    fireEvent.click(screen.getAllByRole('button', { name: /Ajouter un joueur à l'équipe 2/ })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /New Player/ }));
    await waitFor(() => expect(mocked.addReservationPlayer).toHaveBeenCalledWith('r1', 'u-new', 'abc'));
    await waitFor(() => expect(mocked.setReservationTeams).toHaveBeenCalledWith('r1', { 'u-org': 1, u2: 1, 'u-new': 2 }, 'abc'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
```

(Échapper les apostrophes des libellés `it(...)`.)

- [ ] **Step 2: Run to verify the new cases fail**

Run: `npx jest __tests__/ReservationPlayersInline.test.tsx`
Expected: les nouveaux FAIL, les 4 anciens PASS.

- [ ] **Step 3: Wire the sheet**

Dans `frontend/components/reservations/ReservationPlayersInline.tsx` :

1. Ajouter l'import : `import { AddPlayerSheet } from '@/components/match/AddPlayerSheet';`
2. Étendre le state `addMode` (le slot visé s'affiche dans la chip et surligne la place) :

```tsx
  const [addMode, setAddMode] = useState<{ kind: 'add'; team: 1 | 2; slot?: number } | { kind: 'replace'; player: MatchPlayerData } | null>(null);
```

3. Sur le `<MatchTeams …>` padel, remplacer la prop `onAddToTeam` et ajouter `activeTarget` :

```tsx
          onAddToTeam={canEdit ? ((team, slot) => setAddMode({ kind: 'add', team, slot })) : undefined}
          activeTarget={addMode?.kind === 'add' ? { team: addMode.team, slot: addMode.slot } : null}
```

4. Remplacer le bloc `{canEdit && addMode && (…)}` final par : padel → feuille, non-padel → panneau inline actuel (inchangé) :

```tsx
      {canEdit && addMode && (isPadel ? (
        <AddPlayerSheet
          slug={reservation.resource.club.slug} token={token}
          team={addMode.kind === 'add' ? addMode.team : addMode.player.team}
          slot={addMode.kind === 'add' ? addMode.slot : undefined}
          replaceName={addMode.kind === 'replace' ? `${addMode.player.firstName} ${addMode.player.lastName}` : undefined}
          excludeIds={participants.map((p) => p.userId)}
          busy={busy}
          onPick={(m) => onPickMember(m.id)}
          onClose={() => setAddMode(null)}
        />
      ) : (
        <div style={{ marginTop: 10 }}>
          <PartnerSearch
            autoFocus
            slug={reservation.resource.club.slug} token={token} selected={null}
            excludeIds={participants.map((p) => p.userId)}
            onSelect={(m) => onPickMember(m.id)}
            onClear={() => {}}
            disabled={busy}
          />
          <button type="button" onClick={() => setAddMode(null)}
            style={{ marginTop: 8, border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13 }}>Annuler</button>
        </div>
      ))}
```

(Le petit label texte « Ajouter un joueur à l'équipe X / Remplacer … par… » du panneau padel disparaît — la feuille porte cette info dans son en-tête.)

- [ ] **Step 4: Run the suites**

Run: `npx jest __tests__/ReservationPlayersInline.test.tsx __tests__/DayPanel.test.tsx __tests__/MyAgendaListItem.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add frontend/components/reservations/ReservationPlayersInline.tsx frontend/__tests__/ReservationPlayersInline.test.tsx
git commit -m "feat(calendar): édition des joueurs padel via feuille d'ajout ciblée (AddPlayerSheet)"
```

---

### Task 8: Câbler `OpenMatchCard` (parties ouvertes)

**Files:**
- Modify: `frontend/components/openmatch/OpenMatchCard.tsx`
- Modify: `frontend/__tests__/OpenMatchCard.test.tsx` (test « → déplace » l.173-197)
- Modify: `frontend/__tests__/OpenMatches.test.tsx` (tests retirer/ajouter l.112-149)

- [ ] **Step 1: Update the tests (failing)**

`OpenMatchCard.test.tsx`, test `'organisateur : « → » déplace…'` — remplacer les 3 lignes d'interaction/assertion (l.189-196) :

```tsx
    // Tap sur Bob → feuille d'actions → « Passer dans l'équipe 2 » (pleine → échange avec Dan).
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Bob B' }));
    fireEvent.click(screen.getByRole('button', { name: /Passer dans l'équipe 2/ }));
    expect(onSetTeams).toHaveBeenCalledWith(match, {
      'u-org': 1, 'u-bob': 2, 'u-cara': 2, 'u-dan': 1,
    });
```

`OpenMatches.test.tsx` :
- test `'permet à l organisateur de retirer un joueur…'` (l.120-124) :

```tsx
    expect(await screen.findByText('Emma Bernard')).toBeInTheDocument();
    // Tap sur le joueur → feuille d'actions → « Retirer de la partie ».
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier Emma Bernard' }));
    fireEvent.click(screen.getByRole('button', { name: /Retirer de la partie/ }));
    await waitFor(() => expect(mocked.removeOpenMatchPlayer).toHaveBeenCalledWith('demo', 'm1', 'u-emma', 'abc'));
```

- test `'masque le bouton « Retirer »…'` (l.136) :

```tsx
    expect(screen.queryByRole('button', { name: 'Modifier Emma Bernard' })).not.toBeInTheDocument();
```

- test `'permet à l organisateur d ajouter un joueur…'` (l.144-148) :

```tsx
    // Un « + » par place libre : le premier vise l'équipe 1 → feuille d'ajout.
    const addBtns = await screen.findAllByRole('button', { name: /Ajouter un joueur à l'équipe/ });
    fireEvent.click(addBtns[0]);
    fireEvent.click(await screen.findByRole('button', { name: /New Player/ }));
```

(garder l'assertion `addOpenMatchPlayer` existante ; si le mock `api` de la suite n'a pas `searchClubMembers`/`listClubFriends`, les ajouter — cf. note CLAUDE.md sur les mocks `listClubFriends`).

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest __tests__/OpenMatchCard.test.tsx __tests__/OpenMatches.test.tsx`
Expected: FAIL sur les tests modifiés.

- [ ] **Step 3: Wire the sheet**

Dans `frontend/components/openmatch/OpenMatchCard.tsx` :

1. Remplacer l'import `PartnerSearch` par `import { AddPlayerSheet } from '@/components/match/AddPlayerSheet';`
2. Étendre `addMode` :

```tsx
  const [addMode, setAddMode] = useState<{ kind: 'add'; team: 1 | 2; slot?: number } | { kind: 'replace'; player: MatchPlayerData } | null>(null);
```

3. Sur `<MatchTeams …>` (l.95-111), remplacer `onAddToTeam` et ajouter `activeTarget` :

```tsx
        onAddToTeam={m.viewerIsOrganizer ? ((team, slot) => { setAddMode({ kind: 'add', team, slot }); if (!addingOpen) onToggleAdd(m); }) : undefined}
        activeTarget={addingOpen && addMode?.kind === 'add' ? { team: addMode.team, slot: addMode.slot } : null}
```

4. Remplacer tout le bloc `{m.viewerIsOrganizer && addingOpen && (…)}` (l.157-180) par :

```tsx
      {m.viewerIsOrganizer && addingOpen && addMode && (
        <AddPlayerSheet
          slug={slug} token={token}
          team={addMode.kind === 'add' ? addMode.team : addMode.player.team}
          slot={addMode.kind === 'add' ? addMode.slot : undefined}
          replaceName={addMode.kind === 'replace' ? `${addMode.player.firstName} ${addMode.player.lastName}` : undefined}
          excludeIds={m.players.map((p) => p.userId)}
          busy={busy}
          onPick={(member) => {
            if (addMode.kind === 'replace') onReplacePlayer(m, addMode.player, member.id);
            else onAddPlayer(m, member.id, addMode.team);
            setAddMode(null); onCancelAdd();
          }}
          onClose={() => { setAddMode(null); onCancelAdd(); }}
        />
      )}
```

- [ ] **Step 4: Run the suites**

Run: `npx jest __tests__/OpenMatchCard.test.tsx __tests__/OpenMatchCard.friends.test.tsx __tests__/OpenMatches.test.tsx __tests__/OpenMatchDetail.test.tsx`
Expected: PASS. Si `OpenMatchDetail.test.tsx` interagit avec l'ancien flux (icônes/PartnerSearch inline), appliquer les mêmes conversions que ci-dessus (tap `Modifier {nom}` → action en toutes lettres ; `+` → feuille avec rows-boutons).

- [ ] **Step 5: Commit**

```powershell
git add frontend/components/openmatch/OpenMatchCard.tsx frontend/__tests__/OpenMatchCard.test.tsx frontend/__tests__/OpenMatches.test.tsx frontend/__tests__/OpenMatchDetail.test.tsx
git commit -m "feat(openmatch): terrain + feuilles d'actions/ajout sur les cartes de partie ouverte"
```

---

### Task 9: Câbler `BookingModal` (création)

**Files:**
- Modify: `frontend/components/BookingModal.tsx` (chemin padel : l.517-546)
- Modify: `frontend/__tests__/BookingModal.test.tsx` (test teams l.118-131)

- [ ] **Step 1: Update the test (failing)**

Dans `frontend/__tests__/BookingModal.test.tsx`, le test qui vérifie `applyHoldSetup … teams` (l.118-131) — remplacer le flux d'ajout :

```tsx
    (api.searchClubMembers as jest.Mock).mockResolvedValue([{ id: 'user-2', firstName: 'Marc', lastName: 'Dupont' }]);
    renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'padel' });
    // L'aperçu d'équipes n'apparaît qu'une fois l'identité de l'organisateur chargée.
    await screen.findByText('Alice Org');
    // Ajout ciblé : « + » d'une place de l'équipe 1 → feuille d'ajout → pick.
    fireEvent.click(screen.getAllByRole('button', { name: /Ajouter un joueur à l'équipe 1/ })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /Marc Dupont/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmer la réservation/ }));
    await waitFor(() => expect(api.applyHoldSetup).toHaveBeenCalledWith(
      'res-1', 'jwt-token',
      expect.objectContaining({ teams: expect.objectContaining({ 'user-1': 1, 'user-2': 1 }) }),
    ));
```

⚠️ Si le mock `api` de la suite n'expose pas `listClubFriends`, l'ajouter (`listClubFriends: jest.fn().mockResolvedValue([])`) — la feuille monte `FriendsQuickRow` (cf. note CLAUDE.md).

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/BookingModal.test.tsx`
Expected: FAIL sur ce test (les autres cas de la suite restent verts — flake connu de la full-suite mis à part).

- [ ] **Step 3: Wire the sheet**

Dans `frontend/components/BookingModal.tsx` :

1. Imports : ajouter `import { AddPlayerSheet, PickedMember } from '@/components/match/AddPlayerSheet';`
2. State (près de `teamsDraft`, l.192) :

```tsx
  // Ajout ciblé depuis le terrain (padel) : place visée par la feuille d'ajout.
  const [addTarget, setAddTarget] = useState<{ team: 1 | 2; slot?: number } | null>(null);
```

3. À côté de `addPartner` (l.229), ajouter la variante à équipe imposée :

```tsx
  // Ajout depuis la feuille : la place tapée impose l'équipe (pas de nextSide).
  const addPartnerTo = (m: PickedMember, team: 1 | 2) => {
    setPartners((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, m]));
    setTeamsDraft((d) => ({ ...d, [m.id]: team }));
  };
```

4. Sur le `<MatchTeams size="sm" …>` (l.519-521), ajouter :

```tsx
                        onAddToTeam={atCap ? undefined : (team, slot) => setAddTarget({ team, slot })}
                        activeTarget={addTarget}
```

5. Le `PartnerSearch` inline (l.542-545) ne doit rester que pour le chemin **non-padel** :

```tsx
                  {atCap ? (
                    <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>Terrain complet ({cap} joueurs).</div>
                  ) : !(isPadel && me) && (
                    <PartnerSearch slug={slug!} token={token} selected={null}
                      excludeIds={partners.map((p) => p.id)} keepOpenOnSelect
                      onSelect={addPartner}
                      onClear={() => {}} />
                  )}
```

6. Rendre la feuille (juste après le `</div>` qui ferme le bloc MatchTeams padel, l.522) :

```tsx
                  {addTarget && slug && me && (
                    <AddPlayerSheet slug={slug} token={token} team={addTarget.team} slot={addTarget.slot}
                      excludeIds={[me.id, ...partners.map((p) => p.id)]}
                      onPick={(m) => { addPartnerTo(m, addTarget.team); setAddTarget(null); }}
                      onClose={() => setAddTarget(null)} />
                  )}
```

- [ ] **Step 4: Run the suites**

Run: `npx jest __tests__/BookingModal.test.tsx __tests__/BookingModal.payment.test.tsx __tests__/BookingModal.packages.test.tsx __tests__/BookingModal.subscription.test.tsx`
Expected: PASS (mémoire projet : si des échecs BookingModal apparaissent en exécution groupée, relancer la suite en isolation avant de conclure — flake d'isolation connu).

- [ ] **Step 5: Commit**

```powershell
git add frontend/components/BookingModal.tsx frontend/__tests__/BookingModal.test.tsx
git commit -m "feat(booking): ajout de joueur ciblé par équipe via AddPlayerSheet (padel)"
```

---

### Task 10: Vérification finale

**Files:** aucun nouveau — garde de types + suites impactées.

- [ ] **Step 1: Type check**

Run (depuis `frontend/`): `npx tsc --noEmit`
Expected: 0 erreur dans les fichiers touchés (`names.ts`, `MatchTeams.tsx`, `PlayerActionSheet.tsx`, `AddPlayerSheet.tsx`, `SheetShell.tsx`, `FriendsQuickRow.tsx`, `ReservationPlayersInline.tsx`, `OpenMatchCard.tsx`, `BookingModal.tsx`). ⚠️ Du WIP parallèle peut générer des erreurs ailleurs : filtrer sur nos fichiers (`npx tsc --noEmit 2>&1 | Select-String 'names|MatchTeams|PlayerActionSheet|AddPlayerSheet|SheetShell|FriendsQuickRow|ReservationPlayersInline|OpenMatchCard|BookingModal'`).

- [ ] **Step 2: Run all impacted suites in one pass**

Run: `npx jest __tests__/names.test.ts __tests__/FriendsQuickRow.test.tsx __tests__/PartnerSearch.friends.test.tsx __tests__/SheetShell.test.tsx __tests__/PlayerActionSheet.test.tsx __tests__/MatchTeams.test.tsx __tests__/AddPlayerSheet.test.tsx __tests__/ReservationPlayersInline.test.tsx __tests__/DayPanel.test.tsx __tests__/MyAgendaListItem.test.tsx __tests__/MyReservationsCalendar.test.tsx __tests__/OpenMatchCard.test.tsx __tests__/OpenMatchCard.friends.test.tsx __tests__/OpenMatches.test.tsx __tests__/OpenMatchDetail.test.tsx __tests__/BookingModal.test.tsx`
Expected: PASS (BookingModal : flake d'isolation connu → revalider en isolation si besoin).

- [ ] **Step 3: Visual smoke test (recommandé)**

Démarrer le dev (`npm run dev` dans backend/ et frontend/ si pas déjà lancés) et vérifier sur `http://localhost:3000` :
- `/parties` : terrain sur les cartes, tap joueur (organisateur) → feuille, « + » → feuille d'ajout avec chip de destination, place visée surlignée ;
- `/me/reservations` (calendrier → panneau du jour, résa padel) : idem ;
- réservation padel (BookingModal) : terrain éditable, ajout ciblé ;
- réduire la fenêtre < 380 px : noms « Prénom N. », tooltip nom complet.

- [ ] **Step 4: Commit final (si retouches)**

```powershell
git add <fichiers retouchés>
git commit -m "fix(match): retouches post-vérification terrain/feuilles"
```
