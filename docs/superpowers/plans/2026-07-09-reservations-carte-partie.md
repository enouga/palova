# Réservations — carte alignée sur « Mes parties » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make padel reservation cards in « Mes réservations » (Calendrier + À venir/Passées)
look and act like the `OpenMatchCard` used on « Mes parties » — places chip, sport/niveau
chips, Discuter/Partager, Annuler — by extracting the currently-duplicated rendering logic
of `DayPanel.tsx`/`MyAgendaListItem.tsx` into one shared component.

**Architecture:** New presentational component `ReservationAgendaCard` renders the full
body of a padel reservation (header, meta chips, mini-terrain, action footer). Both
`DayPanel` and `MyAgendaListItem` call it for non-foreign padel entries and keep their
existing code untouched for everything else (foreign entries, non-padel sports,
tournaments/events/lessons). The reservation's own chat sheet (`OpenMatchChatSheet`) is
mounted once at the page level (`app/me/reservations/page.tsx`), exactly like
`OpenMatchModals` does for `/parties` — the card only calls `onOpenChat(reservation)`.

**Tech Stack:** Next.js 16 (App Router) / React 19 / TypeScript, Jest + React Testing
Library, existing design-system atoms (`Btn`, `Chip`, `Icon`) and `MatchTeams`/
`ReservationPlayersInline`/`OpenMatchChatSheet`/`MatchShareButton` components.

Spec: `docs/superpowers/specs/2026-07-09-reservations-carte-partie-design.md`

---

### Task 1: Create `ReservationAgendaCard`

**Files:**
- Create: `frontend/components/reservations/ReservationAgendaCard.tsx`
- Test: `frontend/__tests__/ReservationAgendaCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ReservationAgendaCard } from '../components/reservations/ReservationAgendaCard';
import { ThemeProvider } from '../lib/ThemeProvider';
import { MyReservation } from '../lib/api';

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    addReservationPlayer: jest.fn().mockResolvedValue({ id: 'r1', capacity: 4, participants: [] }),
    removeReservationPlayer: jest.fn().mockResolvedValue({ id: 'r1', capacity: 4, participants: [] }),
    setReservationTeams: jest.fn().mockResolvedValue({ id: 'r1', capacity: 4, participants: [] }),
    searchClubMembers: jest.fn().mockResolvedValue([]),
    listClubFriends: jest.fn().mockResolvedValue([]),
    setReservationVisibility: jest.fn().mockResolvedValue({ id: 'r1', visibility: 'PUBLIC', targetLevelMin: null, targetLevelMax: null }),
  },
}));

const now = Date.now();
const future = new Date(now + 48 * 3600e3).toISOString();
const futureEnd = new Date(now + 48 * 3600e3 + 3600e3).toISOString();
const past = new Date(now - 48 * 3600e3).toISOString();
const pastEnd = new Date(now - 48 * 3600e3 + 3600e3).toISOString();

function mkRes(over: Record<string, unknown> = {}): MyReservation {
  return {
    id: 'r1', startTime: future, endTime: futureEnd, status: 'CONFIRMED', totalPrice: '25',
    resource: { id: 'res1', name: 'Terrain 1', sport: { key: 'padel', name: 'Padel' }, club: { name: 'Padel Arena', slug: 'demo', timezone: 'Europe/Paris' } },
    capacity: 4,
    participants: [
      { id: 'p-org', userId: 'u-org', isOrganizer: true, firstName: 'Org', lastName: 'A', avatarUrl: null },
    ],
    ...over,
  } as MyReservation;
}

function renderCard(over: Partial<React.ComponentProps<typeof ReservationAgendaCard>> = {}) {
  return render(
    <ThemeProvider>
      <ReservationAgendaCard
        reservation={mkRes()} past={false} token="abc" now={now}
        onCancel={jest.fn()} onPlayersChanged={jest.fn()} onOpenChat={jest.fn()}
        {...over}
      />
    </ThemeProvider>,
  );
}

describe('ReservationAgendaCard', () => {
  it('à venir, privée : chip "N places", Annuler actif, pas de Discuter/Partager', () => {
    renderCard();
    expect(screen.getByText('3 places')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Discuter/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Partager/ })).not.toBeInTheDocument();
  });

  it('complet : chip "Complet"', () => {
    const full = [0, 1, 2, 3].map((i) => ({ id: `p${i}`, userId: `u${i}`, isOrganizer: i === 0, firstName: 'P', lastName: `${i}`, avatarUrl: null }));
    renderCard({ reservation: mkRes({ participants: full }) });
    expect(screen.getByText('Complet')).toBeInTheDocument();
  });

  it('passée : pas de chip de places', () => {
    renderCard({ reservation: mkRes({ startTime: past, endTime: pastEnd }), past: true });
    expect(screen.queryByText(/^\d+ places?$/)).not.toBeInTheDocument();
    expect(screen.queryByText('Complet')).not.toBeInTheDocument();
  });

  it('partie ouverte publique à venir : chip niveau + Discuter (appelle onOpenChat) + Partager', () => {
    const onOpenChat = jest.fn();
    renderCard({
      reservation: mkRes({ visibility: 'PUBLIC', targetLevelMin: 4.2, targetLevelMax: 6.8 }),
      onOpenChat,
    });
    expect(screen.getByText('Niveau 4,2 à 6,8')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Discuter/ }));
    expect(onOpenChat).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
    expect(screen.getByRole('button', { name: /Partager/ })).toBeInTheDocument();
  });

  it('partie privée : pas de Discuter/Partager même à venir', () => {
    renderCard({ reservation: mkRes({ visibility: 'PRIVATE' }) });
    expect(screen.queryByRole('button', { name: /Discuter/ })).not.toBeInTheDocument();
  });

  it('sans token : pas de Discuter/Partager même publique', () => {
    renderCard({ reservation: mkRes({ visibility: 'PUBLIC' }), token: null });
    expect(screen.queryByRole('button', { name: /Discuter/ })).not.toBeInTheDocument();
  });

  it('passée, résultat déjà enregistré : libellé de statut, pas de bouton Saisir le résultat', () => {
    renderCard({
      reservation: mkRes({ startTime: past, endTime: pastEnd }), past: true,
      existingMatchStatus: 'CONFIRMED', canRecord: () => false,
    });
    expect(screen.getByText('Résultat enregistré')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Saisir le résultat/ })).not.toBeInTheDocument();
  });

  it('passée, saisie possible : bouton Saisir le résultat déclenche onRecordResult', () => {
    const onRecordResult = jest.fn();
    renderCard({
      reservation: mkRes({ startTime: past, endTime: pastEnd }), past: true,
      canRecord: () => true, onRecordResult,
    });
    fireEvent.click(screen.getByRole('button', { name: /Saisir le résultat/ }));
    expect(onRecordResult).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
  });

  it('affiche le chip sport quand showSport', () => {
    renderCard({ showSport: true });
    expect(screen.getByText('Padel')).toBeInTheDocument();
  });

  it('showDate ajoute la date devant l’heure (utilisé par la vue liste, pas le Calendrier)', () => {
    renderCard({ showDate: true });
    expect(screen.getByText(/· \d{2}h\d{2}–\d{2}h\d{2}/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/ReservationAgendaCard.test.tsx`
