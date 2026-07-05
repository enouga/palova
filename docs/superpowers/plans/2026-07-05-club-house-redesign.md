# Club-house redesign « éditorial premium » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refondre visuellement la page Club-house (hero immersif + parties ouvertes en vedette + rythme éditorial sur toutes les sections), 100 % frontend.

**Architecture:** Nouveaux composants `clubhouse/{ClubHouseHero,OpenMatchesShowcase,SectionHeader}` ; helpers purs dans `lib/clubhouse.ts` ; restylage en place des sections existantes ; `ClubHouse.tsx` orchestre (ordre adaptatif conservé). Aucun backend.

**Tech Stack:** Next.js 16 / React 19, styles inline + tokens `th` (ThemeProvider), `HERO_GRADIENT`/`HERO_INK` de `AgendaHero`, jest + RTL, vérification visuelle CDP.

**Spec:** `docs/superpowers/specs/2026-07-05-club-house-redesign-design.md`

---

### Task 1: Helpers purs `clubPulse` + `matchSeats` (TDD)

**Files:**
- Modify: `frontend/lib/clubhouse.ts`
- Test: `frontend/__tests__/clubhouse.test.ts`

- [ ] **Step 1: tests qui échouent** — ajouter à `clubhouse.test.ts` :

```ts
import { clubPulse, matchSeats } from '@/lib/clubhouse';

describe('clubPulse', () => {
  const now = new Date('2026-07-05T10:00:00.000Z');
  const slot = { resourceId: 'r1', resourceName: 'Padel 1', slot: { startTime: '2026-07-05T18:00:00.000Z', endTime: '2026-07-05T19:00:00.000Z', available: true, price: '25' } } as never;

  it('émet une chip par donnée présente (créneau, parties, event)', () => {
    const chips = clubPulse({ slots: [slot], matchCount: 3, nextEventStart: '2026-07-09T10:00:00.000Z', now, timezone: 'Europe/Paris' });
    expect(chips.map((c) => c.kind)).toEqual(['slot', 'matches', 'event']);
    expect(chips[0].label).toMatch(/^Prochain créneau/);
    expect(chips[1].label).toBe('3 parties cherchent des joueurs');
    expect(chips[2].label).toBe('Prochain event J-4');
  });

  it('singulier pour 1 partie, event du jour = « aujourd\'hui »', () => {
    const chips = clubPulse({ slots: [], matchCount: 1, nextEventStart: '2026-07-05T18:00:00.000Z', now, timezone: 'Europe/Paris' });
    expect(chips[0].label).toBe('1 partie cherche des joueurs');
    expect(chips[1].label).toBe("Prochain event aujourd'hui");
  });

  it('now null (hydration) ou aucune donnée → []', () => {
    expect(clubPulse({ slots: [slot], matchCount: 2, nextEventStart: null, now: null, timezone: 'Europe/Paris' })).toEqual([]);
    expect(clubPulse({ slots: [], matchCount: 0, nextEventStart: null, now, timezone: 'Europe/Paris' })).toEqual([]);
  });
});

describe('matchSeats', () => {
  it('sièges vides = maxPlayers - inscrits, borné à 0', () => {
    expect(matchSeats({ maxPlayers: 4, players: [{}, {}] as never[] })).toBe(2);
    expect(matchSeats({ maxPlayers: 4, players: [{}, {}, {}, {}, {}] as never[] })).toBe(0);
  });
});
```

- [ ] **Step 2: vérifier l'échec** — `node node_modules/jest/bin/jest.js clubhouse.test` → FAIL (« clubPulse is not a function »)

- [ ] **Step 3: implémentation** dans `lib/clubhouse.ts` :

