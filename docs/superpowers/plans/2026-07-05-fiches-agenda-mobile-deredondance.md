# Fiches tournoi & event — dérédondance + cartes méta compactes : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sur les fiches `/tournois/[id]` et `/events/[id]`, supprimer la timeline redondante, faire tenir les 3 cartes méta de front sur mobile (contenus raccourcis), et raccourcir le badge places du hero — frontend uniquement, zéro backend.

**Architecture:** Helpers purs nouveaux dans `frontend/lib/tournament.ts` (`formatDateTimeShort`, `heroPlacesLabel`, élargissement de `formatDateShortTimeRange`) consommés par `TournamentHero` et la page event ; compactage purement CSS de `MetaCardsRow` (partagé tournoi/event/cours) ; suppression du composant `TournamentTimeline` et de `timelineSteps` (code mort en fin de plan). Les helpers de listes `tournamentPlacesLabel`/`eventPlacesLabel` ne changent pas.

**Tech Stack:** Next.js 16 + React 19, styles inline, Jest + React Testing Library, ts-jest (pas de type-check en jest → gate `tsc --noEmit` séparé).

**Spec:** `docs/superpowers/specs/2026-07-05-fiches-agenda-mobile-deredondance-design.md`

---

## ⚠️ Notes d'environnement (lire avant de commencer)

- **Shims `.bin` cassés sur ce poste** : ne jamais lancer `npx jest` / `npx tsc`. Utiliser :
  - Jest : `cd frontend && node node_modules/jest/bin/jest.js <suites>`
  - tsc : `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
- **WIP utilisateur en parallèle sur `main`** (ClubNav, MonthCalendar, MyAgendaListItem, start.ps1…) : chaque `git add` doit lister **explicitement** les fichiers du task — jamais `git add -A`. Si `tsc --noEmit` remonte des erreurs, ne traiter que celles des fichiers touchés par ce plan.
- **Ne pas lancer la suite jest complète** (flake BookingModal connu) : toujours scoper aux suites listées.

## Fichiers

| Fichier | Action |
|---|---|
| `frontend/lib/tournament.ts` | Modifier : + `formatDateTimeShort`, + `heroPlacesLabel`, élargir `formatDateShortTimeRange` ; retirer `timelineSteps`/`TimelineStep` (Task 5) |
| `frontend/components/agenda/AgendaHero.tsx` | Modifier : `MetaCardsRow` compact sans scroll ; `places` nullable |
| `frontend/components/tournament/TournamentHero.tsx` | Modifier : badge hero via `heroPlacesLabel`, cartes méta courtes |
| `frontend/app/tournois/[id]/page.tsx` | Modifier : retirer la timeline |
| `frontend/app/events/[id]/page.tsx` | Modifier : retirer la timeline, badge hero, cartes méta courtes |
| `frontend/components/tournament/TournamentTimeline.tsx` | **Supprimer** (Task 5) |
| `frontend/__tests__/tournament.test.ts` | Modifier : + tests nouveaux helpers ; − bloc `timelineSteps` (Task 5) |
| `frontend/__tests__/TournamentHero.test.tsx` | Modifier : nouvelles assertions hero + cartes |
| `frontend/__tests__/TournamentDetail.test.tsx` | Modifier : mocks nettoyés |
| `frontend/__tests__/EventDetail.test.tsx` | Modifier : mocks nettoyés/ajustés |

`frontend/app/cours/[id]/page.tsx` n'est **pas** modifié (il profite du compactage visuel de `MetaCardsRow` ; son `places` non-null reste compatible avec le type élargi).

---

### Task 1 : Helpers purs `formatDateTimeShort`, `heroPlacesLabel`, `formatDateShortTimeRange` élargi

**Files:**
- Modify: `frontend/lib/tournament.ts`
- Test: `frontend/__tests__/tournament.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `frontend/__tests__/tournament.test.ts` :

1. Ajouter `formatDateTimeShort, heroPlacesLabel` à l'import en tête de fichier (lignes 1-4) :

```ts
import {
  buildAgendaICS, deadlineCountdown, fillRatio, formatDateTime, formatDateTimeRange, formatDateShortTimeRange, formatDateTimeShort, formatHourRange,
  heroPlacesLabel, icsFilename, timelineSteps, waitlistPosition,
} from '../lib/tournament';
```

2. Dans le `describe('formatDateShortTimeRange', …)` existant, ajouter un cas « sans fin » :