Expected: FAIL — `Cannot find module '../components/reservations/ReservationAgendaCard'`

- [ ] **Step 3: Write the component**

```tsx
'use client';

import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Btn, Chip } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { MyReservation } from '@/lib/api';
import { isCancellationOpen } from '@/lib/reservations';
import { rangeLabel } from '@/lib/levelMatch';
import { MatchShareButton } from '@/components/openmatch/MatchShareButton';
import { ReservationPlayersInline } from '@/components/reservations/ReservationPlayersInline';
import { MatchTeams } from '@/components/match/MatchTeams';

const MATCH_STATUS_LABEL: Record<string, string> = { PENDING: 'À confirmer', CONFIRMED: 'Résultat enregistré', DISPUTED: 'En litige' };

function fmtHour(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}
function fmtDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
}

export interface ReservationAgendaCardProps {
  reservation: MyReservation;
  past: boolean;
  /** Vue cross-club couvrant plusieurs sports → chip sport en plus du nom du club. */
  showSport?: boolean;
  /** Vue liste (pas de titre de jour au-dessus) → la date rejoint l'heure sur la ligne meta. */
  showDate?: boolean;
  token: string | null;
  now: number;
  onCancel: (r: MyReservation) => void;
  onPlayersChanged: () => void;
  /** Ouvre la feuille de chat de cette réservation — montée une seule fois au niveau de la page. */
  onOpenChat: (r: MyReservation) => void;
  onRecordResult?: (r: MyReservation) => void;
  canRecord?: (r: MyReservation) => boolean;
  existingMatchStatus?: 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'CANCELLED';
}

// Carte d'une réservation padel dans « Mes réservations » (Calendrier + À venir/Passées),
// alignée sur la présentation d'OpenMatchCard (chip places, chips sport/niveau, barre
// Discuter+Partager+Annuler) — extrait de DayPanel/MyAgendaListItem qui dupliquaient ce
// rendu. Le viewer est TOUJOURS l'organisateur ici (listUserReservations filtre son propre
// userId) : jamais de chip « Vous organisez »/« Quitter », Annuler est l'action utile.
export function ReservationAgendaCard({
  reservation: r, past, showSport, showDate = false, token, now,
  onCancel, onPlayersChanged, onOpenChat, onRecordResult, canRecord, existingMatchStatus,
}: ReservationAgendaCardProps) {
  const { th } = useTheme();

  const capacity = r.capacity ?? 0;
  const participants = r.participants ?? [];
  const spotsLeft = Math.max(0, capacity - participants.length);
  const full = spotsLeft <= 0;
  const isPublic = r.visibility === 'PUBLIC';
  const canCancel = !past && isCancellationOpen(r, now);
  const hasLevel = isPublic && (r.targetLevelMin != null || r.targetLevelMax != null);
  const showRecordBtn = past && !!canRecord?.(r) && !existingMatchStatus && !!onRecordResult;
  const matchStatusLabel = past && !!existingMatchStatus ? MATCH_STATUS_LABEL[existingMatchStatus] : null;
  const showChatShare = !past && isPublic && !!token;
  const hasFooter = !past || showRecordBtn || !!matchStatusLabel;

  const tint = (hex: string) => ({
    background: th.mode === 'floodlit' ? `${hex}1f` : `${hex}55`,
    color: th.mode === 'floodlit' ? hex : th.ink,
  });
  const chatTint = tint(ACCENTS.emerald);
  const actionBtn = { height: 38, fontSize: 13.5, padding: '0 14px' } as const;

  const tz = r.resource.club.timezone;
  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/parties/${r.id}` : `/parties/${r.id}`;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 16, color: th.text }}>{r.resource.name}</span>
        {!past && <Chip tone={full ? 'mute' : 'accent'}>{full ? 'Complet' : `${spotsLeft} place${spotsLeft > 1 ? 's' : ''}`}</Chip>}
      </div>
      <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 2 }}>{r.resource.club.name}</div>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 8, fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Icon name="clock" size={14} color={th.textMute} />
          {showDate ? `${fmtDate(r.startTime, tz)} · ` : ''}{fmtHour(r.startTime, tz)}–{fmtHour(r.endTime, tz)}
        </span>
        <span style={{ fontFamily: th.fontMono }}>{Number(r.totalPrice)}€</span>
        {showSport && r.resource.sport && <Chip tone="line">{r.resource.sport.name}</Chip>}
        {hasLevel && <Chip tone="line">{rangeLabel(r.targetLevelMin ?? null, r.targetLevelMax ?? null)}</Chip>}
      </div>

      {!past && token ? (
        <ReservationPlayersInline reservation={r} token={token} now={now} onChanged={onPlayersChanged} />
      ) : participants.length > 0 ? (
        <div style={{ marginTop: 10 }}>
          <MatchTeams
            players={participants.map((p) => ({
              userId: p.userId, firstName: p.firstName, lastName: p.lastName,
              avatarUrl: p.avatarUrl, isOrganizer: p.isOrganizer, level: p.level,
              team: (p.team ?? 1) as 1 | 2, slot: p.slot,
            }))}
            capacity={capacity}
            size="sm"
          />
        </div>
      ) : null}

      {hasFooter && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: `1px solid ${th.line}` }}>
          {showChatShare && (
            <>
              <Btn variant="surface" style={{ ...actionBtn, ...chatTint }} onClick={() => onOpenChat(r)}>Discuter</Btn>
              <MatchShareButton compact style={actionBtn} title={r.resource.name} url={shareUrl} />
            </>
          )}
          {showRecordBtn && (
            <Btn variant="surface" style={actionBtn} onClick={() => onRecordResult!(r)}>Saisir le résultat</Btn>
          )}
          {matchStatusLabel && !showRecordBtn && (
            <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>{matchStatusLabel}</span>
          )}
          {!past && (
            <span style={{ marginLeft: 'auto' }}>
              <button onClick={() => onCancel(r)} disabled={!canCancel}
                style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: canCancel ? 'pointer' : 'not-allowed', borderRadius: 9, padding: '5px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: canCancel ? '#ff7a4d' : th.textFaint }}>
                Annuler
              </button>
            </span>
          )}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/ReservationAgendaCard.test.tsx`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/reservations/ReservationAgendaCard.tsx frontend/__tests__/ReservationAgendaCard.test.tsx
git commit -m "feat(reservations): ReservationAgendaCard aligned on OpenMatchCard presentation"
```