```ts
export interface PulseChip { kind: 'slot' | 'matches' | 'event'; label: string; }

/** Jour + heure courte au fuseau du club (« dim. 20h00 »). */
function pulseWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz })
    .format(new Date(iso)).replace(':', 'h');
}

/** Rangée « pouls du club » du hero — une chip par donnée existante ; now null (avant mount) → []. */
export function clubPulse({ slots, matchCount, nextEventStart, now, timezone }: {
  slots: UpcomingSlot[]; matchCount: number; nextEventStart: string | null; now: Date | null; timezone: string;
}): PulseChip[] {
  if (!now) return [];
  const chips: PulseChip[] = [];
  if (slots.length > 0) chips.push({ kind: 'slot', label: `Prochain créneau ${pulseWhen(slots[0].slot.startTime, timezone)}` });
  if (matchCount > 0) chips.push({ kind: 'matches', label: matchCount === 1 ? '1 partie cherche des joueurs' : `${matchCount} parties cherchent des joueurs` });
  if (nextEventStart) {
    const days = Math.ceil((new Date(nextEventStart).getTime() - now.getTime()) / 86_400_000);
    chips.push({ kind: 'event', label: days <= 0 ? "Prochain event aujourd'hui" : `Prochain event J-${days}` });
  }
  return chips;
}

/** Sièges vides à dessiner sur une carte partie (capacité bornée à 6 pour l'affichage). */
export function matchSeats(m: { maxPlayers: number; players: unknown[] }): number {
  return Math.max(0, Math.min(6, m.maxPlayers) - m.players.length);
}
```

- [ ] **Step 4: vérifier le vert** — même commande → PASS
- [ ] **Step 5: commit** `feat(club-house): helpers pouls du club + sieges vides`

### Task 2: `SectionHeader` + langage carte commun

**Files:**
- Create: `frontend/components/clubhouse/SectionHeader.tsx`

- [ ] **Step 1: implémentation** (composant de présentation pur, testé via les suites des sections) :

```tsx
'use client';
import Link from 'next/link';
import { useTheme } from '@/lib/ThemeProvider';
import type { Theme } from '@/lib/theme';

/** Langage carte commun du Club-house : surface + ombre douce (remplace la bordure inset). */
export function cardStyle(th: Theme): React.CSSProperties {
  return {
    background: th.surface,
    borderRadius: 18,
    boxShadow: th.mode === 'floodlit'
      ? `0 14px 34px rgba(0,0,0,0.42), inset 0 0 0 1px ${th.line}`
      : '0 14px 34px rgba(24,21,16,0.08), 0 1px 2px rgba(24,21,16,0.05)',
  };
}

/** Titre de section éditorial : display 21px + action optionnelle à droite. */
export function SectionHeader({ title, action }: { title: string; action?: { label: string; href: string } }) {
  const { th } = useTheme();
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 13 }}>
      <h2 style={{ margin: 0, fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 21, letterSpacing: -0.3, color: th.text }}>{title}</h2>
      {action && (
        <Link href={action.href} style={{ marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.accent, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          {action.label}
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 2: tsc** — `node node_modules/typescript/bin/tsc --noEmit` → 0 erreur (vérifier que `lib/theme.ts` exporte bien `Theme` ; sinon utiliser le type du hook)
- [ ] **Step 3: commit** `feat(club-house): SectionHeader editorial + langage carte ombre douce`

### Task 3: `ClubHouseHero` (absorbe HeroAnnouncement)

**Files:**
- Create: `frontend/components/clubhouse/ClubHouseHero.tsx`
- Delete: `frontend/components/clubhouse/HeroAnnouncement.tsx`
- Test: `frontend/__tests__/ClubHouseHero.test.tsx` (migration de `HeroAnnouncement.test.tsx`, supprimé)

- [ ] **Step 1: écrire le composant.** Reprendre de `HeroAnnouncement.tsx` : `safeImageUrl` (neutralisation quotes/parenthèses), voile image, top-sheet `AnnouncementSheet` (copiée telle quelle), CTA `linkUrl`/« Réserver un terrain → » avec `stopPropagation`. Nouveautés : rendu **toujours** (annonce ou pas), surtitre club en `th.fontBrand`, pouls en chips, CTA encre.

```tsx
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Announcement } from '@/lib/api';
import { PulseChip } from '@/lib/clubhouse';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';
import { Icon, IconName } from '@/components/ui/Icon';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';

const PULSE_ICON: Record<PulseChip['kind'], IconName> = { slot: 'bolt', matches: 'users', event: 'trophy' };