```ts
  it('sans fin → date courte + heure', () => {
    expect(formatDateShortTimeRange('2026-07-09T12:01:00.000Z', null, tz)).toBe('jeu. 9 juil. · 14h01');
  });
```

3. À la fin du fichier, ajouter deux blocs :

```ts
describe('formatDateTimeShort', () => {
  it('date courte + heure dans le fuseau du club', () => {
    expect(formatDateTimeShort('2026-07-09T12:01:00.000Z', 'Europe/Paris')).toBe('jeu. 9 juil. · 14h01');
  });
});

describe('heroPlacesLabel', () => {
  it('null sans capacité (le compteur du hero suffit)', () => {
    expect(heroPlacesLabel(7, null)).toBeNull();
  });
  it('plein ou surbooké → « Complet » court, jamais « liste d\'attente possible »', () => {
    expect(heroPlacesLabel(12, 12)).toEqual({ text: 'Complet', urgent: false });
    expect(heroPlacesLabel(14, 12)).toEqual({ text: 'Complet', urgent: false });
  });
  it('≤ 5 places restantes → urgent, singulier/pluriel', () => {
    expect(heroPlacesLabel(10, 12)).toEqual({ text: 'Plus que 2 places', urgent: true });
    expect(heroPlacesLabel(11, 12)).toEqual({ text: 'Plus que 1 place', urgent: true });
  });
  it('> 5 places restantes → libellé neutre', () => {
    expect(heroPlacesLabel(4, 12)).toEqual({ text: '8 places restantes', urgent: false });
  });
});
```

- [ ] **Step 2 : Vérifier qu'ils échouent**

Run : `cd frontend && node node_modules/jest/bin/jest.js __tests__/tournament.test.ts`
Attendu : FAIL — `formatDateTimeShort`/`heroPlacesLabel` ne sont pas exportés (TS2305 via ts-jest) .

- [ ] **Step 3 : Implémenter dans `frontend/lib/tournament.ts`**

1. Après `formatHour` (~ligne 28), ajouter :

```ts
/** Date courte + heure dans le fuseau du club, ex. « jeu. 9 juil. · 14h01 ». */
export function formatDateTimeShort(iso: string, tz: string): string {
  return `${formatDateShort(iso, tz)} · ${formatHour(iso, tz)}`;
}
```

2. Élargir la signature de `formatDateShortTimeRange` (le `endIso` devient optionnel, miroir de `formatDateTimeRange`) :

```ts
export function formatDateShortTimeRange(startIso: string, endIso: string | null | undefined, tz: string): string {
  if (!endIso) return formatDateTimeShort(startIso, tz);
  if (dayKey(startIso, tz) === dayKey(endIso, tz)) {
    return `${formatDateShort(startIso, tz)} · ${formatHour(startIso, tz)} → ${formatHour(endIso, tz)}`;
  }
  return `${formatDateShort(startIso, tz)} ${formatHour(startIso, tz)} → ${formatDateShort(endIso, tz)} ${formatHour(endIso, tz)}`;
}
```

3. Après `fillRatio` (~ligne 84), ajouter :

```ts
/**
 * Badge places du hero des fiches tournoi/event — version courte, zéro doublon
 * avec le compteur affiché à côté (« 8/8 binômes · 3 en attente »).
 * null = badge masqué (sans capacité, le compteur suffit).
 * Les listes (AgendaCard, club-house, calendrier national) gardent
 * tournamentPlacesLabel/eventPlacesLabel, plus verbeux — là-bas il n'y a pas de compteur.
 */
export function heroPlacesLabel(confirmed: number, capacity: number | null): { text: string; urgent: boolean } | null {
  if (capacity == null) return null;
  const left = capacity - confirmed;
  if (left <= 0) return { text: 'Complet', urgent: false };
  if (left <= 5) return { text: `Plus que ${left} place${left > 1 ? 's' : ''}`, urgent: true };
  return { text: `${left} places restantes`, urgent: false };
}
```

- [ ] **Step 4 : Vérifier que la suite passe**