---

### Task 2: Wire into `MyAgendaListItem.tsx`

**Files:**
- Modify: `frontend/components/calendar/MyAgendaListItem.tsx`
- Test: `frontend/__tests__/MyAgendaListItem.test.tsx`

- [ ] **Step 1: Update the test file's shared props and add a coverage test**

In `frontend/__tests__/MyAgendaListItem.test.tsx`, update `baseProps` (a new required prop is
added) and append a test proving the padel/non-foreign path now renders the new card:

```tsx
const baseProps = {
  now: Date.parse('2029-12-01T00:00:00Z'),
  localSlug: null,
  token: null,
  onCancel: jest.fn(),
  onPlayersChanged: jest.fn(),
  onOpenChat: jest.fn(),
};
```

Append at the end of the file:

```tsx
describe('MyAgendaListItem — carte alignée sur Mes parties (padel, non-étranger)', () => {
  it('affiche le chip de places et transmet le clic Discuter via onOpenChat', () => {
    const onOpenChat = jest.fn();
    const item = {
      kind: 'reservation' as const,
      id: 'r1',
      start: '2030-01-01T10:00:00Z',
      past: false,
      r: {
        id: 'r1', startTime: '2030-01-01T10:00:00Z', endTime: '2030-01-01T11:00:00Z',
        status: 'CONFIRMED', totalPrice: '25', visibility: 'PUBLIC',
        resource: { id: 'res1', name: 'Terrain 1', sport: { key: 'padel', name: 'Padel' }, club: { name: 'Demo', slug: 'demo', timezone: 'Europe/Paris' } },
        capacity: 4,
        participants: [
          { id: 'p1', userId: 'u1', isOrganizer: true, firstName: 'Paul', lastName: 'B', avatarUrl: null, team: 1, slot: 0 },
        ],
      },
    };
    render(
      <ThemeProvider>
        <MyAgendaListItem {...baseProps} token="abc" item={item as any} onOpenChat={onOpenChat} />
      </ThemeProvider>,
    );
    expect(screen.getByText('3 places')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Discuter/ }));
    expect(onOpenChat).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
  });
});
```