// Hero du Club-house : toujours présent. Identité club (fontBrand) + contenu adaptatif
// (annonce épinglée → titre + corps clampé + top-sheet ; sinon accroche) + pouls du club.
export function ClubHouseHero({ clubName, announcement, pulse }: {
  clubName: string; announcement: Announcement | null; pulse: PulseChip[];
}) {
  const { th } = useTheme();
  const [open, setOpen] = useState(false);
  const safeImageUrl = announcement?.imageUrl?.replace(/['"\\()]/g, '') ?? null;
  const hasImage = !!safeImageUrl;
  const ink = hasImage ? '#fff' : HERO_INK;
  const inkMuted = hasImage ? 'rgba(255,255,255,0.78)' : HERO_INK_MUTED;

  const bg: React.CSSProperties = safeImageUrl
    ? { backgroundImage: `linear-gradient(rgba(18,22,30,0.62), rgba(18,22,30,0.55)), url('${safeImageUrl}')`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: HERO_GRADIENT };

  const interactive = !!announcement;
  const openSheet = () => { if (interactive) setOpen(true); };

  const goMatches = (e: React.MouseEvent) => {
    e.stopPropagation();
    document.getElementById('ch-matches')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div style={{ padding: '16px 20px 0' }}>
      <div
        data-testid="clubhouse-hero"
        {...(interactive ? {
          role: 'button', tabIndex: 0,
          'aria-label': `Lire l'annonce : ${announcement.title}`,
          onClick: openSheet,
          onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSheet(); } },
        } : {})}
        style={{ ...bg, borderRadius: 22, padding: '28px 22px 22px', color: ink, cursor: interactive ? 'pointer' : 'default' }}
      >
        <div style={{ fontFamily: th.fontBrand, fontSize: 14, letterSpacing: 0.6, color: inkMuted }}>{clubName}</div>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, lineHeight: 1.12, letterSpacing: -0.5, marginTop: 8, maxWidth: 560 }}>
          {announcement ? announcement.title : 'Réservez, jouez, retrouvez-vous.'}
        </div>
        {announcement?.body && (
          <p style={{ fontFamily: th.fontUI, fontSize: 14.5, color: inkMuted, lineHeight: 1.5, margin: '8px 0 0', maxWidth: 520, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {announcement.body}
          </p>
        )}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
          <Link href="/reserver" onClick={(e) => e.stopPropagation()} style={{
            background: hasImage ? '#fff' : HERO_INK, color: hasImage ? '#1d2733' : '#f7f6f0',
            borderRadius: 12, padding: '11px 18px', fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, textDecoration: 'none',
          }}>
            Réserver un terrain
          </Link>
          {announcement?.linkUrl && (
            <a href={announcement.linkUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
              aria-label={`En savoir plus sur : ${announcement.title}`}
              style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, color: ink, textDecoration: 'none', padding: '11px 6px' }}>
              En savoir plus →
            </a>
          )}
        </div>
        {pulse.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 16 }}>
            {pulse.map((c) => {
              const style: React.CSSProperties = {
                display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '6px 12px',
                background: hasImage ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.5)',
                fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: ink,
              };
              return c.kind === 'matches' ? (
                <button key={c.kind} type="button" onClick={goMatches} style={{ ...style, border: 'none', cursor: 'pointer' }}>
                  <Icon name={PULSE_ICON[c.kind]} size={13} color={ink} />{c.label}
                </button>
              ) : (
                <span key={c.kind} style={style}>
                  <Icon name={PULSE_ICON[c.kind]} size={13} color={ink} />{c.label}
                </span>
              );
            })}
          </div>
        )}
      </div>
      {open && announcement && <AnnouncementSheet announcement={announcement} onClose={() => setOpen(false)} />}
    </div>
  );
}
```

`AnnouncementSheet` : copie inchangée depuis `HeroAnnouncement.tsx`.

- [ ] **Step 2: migrer les tests.** `git mv`/recréer `ClubHouseHero.test.tsx` avec les cas existants adaptés (clamp corps, ouverture top-sheet au clic + clavier, CTA lien externe `stopPropagation`, CTA Réserver) + nouveaux cas : hero sans annonce (accroche + surtitre club, pas de `role=button`), chips du pouls rendues, chip parties = bouton. Supprimer `HeroAnnouncement.test.tsx`.
- [ ] **Step 3: rouge → vert** — `node node_modules/jest/bin/jest.js ClubHouseHero` → PASS
- [ ] **Step 4: commit** `feat(club-house): hero immersif ClubHouseHero (absorbe HeroAnnouncement) + pouls du club`

### Task 4: `OpenMatchesShowcase` (remplace le rail)

**Files:**
- Create: `frontend/components/clubhouse/OpenMatchesShowcase.tsx`
- Delete: `frontend/components/clubhouse/OpenMatchesRail.tsx`
- Test: `frontend/__tests__/OpenMatchesShowcase.test.tsx` (remplace `OpenMatchesRail.test.tsx`, supprimé)

- [ ] **Step 1: composant.**

```tsx
'use client';
import Link from 'next/link';
import { OpenMatch } from '@/lib/api';
import { matchSeats } from '@/lib/clubhouse';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { formatDateShortTimeRange } from '@/lib/tournament';
import { rangeLabel } from '@/lib/levelMatch';
import { colorForSeed } from '@/lib/playerColors';
import { Avatar } from '@/components/ui/Avatar';
import { SectionHeader, cardStyle } from '@/components/clubhouse/SectionHeader';