Run : `cd frontend && node node_modules/jest/bin/jest.js __tests__/tournament.test.ts`
Attendu : PASS (tous les blocs, y compris les anciens).

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/tournament.ts frontend/__tests__/tournament.test.ts
git commit -m "feat(agenda): helpers formatDateTimeShort + heroPlacesLabel (fiches mobiles)"
```

---

### Task 2 : `MetaCardsRow` compact sans scroll + `places` nullable dans `AgendaHero`

**Files:**
- Modify: `frontend/components/agenda/AgendaHero.tsx`

Changement purement présentationnel (aucune suite ne teste les styles de `MetaCardsRow` ; le rendu réel est couvert par `TournamentHero.test.tsx` qui monte le vrai `AgendaHero`).

- [ ] **Step 1 : Compacter `MetaCardsRow`**

Remplacer la fonction `MetaCardsRow` (fin de `frontend/components/agenda/AgendaHero.tsx`) par :

```tsx
// Rangée de cartes méta icônées sous le hero (début, clôture, prix…).
// 3 tiers égaux sans scroll horizontal : sur mobile ~110 px par carte (les
// valeurs — formats courts — wrappent sur 2-3 lignes), sur desktop ~255 px.
export function MetaCardsRow({ cards }: { cards: MetaCard[] }) {
  const { th } = useTheme();
  return (
    <div style={{ display: 'flex', gap: 6, padding: '10px 20px 0' }}>
      {cards.map((c) => (
        <div key={c.label} style={{ flex: '1 1 0', minWidth: 0, background: th.surface, borderRadius: 14, padding: '10px 11px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: th.fontUI, fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: th.textFaint }}>
            <Icon name={c.icon} size={12} color={th.textFaint} style={{ flexShrink: 0 }} />{c.label}
          </div>
          <div style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text, marginTop: 5, lineHeight: 1.35 }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}
```

(Différences vs l'existant : `gap` 8→6, plus d'`overflowX`, `flex: '1 1 0'` + `minWidth: 0` au lieu de `'1 0 140px'`/`140`, padding `10px 11px`, label 11→10 + icône 13→12 + `flexShrink: 0`, valeur 13.5→12.5. `Icon` accepte bien une prop `style` — usage existant dans `app/tournois/[id]/page.tsx`.)

- [ ] **Step 2 : Rendre `places` nullable dans `AgendaHero`**

Dans `AgendaHeroProps`, remplacer :

```ts
  places: { text: string; urgent: boolean };
```

par :

```ts
  places: { text: string; urgent: boolean } | null;  // null = badge masqué
```

Et dans le JSX du hero, remplacer le `<span>` du badge (bloc `places.text`) :

```tsx
            <span style={{
              fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700,
              ...(places.urgent ? { background: ACCENTS.coral, borderRadius: 999, padding: '4px 10px', color: '#fff' } : { opacity: 0.7 }),
            }}>{places.text}</span>
```

par :

```tsx
            {places && (
              <span style={{
                fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700,
                ...(places.urgent ? { background: ACCENTS.coral, borderRadius: 999, padding: '4px 10px', color: '#fff' } : { opacity: 0.7 }),
              }}>{places.text}</span>
            )}
```

Les appelants actuels (TournamentHero, page event, page cours) passent tous un objet non-null : compatible.

- [ ] **Step 3 : Vérifier les suites qui montent le vrai AgendaHero + tsc**

Run : `cd frontend && node node_modules/jest/bin/jest.js __tests__/TournamentHero.test.tsx __tests__/HeroAnnouncement.test.tsx`
Attendu : PASS.
Run : `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Attendu : aucune erreur sur les fichiers de ce plan (ignorer celles du WIP utilisateur, le cas échéant).

- [ ] **Step 4 : Commit**

```bash
git add frontend/components/agenda/AgendaHero.tsx
git commit -m "feat(agenda): cartes meta compactes sans scroll + badge places nullable"
```

---

### Task 3 : Fiche tournoi — badge hero court, cartes courtes, timeline retirée

**Files:**
- Modify: `frontend/components/tournament/TournamentHero.tsx`
- Modify: `frontend/app/tournois/[id]/page.tsx`
- Test: `frontend/__tests__/TournamentHero.test.tsx`
- Test: `frontend/__tests__/TournamentDetail.test.tsx`

- [ ] **Step 1 : Mettre à jour les tests `TournamentHero.test.tsx` (échec attendu)**

Fixture du fichier : `startTime: '2026-07-09T12:01:00Z'` (= jeu. 9 juil. 14h01 Paris), `endTime: null`, `registrationDeadline: '2026-07-04T12:01:00Z'` (= sam. 4 juil. 14h01), `entryFee: '40'`, `maxTeams: 12`, `confirmedCount: 7`.

1. Dans le test `'sans capacité → pas de jauge, compteur simple'`, ajouter l'assertion d'absence de badge :

```tsx
  it('sans capacité → pas de jauge, compteur simple, pas de badge places', () => {
    wrap(<TournamentHero t={tournament({ maxTeams: null })} now={NOW} />);
    expect(screen.queryByTestId('hero-fill')).not.toBeInTheDocument();
    expect(screen.getByText('7 binômes')).toBeInTheDocument();
    expect(screen.queryByText('7 binômes inscrits')).not.toBeInTheDocument();
  });
```

2. Ajouter après ce test :

```tsx
  it('complet → badge court « Complet », compteur avec attente', () => {
    wrap(<TournamentHero t={tournament({ confirmedCount: 12, waitlistCount: 3 })} now={NOW} />);
    expect(screen.getByText('Complet')).toBeInTheDocument();
    expect(screen.queryByText(/liste d'attente/)).not.toBeInTheDocument();
    expect(screen.getByText('12/12 binômes · 3 en attente')).toBeInTheDocument();
  });
```

3. Remplacer le bloc `describe('MetaCards', …)` entier par :

```tsx
describe('MetaCards', () => {
  it('début, clôture (formats courts) et prix dans le fuseau du club', () => {
    wrap(<MetaCards t={tournament()} />);
    expect(screen.getByText('jeu. 9 juil. · 14h01')).toBeInTheDocument();
    expect(screen.getByText('Clôture')).toBeInTheDocument();
    expect(screen.queryByText('Clôture des inscriptions')).not.toBeInTheDocument();
    expect(screen.getByText('sam. 4 juil. · 14h01')).toBeInTheDocument();
    expect(screen.getByText('40 € / binôme')).toBeInTheDocument();
  });

  it('avec heure de fin → plage compacte sur un jour', () => {
    wrap(<MetaCards t={tournament({ endTime: '2026-07-09T16:00:00Z' })} />);
    expect(screen.getByText('jeu. 9 juil. · 14h01 → 18h00')).toBeInTheDocument();
  });

  it('pas de carte prix sans entryFee', () => {
    wrap(<MetaCards t={tournament({ entryFee: null })} />);
    expect(screen.queryByText(/€ \/ binôme/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `cd frontend && node node_modules/jest/bin/jest.js __tests__/TournamentHero.test.tsx`
Attendu : FAIL (« Complet » introuvable, formats longs encore rendus).

- [ ] **Step 3 : Implémenter `TournamentHero.tsx`**

Remplacer les imports lignes 3-4 :

```ts
import { tournamentPlacesLabel } from '@/lib/clubhouse';
import { fillRatio, formatDateTime, formatDateTimeRange } from '@/lib/tournament';
```

par :

```ts
import { fillRatio, formatDateShortTimeRange, formatDateTimeShort, heroPlacesLabel } from '@/lib/tournament';
```

Dans `TournamentHero`, remplacer :

```ts
      places={tournamentPlacesLabel(t)}
```

par :

```ts
      places={heroPlacesLabel(t.confirmedCount, t.maxTeams)}
```

Dans `MetaCards`, remplacer le tableau `cards` par :

```ts
  const cards: MetaCard[] = [
    { icon: 'calendar', label: t.endTime ? 'Horaire' : 'Début', value: formatDateShortTimeRange(t.startTime, t.endTime, tz) },
    { icon: 'clock', label: 'Clôture', value: formatDateTimeShort(t.registrationDeadline, tz) },
    ...(t.entryFee ? [{ icon: 'euro', label: 'Inscription', value: `${t.entryFee} € / binôme` } as MetaCard] : []),
  ];
```

- [ ] **Step 4 : Retirer la timeline de `frontend/app/tournois/[id]/page.tsx`**

1. Supprimer la ligne 14 :

```ts
import { TournamentTimeline } from '@/components/tournament/TournamentTimeline';
```

2. Ligne 20, retirer `timelineSteps` :

```ts
import { waitlistPosition } from '@/lib/tournament';
```

3. Supprimer la ligne 183 (rendu) :

```tsx
        {now && <TournamentTimeline steps={timelineSteps(t, now)} tz={t.club.timezone} />}
```

- [ ] **Step 5 : Nettoyer les mocks `TournamentDetail.test.tsx`**

1. Supprimer le mock (lignes 18-20) :

```tsx
jest.mock('../components/tournament/TournamentTimeline', () => ({
  TournamentTimeline: () => null,
}));
```

2. Remplacer le mock `lib/tournament` (lignes 62-65) par :

```ts
jest.mock('../lib/tournament', () => ({
  waitlistPosition: () => null,
}));
```

- [ ] **Step 6 : Vérifier**

Run : `cd frontend && node node_modules/jest/bin/jest.js __tests__/TournamentHero.test.tsx __tests__/TournamentDetail.test.tsx`
Attendu : PASS.

- [ ] **Step 7 : Commit**

```bash
git add frontend/components/tournament/TournamentHero.tsx "frontend/app/tournois/[id]/page.tsx" frontend/__tests__/TournamentHero.test.tsx frontend/__tests__/TournamentDetail.test.tsx
git commit -m "feat(tournoi): fiche mobile — badge Complet court, cartes meta courtes, timeline retiree"
```

---

### Task 4 : Fiche event — badge hero court, cartes courtes, timeline retirée

**Files:**
- Modify: `frontend/app/events/[id]/page.tsx`
- Test: `frontend/__tests__/EventDetail.test.tsx`

- [ ] **Step 1 : Implémenter la page**

1. Remplacer les imports lignes 9-10 :

```ts
import { eventPlacesLabel, KIND_LABEL } from '@/lib/events';
import { fillRatio, formatDateTime, formatDateTimeRange, timelineSteps, waitlistPosition } from '@/lib/tournament';
```

par :

```ts
import { KIND_LABEL } from '@/lib/events';
import { fillRatio, formatDateShortTimeRange, formatDateTimeShort, heroPlacesLabel, waitlistPosition } from '@/lib/tournament';
```

2. Supprimer la ligne 18 :

```ts
import { TournamentTimeline } from '@/components/tournament/TournamentTimeline';
```

3. Ligne 116, remplacer :

```ts
  const places = eventPlacesLabel(event);
```

par :

```ts
  const places = heroPlacesLabel(event.confirmedCount, event.capacity);
```

4. Remplacer le tableau `metaCards` (lignes 119-127) par :

```ts
  const metaCards: MetaCard[] = [
    { icon: 'calendar', label: event.endTime ? 'Horaire' : 'Début', value: formatDateShortTimeRange(event.startTime, event.endTime, tz) },
    { icon: 'clock', label: 'Clôture', value: formatDateTimeShort(event.registrationDeadline, tz) },
    ...(event.price != null && Number(event.price) > 0 ? [{
      icon: 'euro',
      label: 'Prix',
      value: `${Number(event.price)} € · ${event.requirePrepayment ? 'en ligne' : 'au club'}`,
    } as MetaCard] : []),
  ];
```

5. Supprimer la ligne 159 (rendu timeline) :

```tsx
        {now && <TournamentTimeline steps={timelineSteps(event, now)} tz={tz} />}
```

- [ ] **Step 2 : Ajuster les mocks `EventDetail.test.tsx`**

1. Supprimer la ligne 40 :

```tsx
jest.mock('../components/tournament/TournamentTimeline', () => ({ TournamentTimeline: () => null }));
```

2. Remplacer les mocks lib (lignes 53-63) :

```ts
jest.mock('../lib/events', () => ({
  eventPlacesLabel: () => 'places libres',
  KIND_LABEL: { MELEE: 'Mêlée', STAGE: 'Stage', SOIREE: 'Soirée', INITIATION: 'Initiation', AUTRE: 'Autre' },
}));
jest.mock('../lib/tournament', () => ({
  fillRatio: () => 0.25,
  formatDateTime: () => '25/07/2030 23:59',
  formatDateTimeRange: () => '01/08/2030',
  timelineSteps: () => [],
  waitlistPosition: () => null,
}));
```

par :

```ts
jest.mock('../lib/events', () => ({
  KIND_LABEL: { MELEE: 'Mêlée', STAGE: 'Stage', SOIREE: 'Soirée', INITIATION: 'Initiation', AUTRE: 'Autre' },
}));
jest.mock('../lib/tournament', () => ({
  fillRatio: () => 0.25,
  formatDateShortTimeRange: () => '01/08/2030',
  formatDateTimeShort: () => '25/07/2030 23:59',
  heroPlacesLabel: () => ({ text: 'places libres', urgent: false }),
  waitlistPosition: () => null,
}));
```

- [ ] **Step 3 : Vérifier**

Run : `cd frontend && node node_modules/jest/bin/jest.js __tests__/EventDetail.test.tsx`
Attendu : PASS.

- [ ] **Step 4 : Commit**

```bash
git add "frontend/app/events/[id]/page.tsx" frontend/__tests__/EventDetail.test.tsx
git commit -m "feat(event): fiche mobile — badge court, cartes meta courtes, timeline retiree"
```

---

### Task 5 : Suppression du code mort (TournamentTimeline, timelineSteps) + gate final

**Files:**
- Delete: `frontend/components/tournament/TournamentTimeline.tsx`
- Modify: `frontend/lib/tournament.ts`
- Test: `frontend/__tests__/tournament.test.ts`

- [ ] **Step 1 : Supprimer le composant**

```bash
git rm frontend/components/tournament/TournamentTimeline.tsx
```

- [ ] **Step 2 : Retirer `timelineSteps` + `TimelineStep` de `frontend/lib/tournament.ts`**

Supprimer intégralement (lignes ~96-115) :

```ts
export interface TimelineStep {
  key: 'open' | 'deadline' | 'start';
  label: string;
  dateIso: string | null;
  state: 'done' | 'current' | 'upcoming';
}

/**
 * Stepper du tournoi : Inscriptions ouvertes → Clôture → Début.
 * La prochaine échéance est « current », celles passées sont « done ».
 */
export function timelineSteps(t: Pick<Tournament, 'registrationDeadline' | 'startTime'>, now: Date): TimelineStep[] {
  const closed = now.getTime() >= new Date(t.registrationDeadline).getTime();
  const started = now.getTime() >= new Date(t.startTime).getTime();
  return [
    { key: 'open', label: 'Inscriptions ouvertes', dateIso: null, state: 'done' },
    { key: 'deadline', label: 'Clôture des inscriptions', dateIso: t.registrationDeadline, state: closed ? 'done' : 'current' },
    { key: 'start', label: 'Début du tournoi', dateIso: t.startTime, state: started ? 'done' : closed ? 'current' : 'upcoming' },
  ];
}
```

`formatDateShort` reste (utilisé par `formatDateShortTimeRange`). Vérifier que `Tournament` (import ligne 1) est encore utilisé par `fillRatio` — oui, ne pas y toucher.

- [ ] **Step 3 : Retirer le bloc de tests `timelineSteps`**

Dans `frontend/__tests__/tournament.test.ts` : supprimer le `describe('timelineSteps', …)` entier (lignes ~54-65) et retirer `timelineSteps` de l'import en tête.

- [ ] **Step 4 : Vérifier qu'aucun usage ne subsiste**

Run : `grep -rn "timelineSteps\|TournamentTimeline\|TimelineStep" frontend --include="*.ts" --include="*.tsx"`
Attendu : **aucun résultat**.

- [ ] **Step 5 : Gate final — suites scopées + type-check**

Run : `cd frontend && node node_modules/jest/bin/jest.js __tests__/tournament.test.ts __tests__/TournamentHero.test.tsx __tests__/TournamentDetail.test.tsx __tests__/EventDetail.test.tsx __tests__/HeroAnnouncement.test.tsx`
Attendu : PASS (5 suites).

Run : `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Attendu : aucune erreur sur les fichiers de ce plan (ignorer le WIP utilisateur).

- [ ] **Step 6 : Commit**

```bash
git add frontend/lib/tournament.ts frontend/__tests__/tournament.test.ts
git commit -m "chore(tournoi): suppression du code mort TournamentTimeline + timelineSteps"
```

---

## Vérification manuelle (après implémentation)

1. `start.ps1` (ou backend + frontend `npm run dev`) puis ouvrir `http://localhost:3000` sur l'hôte club seedé (`padel-arena-paris`), fiche d'un tournoi avec prix, en viewport mobile (~390 px, DevTools).
2. Vérifier : 3 cartes de front sans scroll ni coupure ; libellé « Clôture » ; « X € / binôme » entier ; pas de timeline ; badge hero « Complet » court (tournoi plein) ; pas de badge si tournoi sans capacité.
3. Même chose sur une fiche event avec prix (« X € · en ligne/au club »), et un œil sur une fiche cours (cartes compactes, rien de cassé).

⚠️ Le user teste souvent **la prod sur son téléphone** : préciser dans le message final que la vérif se fait en local (les changements ne sont pas déployés).