Add `fireEvent` to the existing `@testing-library/react` import at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/MyAgendaListItem.test.tsx`
Expected: FAIL — `onOpenChat` prop missing / "Discuter" button not found.

- [ ] **Step 3: Wire the component**

In `frontend/components/calendar/MyAgendaListItem.tsx`:

Add the import:

```tsx
import { ReservationAgendaCard } from '@/components/reservations/ReservationAgendaCard';
```

Add `onOpenChat` to the props destructure and type:

```tsx
export function MyAgendaListItem({ item, now, localSlug, token, onCancel, onPlayersChanged, onOpenChat, onRecordResult, canRecord, existingMatchStatus, showSport }: {
  item: AgendaListItem;
  now: number;
  localSlug: string | null;
  token: string | null;
  onCancel: (r: MyReservation) => void;
  onPlayersChanged: () => void;
  onOpenChat: (r: MyReservation) => void;
  onRecordResult?: (r: MyReservation) => void;
  canRecord?: (r: MyReservation) => boolean;
  existingMatchStatus?: 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'CANCELLED';
  showSport?: boolean;
}) {
```

Replace the `if (item.kind === 'reservation') { ... }` block with:

```tsx
  if (item.kind === 'reservation') {
    const r = item.r;
    const isPadel = r.resource.sport?.key === 'padel';
    if (!isForeign && isPadel) {
      body = (
        <ReservationAgendaCard
          reservation={r} past={item.past} showSport={showSport} showDate token={token} now={now}
          onCancel={onCancel} onPlayersChanged={onPlayersChanged} onOpenChat={onOpenChat}
          onRecordResult={onRecordResult} canRecord={canRecord} existingMatchStatus={existingMatchStatus}
        />
      );
    } else {
      const canCancel = isCancellationOpen(r, now);
      const showRecord = item.past && !isForeign && canRecord?.(r) && !existingMatchStatus;
      const MATCH_STATUS_LABEL: Record<string, string> = { PENDING: 'À confirmer', CONFIRMED: 'Résultat enregistré', DISPUTED: 'En litige' };
      body = (
        <>
          <div style={headRow}>
            <span style={title}>{r.resource.name}</span>
            <Chip tone={r.status === 'CONFIRMED' ? 'accent' : 'line'}>{STATUS_LABEL[r.status]}</Chip>
          </div>
          <div style={subtitle}>{sportPrefix}{r.resource.club.name}</div>
          <div style={metaRow}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="calendar" size={14} color={th.textMute} />{fmtDate(r.startTime, tz)} · {fmtHour(r.startTime, tz)}–{fmtHour(r.endTime, tz)}</span>
            <span style={{ fontFamily: th.fontMono }}>{Number(r.totalPrice)}€</span>
            {isForeign ? goHint : (!item.past && (
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button onClick={() => onCancel(r)} disabled={!canCancel} style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: canCancel ? 'pointer' : 'not-allowed', borderRadius: 9, padding: '5px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: canCancel ? '#ff7a4d' : th.textFaint }}>Annuler</button>
              </span>
            ))}
          </div>
          {showRecord && onRecordResult && (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => onRecordResult(r)} style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '5px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text }}>Saisir le résultat</button>
            </div>
          )}
          {item.past && !isForeign && existingMatchStatus && MATCH_STATUS_LABEL[existingMatchStatus] && (
            <div style={{ marginTop: 8, fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>{MATCH_STATUS_LABEL[existingMatchStatus]}</div>
          )}
          {!isForeign && !item.past && token ? (
            <ReservationPlayersInline reservation={r} token={token} now={now} onChanged={onPlayersChanged} />
          ) : (r.participants?.length ?? 0) > 0 ? (
            <div style={{ marginTop: 9 }}>
              {r.resource.sport?.key === 'padel' ? (
                <MatchTeams
                  players={(r.participants ?? []).map((p) => ({
                    userId: p.userId, firstName: p.firstName, lastName: p.lastName,
                    avatarUrl: p.avatarUrl, isOrganizer: p.isOrganizer, level: p.level,
                    team: (p.team ?? 1) as 1 | 2,
                    slot: p.slot,
                  }))}
                  capacity={r.capacity ?? 4}
                  size="sm"
                />
              ) : (
                <PlayerPills
                  players={r.participants ?? []}
                  spotsLeft={Math.max(0, (r.capacity ?? 0) - (r.participants?.length ?? 0))}
                  size="sm"
                />
              )}
            </div>
          ) : null}
        </>
      );
    }
  } else if (item.kind === 'lesson') {
```

This `else` branch is reached for **foreign** entries (including foreign padel ones) or non-padel
sports — it must keep the exact original `sport?.key === 'padel' ? <MatchTeams/> : <PlayerPills/>`
fork, since a foreign padel reservation still needs its (read-only) mini-terrain. Only the
**non-foreign padel** case is redirected to `ReservationAgendaCard` above. Do NOT remove the
`MatchTeams` import from this file — it's still used here.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/MyAgendaListItem.test.tsx`
Expected: PASS (all tests, including the new one)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/calendar/MyAgendaListItem.tsx frontend/__tests__/MyAgendaListItem.test.tsx
git commit -m "feat(reservations): brancher ReservationAgendaCard dans MyAgendaListItem"
```

---

### Task 3: Wire into `DayPanel.tsx`

**Files:**
- Modify: `frontend/components/calendar/DayPanel.tsx`
- Test: `frontend/__tests__/DayPanel.test.tsx`

- [ ] **Step 1: Add failing tests**

Append to `frontend/__tests__/DayPanel.test.tsx` (the existing `renderPanel` helper needs a default
`onOpenChat` — see step below):

```tsx
describe('DayPanel — carte alignée sur Mes parties (padel, non-étranger)', () => {
  const padelRes: MyReservation = {
    id: 'res-padel',
    startTime: futureStart,
    endTime: futureEnd,
    status: 'CONFIRMED',
    totalPrice: '25',
    visibility: 'PUBLIC',
    resource: { id: 'court-1', name: 'Court 1', sport: { key: 'padel', name: 'Padel' }, club: { name: 'Padel Arena', slug: 'padel-arena', timezone: 'Europe/Paris' } },
    capacity: 4,
    participants: [
      { id: 'p1', userId: 'u-org', isOrganizer: true, firstName: 'Org', lastName: 'A', avatarUrl: null },
    ],
  };

  it('affiche le chip de places et transmet le clic Discuter via onOpenChat', () => {
    const onOpenChat = jest.fn();
    renderPanel({
      entries: buildCalendarEntries([padelRes], [], [], [], NOW),
      onOpenChat,
    });
    expect(screen.getByText('3 places')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Discuter/ }));
    expect(onOpenChat).toHaveBeenCalledWith(expect.objectContaining({ id: 'res-padel' }));
  });

  it('transmet existingMatchStatus via matchStatusFor pour une résa passée', () => {
    const pastRes = { ...padelRes, startTime: '2020-01-01T10:00:00Z', endTime: '2020-01-01T11:00:00Z' };
    renderPanel({
      entries: buildCalendarEntries([pastRes], [], [], [], NOW),
      matchStatusFor: () => 'CONFIRMED',
    });
    expect(screen.getByText('Résultat enregistré')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Update `renderPanel` default props and imports**

```tsx
function renderPanel(props: Partial<React.ComponentProps<typeof DayPanel>> = {}) {
  return render(
    <ThemeProvider>
      <DayPanel
        dayKey="2026-06-12" entries={entries} localSlug={null}
        token="abc" now={Date.now()}
        onCancel={jest.fn()} onPlayersChanged={jest.fn()} onOpenChat={jest.fn()}
        onReserve={jest.fn()} reserveLabel="Réserver un créneau" {...props}
      />
    </ThemeProvider>,
  );
}
```

- [ ] **Step 3: Run the tests to verify the new ones fail**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/DayPanel.test.tsx`
Expected: FAIL — `onOpenChat` prop missing / "Discuter"/"Résultat enregistré" not found.

- [ ] **Step 4: Wire the component**

In `frontend/components/calendar/DayPanel.tsx`, add the import:

```tsx
import { ReservationAgendaCard } from '@/components/reservations/ReservationAgendaCard';
```

Extend the props:

```tsx
export function DayPanel({
  dayKey, entries, localSlug, token, now, onCancel, onPlayersChanged, onOpenChat, onReserve, reserveLabel,
  onRecordResult, canRecord, showSport, matchStatusFor,
}: {
  dayKey: string;
  entries: CalendarEntry[];
  localSlug: string | null;
  token: string | null;
  now: number;
  onCancel: (r: MyReservation) => void;
  onPlayersChanged: () => void;
  onOpenChat: (r: MyReservation) => void;
  onReserve: () => void;
  reserveLabel: string;
  onRecordResult?: (r: MyReservation) => void;
  canRecord?: (r: MyReservation) => boolean;
  showSport?: boolean;
  matchStatusFor?: (reservationId: string) => 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'CANCELLED' | undefined;
}) {
```

Replace the `if (e.kind === 'reservation') { ... }` block with:

```tsx
            if (e.kind === 'reservation') {
              const r = e.r;
              const tz = r.resource.club.timezone;
              const isForeign = localSlug != null && r.resource.club.slug !== localSlug;
              const isPadel = r.resource.sport?.key === 'padel';
              if (!isForeign && isPadel) {
                return card(
                  <ReservationAgendaCard
                    reservation={r} past={e.past} showSport={showSport} token={token} now={now}
                    onCancel={onCancel} onPlayersChanged={onPlayersChanged} onOpenChat={onOpenChat}
                    onRecordResult={onRecordResult} canRecord={canRecord}
                    existingMatchStatus={matchStatusFor?.(r.id)}
                  />,
                  `res-${r.id}`, agendaKindMeta('reservation').color, e.past,
                );
              }
              return card(
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15.5, color: th.text }}>{r.resource.name}</span>
                    <Chip tone={r.status === 'CONFIRMED' ? 'accent' : 'line'}>{STATUS_LABEL[r.status]}</Chip>
                  </div>
                  <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 2 }}>{showSport && r.resource.sport ? `${r.resource.sport.name} · ` : ''}{r.resource.club.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Icon name="clock" size={14} color={th.textMute} />{fmtHour(r.startTime, tz)}–{fmtHour(r.endTime, tz)}
                    </span>
                    <span style={{ fontFamily: th.fontMono }}>{Number(r.totalPrice)}€</span>
                    {isForeign ? (
                      <a href={clubUrl(r.resource.club.slug, '/me/reservations')} style={linkStyle}>Voir</a>
                    ) : (!e.past && (
                      <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        <button onClick={() => onCancel(r)} disabled={!isCancellationOpen(r, now)}
                          style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: isCancellationOpen(r, now) ? 'pointer' : 'not-allowed', borderRadius: 9, padding: '5px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: isCancellationOpen(r, now) ? '#ff7a4d' : th.textFaint }}>
                          Annuler
                        </button>
                      </span>
                    ))}
                  </div>
                  {!isForeign && !e.past && token ? (
                    <ReservationPlayersInline reservation={r} token={token} now={now} onChanged={onPlayersChanged} />
                  ) : (r.participants?.length ?? 0) > 0 ? (
                    <div style={{ marginTop: 10 }}>
                      {r.resource.sport?.key === 'padel' ? (
                        <MatchTeams
                          players={(r.participants ?? []).map((p) => ({
                            userId: p.userId, firstName: p.firstName, lastName: p.lastName,
                            avatarUrl: p.avatarUrl, isOrganizer: p.isOrganizer, level: p.level,
                            team: (p.team ?? 1) as 1 | 2,
                            slot: p.slot,
                          }))}
                          capacity={r.capacity ?? 4}
                          size="sm"
                        />
                      ) : (
                        <PlayerPills
                          players={r.participants ?? []}
                          spotsLeft={Math.max(0, (r.capacity ?? 0) - (r.participants?.length ?? 0))}
                          size="sm"
                        />
                      )}
                    </div>
                  ) : null}
                  {e.past && !isForeign && canRecord?.(r) && onRecordResult && (
                    <div style={{ marginTop: 8 }}>
                      <button onClick={() => onRecordResult(r)} style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '5px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text }}>Saisir le résultat</button>
                    </div>
                  )}
                </>,
                `res-${r.id}`, agendaKindMeta('reservation').color, e.past,
              );
            }
```

This fallback (reached for foreign entries, including foreign padel ones, or non-padel sports)
keeps the exact original `sport?.key === 'padel' ? <MatchTeams/> : <PlayerPills/>` fork — a foreign
padel reservation still needs its read-only mini-terrain. `MatchTeams` stays imported and used in
this file; only the **non-foreign padel** case above is redirected to `ReservationAgendaCard`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/DayPanel.test.tsx`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 6: Commit**

```bash
git add frontend/components/calendar/DayPanel.tsx frontend/__tests__/DayPanel.test.tsx
git commit -m "feat(reservations): brancher ReservationAgendaCard dans DayPanel"
```

---

### Task 4: Wire the chat sheet at the page level

**Files:**
- Modify: `frontend/app/me/reservations/page.tsx`
- Test: Create `frontend/__tests__/MyReservationsChat.test.tsx`

- [ ] **Step 1: Write the failing integration test**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MyReservationsPage from '../app/me/reservations/page';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => '/me/reservations',
}));
jest.mock('../lib/useAuth', () => ({
  useAuth: () => ({ token: 'abc', ready: true, clubId: null }),
  logout: jest.fn(),
}));
jest.mock('../components/ClubNav', () => ({ ClubNav: () => <div data-testid="nav" /> }));
jest.mock('../lib/ClubProvider', () => ({
  useClub: () => ({ slug: 'padel-arena', club: { name: 'Padel Arena' } }),
}));
jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  chatStreamUrl: () => 'http://x/stream',
  api: {
    getMyReservations: jest.fn(),
    getMyTournaments: jest.fn().mockResolvedValue([]),
    getMyEvents: jest.fn().mockResolvedValue([]),
    getMyLessons: jest.fn().mockResolvedValue([]),
    cancelReservation: jest.fn(),
    getMyMatches: jest.fn().mockResolvedValue([]),
    getMyQuotaStatus: jest.fn().mockResolvedValue(null),
    getChatMessages: jest.fn().mockResolvedValue([]),
    postChatMessage: jest.fn(),
    deleteChatMessage: jest.fn(),
  },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

// EventSource n'existe pas en jsdom : stub minimal (requis par OpenMatchChatSheet).
beforeAll(() => {
  (global as any).EventSource = class { onmessage: ((e: any) => void) | null = null; onerror: ((e: any) => void) | null = null; close() {} };
});

const start = (() => { const d = new Date(Date.now() + 24 * 3600e3); d.setUTCHours(12, 0, 0, 0); return d; })();

const reservation = {
  id: 'res-1',
  startTime: start.toISOString(),
  endTime: new Date(start.getTime() + 3600e3).toISOString(),
  status: 'CONFIRMED',
  totalPrice: '25.00',
  visibility: 'PUBLIC',
  capacity: 4,
  participants: [
    { id: 'p1', userId: 'u-org', isOrganizer: true, firstName: 'Eric', lastName: 'N', avatarUrl: null },
  ],
  resource: { id: 'court-1', name: 'Court 1', sport: { key: 'padel', name: 'Padel' }, club: { name: 'Padel Arena', slug: 'padel-arena', timezone: 'Europe/Paris' } },
};

describe('Mes réservations — chat de partie ouverte', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.getMyReservations.mockResolvedValue([reservation] as never);
    mocked.getMyTournaments.mockResolvedValue([] as never);
    mocked.getMyEvents.mockResolvedValue([] as never);
    mocked.getChatMessages.mockResolvedValue([] as never);
  });

  it('« Discuter » sur la carte d\'une partie ouverte (onglet À venir) ouvre la vraie feuille de chat', async () => {
    render(<ThemeProvider><MyReservationsPage /></ThemeProvider>);
    fireEvent.click(await screen.findByText(/À venir/));
    fireEvent.click(await screen.findByRole('button', { name: /Discuter/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(mocked.getChatMessages).toHaveBeenCalledWith('padel-arena', 'res-1', 'abc'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/MyReservationsChat.test.tsx`
Expected: FAIL — no "Discuter" button found (`onOpenChat` prop not yet wired), or a TS error on
the missing required prop once Tasks 2–3 land.

- [ ] **Step 3: Wire the page**

In `frontend/app/me/reservations/page.tsx`, add the import:

```tsx
import { OpenMatchChatSheet } from '@/components/openmatch/OpenMatchChatSheet';
```

Add state near the other `useState` calls (after `recordingFor`):

```tsx
  const [chatFor, setChatFor] = useState<MyReservation | null>(null);
```

Pass `onOpenChat={setChatFor}` to the `<DayPanel>` call and to the `<MyAgendaListItem>` call inside
the `list.map(...)`. Also pass `matchStatusFor={(rid) => matchFor(rid)?.status}` to `<DayPanel>`:

```tsx
                <DayPanel
                  dayKey={selectedDay}
                  entries={byDay.get(selectedDay) ?? []}
                  localSlug={slug ?? null}
                  token={token}
                  now={now ?? Date.now()}
                  onCancel={setConfirmCancel}
                  onPlayersChanged={() => { if (token) load(token); }}
                  onOpenChat={setChatFor}
                  onReserve={() => router.push(reserveHref)}
                  reserveLabel={slug ? 'Réserver un créneau' : 'Trouver un club'}
                  canRecord={(r) => now != null && canRecordResult(r, new Date(now)) && !matchFor(r.id)}
                  onRecordResult={levelEnabled ? (r) => setRecordingFor(r) : undefined}
                  matchStatusFor={(rid) => matchFor(rid)?.status}
                  showSport={showSport}
                />
```

```tsx
              <MyAgendaListItem
                key={`${it.kind}-${it.id}`}
                item={it}
                now={now ?? Date.now()}
                localSlug={slug ?? null}
                token={token}
                onCancel={setConfirmCancel}
                onPlayersChanged={() => { if (token) load(token); }}
                onOpenChat={setChatFor}
                canRecord={(r) => now != null && canRecordResult(r, new Date(now)) && !matchFor(r.id)}
                onRecordResult={levelEnabled ? (r) => setRecordingFor(r) : undefined}
                existingMatchStatus={it.kind === 'reservation' ? matchFor(it.r.id)?.status : undefined}
                showSport={showSport}
              />
```

Mount the sheet next to the other modals at the bottom of the returned JSX, right after the
`<MatchResultModal>` block:

```tsx
      {chatFor && token && (
        <OpenMatchChatSheet
          slug={chatFor.resource.club.slug} token={token} reservationId={chatFor.id}
          viewerUserId={chatFor.participants.find((p) => p.isOrganizer)?.userId ?? ''}
          viewerIsOrganizer
          title={`${chatFor.resource.name} · ${fmtDate(chatFor.startTime, chatFor.resource.club.timezone)} · ${fmtHour(chatFor.startTime, chatFor.resource.club.timezone)}`}
          timezone={chatFor.resource.club.timezone}
          onClose={() => setChatFor(null)}
        />
      )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/MyReservationsChat.test.tsx`
Expected: PASS

- [ ] **Step 5: Re-run the calendar/scoping suites to confirm no regression**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/MyReservationsCalendar.test.tsx __tests__/MyReservationsScoping.test.tsx`
Expected: PASS (unchanged — these use non-padel reservations, untouched by this feature)

- [ ] **Step 6: Commit**

```bash
git add frontend/app/me/reservations/page.tsx frontend/__tests__/MyReservationsChat.test.tsx
git commit -m "feat(reservations): monter OpenMatchChatSheet au niveau de la page Mes réservations"
```

---

### Task 5: Remove the now-duplicate share button from `OpenMatchToggle`

**Files:**
- Modify: `frontend/components/reservations/OpenMatchToggle.tsx`

`ReservationAgendaCard`'s footer now offers "Partager" whenever the reservation is public and
upcoming — the exact same case where `OpenMatchToggle` used to show its own `MatchShareButton`
next to "Fermer". Keeping both would show two share buttons on the same card.

- [ ] **Step 1: Remove the duplicate button**

In `frontend/components/reservations/OpenMatchToggle.tsx`, remove the import:

```tsx
import { MatchShareButton } from '@/components/openmatch/MatchShareButton';
```

Remove the now-unused `shareUrl` constant:

```tsx
  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/parties/${reservation.id}` : `/parties/${reservation.id}`;
```

Replace the `isPublic` branch:

```tsx
      {isPublic ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Chip tone="accent">Ouverte</Chip>
          <button type="button" onClick={close} disabled={busy}
            style={{ marginLeft: 'auto', border: `1px solid ${th.line}`, background: 'transparent', cursor: busy ? 'not-allowed' : 'pointer', borderRadius: 9, padding: '6px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text }}>
            Fermer
          </button>
        </div>
      ) : !sheet ? (
```

- [ ] **Step 2: Run its existing tests to confirm no regression**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/OpenMatchToggle.test.tsx`
Expected: PASS — no existing test asserted the share button's presence.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/reservations/OpenMatchToggle.tsx
git commit -m "refactor(reservations): retirer le bouton Partager en doublon d'OpenMatchToggle"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run every touched test file together**

Run:
```bash
cd frontend && node node_modules/jest/bin/jest.js __tests__/ReservationAgendaCard.test.tsx __tests__/MyAgendaListItem.test.tsx __tests__/DayPanel.test.tsx __tests__/MyReservationsChat.test.tsx __tests__/MyReservationsCalendar.test.tsx __tests__/MyReservationsScoping.test.tsx __tests__/OpenMatchToggle.test.tsx __tests__/ReservationPlayersInline.test.tsx __tests__/OpenMatchCard.test.tsx
```
Expected: PASS, 0 failed (note: per the "Frontend full-suite BookingModal flake" memory, do NOT
run the entire `npx jest` suite to judge this feature — some unrelated BookingModal tests flake
outside isolation).

- [ ] **Step 2: Type-check**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: no errors. Every call site of `DayPanel`/`MyAgendaListItem` must supply the new required
`onOpenChat` prop — grep for other usages first:

Run: `cd frontend && grep -rn "MyAgendaListItem\|<DayPanel" app components --include=*.tsx`

If any other call site is found beyond `app/me/reservations/page.tsx`, add `onOpenChat` there too.

- [ ] **Step 3: Visual check (verify skill)**

Use the `verify` skill against `/me/reservations` (Calendrier tab and À venir tab), for:
- a private upcoming padel reservation (places chip, Annuler, no Discuter/Partager)
- a public upcoming padel reservation with a level range (places chip, niveau chip, Discuter +
  Partager working, Annuler on the right)
- a past padel reservation (no places chip, "Saisir le résultat" or match-status label)

Check both light and dark theme. Confirm the mini-terrain, chips, and footer look visually
consistent with `OpenMatchCard` on `/parties`.