// Section vedette « Ça joue bientôt » : grandes cartes parties ouvertes en défilement
// horizontal snap. On VOIT les places à prendre (sièges vides en pointillés).
export function OpenMatchesShowcase({ matches, timezone }: { matches: OpenMatch[]; timezone: string }) {
  const { th } = useTheme();
  if (matches.length === 0) return null;
  return (
    <section id="ch-matches">
      <SectionHeader title="Ça joue bientôt" action={{ label: 'Toutes les parties →', href: '/parties' }} />
      <div className="sp-scroll-x" style={{ display: 'flex', gap: 12, margin: '0 -20px', padding: '4px 20px 14px', scrollSnapType: 'x mandatory' }}>
        {matches.slice(0, 6).map((m) => {
          const empty = matchSeats(m);
          const urgent = !m.full && m.spotsLeft === 1;
          const level = (m.targetLevelMin != null || m.targetLevelMax != null)
            ? rangeLabel(m.targetLevelMin ?? null, m.targetLevelMax ?? null) : null;
          return (
            <article key={m.id} style={{ ...cardStyle(th), flex: '0 0 272px', scrollSnapAlign: 'start', padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, letterSpacing: -0.2, color: th.text }}>
                  {formatDateShortTimeRange(m.startTime, m.endTime, timezone)}
                </div>
                <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 3 }}>
                  {m.resourceName}{level ? ` · ${level}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }} aria-label={m.full ? 'Complet' : `${m.spotsLeft} place${m.spotsLeft > 1 ? 's' : ''} à prendre`}>
                {m.players.map((p, i) => (
                  <span key={p.userId} style={{ marginLeft: i === 0 ? 0 : -9, borderRadius: '50%', boxShadow: `0 0 0 2.5px ${th.surface}`, lineHeight: 0 }}>
                    <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl} size={36} color={colorForSeed(p.userId)} />
                  </span>
                ))}
                {Array.from({ length: empty }, (_, i) => (
                  <span key={`e${i}`} data-testid="empty-seat" aria-hidden="true" style={{
                    width: 36, height: 36, borderRadius: '50%', marginLeft: -9, boxSizing: 'border-box',
                    border: `2px dashed ${urgent ? ACCENTS.coral : th.lineStrong}`, background: th.surface,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: th.fontUI, fontSize: 15, fontWeight: 700, color: urgent ? ACCENTS.coral : th.textFaint,
                  }}>+</span>
                ))}
                <span style={{ marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', borderRadius: 999, padding: '4px 10px',
                  background: m.full ? th.surface2 : urgent ? (th.mode === 'floodlit' ? `${ACCENTS.coral}26` : `${ACCENTS.coral}33`) : (th.mode === 'floodlit' ? `${th.accent}26` : `${th.accent}33`),
                  color: m.full ? th.textMute : urgent ? (th.mode === 'floodlit' ? ACCENTS.coral : th.ink) : (th.mode === 'floodlit' ? th.accent : th.ink) }}>
                  {m.full ? 'Complet' : `${m.spotsLeft} place${m.spotsLeft > 1 ? 's' : ''}`}
                </span>
              </div>
              <Link href={`/parties/${m.id}`} aria-label={`${m.full ? 'Voir' : 'Rejoindre'} la partie du ${formatDateShortTimeRange(m.startTime, m.endTime, timezone)}`} style={{
                textAlign: 'center', textDecoration: 'none', borderRadius: 11, padding: '10px 12px',
                fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700,
                background: m.full ? th.surface2 : th.accent, color: m.full ? th.text : th.onAccent,
              }}>
                {m.full ? 'Voir la partie' : 'Rejoindre'}
              </Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: tests** `OpenMatchesShowcase.test.tsx` : rend N cartes (max 6), sièges vides = `matchSeats` (`getAllByTestId('empty-seat')`), chip « 1 place » quand `spotsLeft=1`, « Complet » + CTA « Voir la partie » quand `full`, CTA « Rejoindre » → `/parties/{id}`, lien « Toutes les parties → », niveau `rangeLabel` affiché. Supprimer `OpenMatchesRail.test.tsx`.
- [ ] **Step 3: rouge → vert** — `node node_modules/jest/bin/jest.js OpenMatchesShowcase`
- [ ] **Step 4: commit** `feat(club-house): section vedette Ca joue bientot (cartes parties, sieges vides)`

### Task 5: câblage `ClubHouse.tsx` (hero toujours, nouvel ordre, sections inline restylées)

**Files:**
- Modify: `frontend/components/ClubHouse.tsx`
- Test: `frontend/__tests__/ClubHouse.test.tsx` (mise à jour)

- [ ] **Step 1:**
  - Remplacer imports `HeroAnnouncement`/`OpenMatchesRail` par `ClubHouseHero`/`OpenMatchesShowcase`/`SectionHeader`+`cardStyle` ; importer `clubPulse`.
  - `upcomingMatches.slice(0, 6)` passé au showcase.
  - Hero rendu **toujours** : `<ClubHouseHero clubName={club.name} announcement={hero} pulse={clubPulse({ slots, matchCount: upcomingMatches.length, nextEventStart: nextEvents[0]?.startTime ?? null, now: clock, timezone: club.timezone })} />`.
  - `sectionTitle` supprimé ; sections « Vos prochaines réservations » et « Annonces » passent au `SectionHeader` + `cardStyle(th)` (rangées internes inchangées, bordures inset supprimées).
  - `wrap` : `padding: '30px 20px 0'`.
  - Ordres : membre `['matches','actionGrid','myReservations','posters','top','offers','clubCard','announcements']` ; visiteur `['matches','clubCard','actionGrid','posters','offers','top','announcements']`.
- [ ] **Step 2: mettre à jour `ClubHouse.test.tsx`** (ordres, hero toujours rendu, mocks : le composant appelle déjà toutes les API — vérifier que les mocks existants couvrent).
- [ ] **Step 3:** `node node_modules/jest/bin/jest.js ClubHouse` → PASS
- [ ] **Step 4: commit** `feat(club-house): rewiring hero permanent + parties en tete + rythme editorial`

### Task 6: restylage `SlotsAlaUne` + `TournamentsAlaUne`

**Files:**
- Modify: `frontend/components/clubhouse/SlotsAlaUne.tsx`, `frontend/components/clubhouse/TournamentsAlaUne.tsx`

- [ ] **Step 1:** les deux cartes passent à `cardStyle(th)` (padding '16px', radius via cardStyle) ; en-tête : icône dans une tuile teintée 26px (pattern AgendaCard) + titre `fontUI 13.5 weight 800` couleur `th.text` (plus d'uppercase gris) ; rangées `th.surface2` radius 12 ; heure/nom en 14/600 ; prix en `th.fontMono`.
- [ ] **Step 2:** suites existantes (`ClubHouse.test`, `clubhouse.test`) → PASS ; tsc → 0.
- [ ] **Step 3: commit** `feat(club-house): cartes creneaux/events au langage editorial`

### Task 7: `OffersShowcase` en rail compact

**Files:**
- Modify: `frontend/components/clubhouse/OffersShowcase.tsx`
- Test: `frontend/__tests__/OffersShowcase.test.tsx` (mise à jour si structure asserted)

- [ ] **Step 1:** remplacer `.of-grid` par un rail `.sp-scroll-x` (`display:flex; gap:12; margin:'0 -16px'; padding:'4px 16px 8px'`), cartes `flex:'0 0 236px'` fond `th.surface2` radius 14 ; **prix en vedette** (`fontDisplay 26 weight 700 color th.text` + suffixe « / mois » 13 mute) ; bénéfices en 2 lignes max (12.5 mute, sans puces) ; CTA fin (`Btn` → bouton pill outline accent hauteur 38). Section coiffée du `SectionHeader('Abonnements & offres')`. Flux Stripe/dialog inchangé.
- [ ] **Step 2:** `node node_modules/jest/bin/jest.js OffersShowcase` → PASS (adapter les assertions de structure si besoin, les cas fonctionnels — achat, gating anonyme, pas de Stripe — inchangés)
- [ ] **Step 3: commit** `feat(club-house): offres en rail compact, prix en vedette`

### Task 8: `TopOfMonth` en podium visuel

**Files:**
- Modify: `frontend/components/clubhouse/TopOfMonth.tsx`
- Test: `frontend/__tests__/TopOfMonth.test.tsx` (mise à jour)

- [ ] **Step 1:** 3 colonnes ordre visuel **2-1-3** (`order` flex), chaque colonne : avatar (44/56/44, anneau or pour le 1er), nom (13 600), victoires en gros chiffre (`fontDisplay` 22/28/22), **marche** rectangulaire (hauteurs 44/64/36, radius 10 10 0 0, teintes or/argent/bronze translucides : `#d4a53f`, `#9aa3ad`, `#b3805a` à ~33 % d'alpha, chiffre de rang au centre). Médailles emoji conservées en petit sur la marche. Carte englobante `cardStyle(th)` + `SectionHeader('Le top du mois')` à l'intérieur ? Non : le SectionHeader vit hors carte (cohérence des sections) — la carte ne contient que le podium.
- [ ] **Step 2:** `node node_modules/jest/bin/jest.js TopOfMonth` → PASS (les 3 noms + victoires restent asserted ; garder l'ordre DOM 1-2-3 avec `order` CSS pour l'accessibilité)
- [ ] **Step 3: commit** `feat(club-house): podium visuel top du mois`

### Task 9: `ClubPresentationCard` éditoriale

**Files:**
- Modify: `frontend/components/clubhouse/ClubPresentationCard.tsx`
- Test: `frontend/__tests__/ClubPresentationCard.test.tsx` (mise à jour si besoin)

- [ ] **Step 1:** avec cover : image 180px + **voile dégradé bas** (`linear-gradient(transparent 30%, rgba(18,22,30,0.72))`) et nom du club en surimpression blanche (`fontDisplay 22`), extrait + miniatures + « Découvrir le club → » dessous ; sans cover : forme actuelle mais `cardStyle(th)`. Le micro-titre uppercase disparaît (le `SectionHeader('Le club')` est posé par `ClubHouse.tsx`… non — cette carte est autonome : garder le repère « Le club » en chip discrète sur la cover). Décision : `ClubHouse` pose `SectionHeader('Le club')` au-dessus de la carte ; la carte perd son micro-titre interne.
- [ ] **Step 2:** suites → PASS ; tsc → 0.
- [ ] **Step 3: commit** `feat(club-house): carte club editoriale (cover + surimpression)`

### Task 10: harmonisation `PosterMosaic` + `SponsorMarquee` + annonces

**Files:**
- Modify: `frontend/components/clubhouse/PosterMosaic.tsx` (léger : radius/ombre via `cardStyle` sur les tuiles si applicable), `frontend/components/ClubHouse.tsx` (annonces resserrées), `frontend/components/clubhouse/SponsorMarquee.tsx` (en-tête → `SectionHeader`)
- [ ] **Step 1:** appliquer ; suites `PosterMosaic`/`SponsorMarquee` → PASS.
- [ ] **Step 2: commit** `feat(club-house): harmonisation affiches/partenaires/annonces`

### Task 11: vérification globale + visuelle + docs

- [ ] **Step 1:** `node node_modules/jest/bin/jest.js clubhouse ClubHouse ClubHouseHero OpenMatchesShowcase OffersShowcase TopOfMonth ClubPresentationCard PosterMosaic SponsorMarquee HeroAnnouncement` (la dernière ne doit plus exister) + `node node_modules/typescript/bin/tsc --noEmit`
- [ ] **Step 2:** vérifier qu'aucun autre fichier n'importe `HeroAnnouncement`/`OpenMatchesRail` (`grep -r`)
- [ ] **Step 3:** screenshots CDP membre/visiteur × 390/1280 × clair/sombre ; itérer sur le rendu jusqu'à niveau « agence ».
- [ ] **Step 4:** section CLAUDE.md (évolution 2026-07-05 redesign Club-house) + commit final + push.
