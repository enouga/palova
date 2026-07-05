# Nouvelle conversation depuis la page Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Nouvelle conversation" entry point to `/me/messages` so a player can start a DM with any club member (or one of their friends) without leaving the page.

**Architecture:** A new presentational dialog component `NewConversationPanel` (friends list when the search box is empty, club-directory search once typing starts) is mounted from `MessagesHub` behind a new "Nouveau" header button. Selecting a member calls the existing idempotent `openConversation` endpoint and hands the resulting conversation back to `MessagesHub`, which reuses its existing `setSelected`/`reload` wiring (the same path already used by the `?with=` deeplink).

**Tech Stack:** Next.js 16 / React 19 client component, existing `lib/api.ts` client (`listClubFriends`, `searchClubMembers`, `openConversation`), Jest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-05-nouvelle-conversation-messages-design.md`

---

### Task 1: `NewConversationPanel` — dialog shell, friends list, debounced directory search

**Files:**
- Create: `frontend/components/messages/NewConversationPanel.tsx`
- Test: `frontend/__tests__/NewConversationPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/__tests__/NewConversationPanel.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { NewConversationPanel } from '@/components/messages/NewConversationPanel';

jest.mock('@/lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    listClubFriends: jest.fn(),
    searchClubMembers: jest.fn(),
    openConversation: jest.fn(),
  },
}));
const apiMock = jest.requireMock('@/lib/api').api;

const onClose = jest.fn();
const onOpened = jest.fn();

const renderPanel = () => render(
  <ThemeProvider>
    <NewConversationPanel slug="demo" token="t" viewerUserId="u1" onClose={onClose} onOpened={onOpened} />
  </ThemeProvider>,
);

beforeEach(() => {
  jest.clearAllMocks();
  apiMock.listClubFriends.mockResolvedValue([{ id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, mutual: true }]);
  apiMock.searchClubMembers.mockResolvedValue([{ id: 'u3', firstName: 'Tom', lastName: 'B' }]);
  apiMock.openConversation.mockResolvedValue({
    id: 'c9', other: { userId: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null },
    clubId: 'demo', lastMessageAt: null, unreadCount: 0, lastMessage: null,
  });
});

it('champ vide affiche mes amis', async () => {
  renderPanel();
  expect(await screen.findByText('Léa M')).toBeInTheDocument();
  expect(apiMock.searchClubMembers).not.toHaveBeenCalled();
});

it('aucun ami → invite à taper un nom', async () => {
  apiMock.listClubFriends.mockResolvedValue([]);
  renderPanel();
  expect(await screen.findByText('Tapez un nom pour trouver un membre.')).toBeInTheDocument();
});

it('taper un nom déclenche la recherche annuaire (débounce) et remplace la liste des amis', async () => {
  renderPanel();
  await screen.findByText('Léa M');
  fireEvent.change(screen.getByPlaceholderText('Rechercher un membre…'), { target: { value: 'tom' } });
  await waitFor(() => expect(apiMock.searchClubMembers).toHaveBeenCalledWith('demo', 'tom', 't'));
  expect(await screen.findByText('Tom B')).toBeInTheDocument();
  expect(screen.queryByText('Léa M')).not.toBeInTheDocument();
});

it('clic sur la croix ferme le panneau', async () => {
  renderPanel();
  await screen.findByText('Léa M');
  fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
  expect(onClose).toHaveBeenCalled();
});
```

Note: this first test file already passes `viewerUserId` and `onOpened` (needed by Task 2) so the component's final prop signature does not change shape between tasks — Task 1's implementation just won't use them yet for selection.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/NewConversationPanel.test.tsx`
Expected: FAIL — `Cannot find module '@/components/messages/NewConversationPanel'`

- [ ] **Step 3: Write the implementation**

Create `frontend/components/messages/NewConversationPanel.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { api, ClubMemberSearchResult, ConversationSummary, Friend } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';

type Row = { id: string; firstName: string; lastName: string; avatarUrl?: string | null; level?: Friend['level'] };

// Panneau "Nouvelle conversation" (dialog overlay, pattern "Membres bloqués" de MessagesHub) :
// champ vide → mes amis du club ; en tapant → annuaire (searchClubMembers, débounce 250 ms).
export function NewConversationPanel({ slug, token, viewerUserId, onClose, onOpened }: {
  slug: string;
  token: string;
  viewerUserId: string;
  onClose: () => void;
  onOpened: (conversation: ConversationSummary) => void;
}) {
  const { th } = useTheme();
  const [q, setQ] = useState('');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [results, setResults] = useState<ClubMemberSearchResult[]>([]);

  useEffect(() => {
    api.listClubFriends(slug, token).then(setFriends).catch(() => setFriends([]));
  }, [slug, token]);

  const query = q.trim();
  useEffect(() => {
    if (!query) { setResults([]); return; }
    const handle = setTimeout(() => {
      api.searchClubMembers(slug, query, token).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query, slug, token]);

  const rows: Row[] = query ? results : friends;

  return (
    <div role="dialog" aria-label="Nouvelle conversation" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: 360, maxWidth: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          background: th.bg, border: `1px solid ${th.line}`, borderRadius: 16, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>Nouvelle conversation</span>
          <button type="button" aria-label="Fermer" onClick={onClose}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 18, padding: 4 }}>✕</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un membre…" autoFocus
          style={{ border: `1px solid ${th.line}`, background: th.surface2, color: th.text, borderRadius: 10,
            padding: '10px 12px', fontFamily: th.fontUI, fontSize: 14, marginBottom: 10 }} />
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {!query && rows.length > 0 && (
            <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.4, padding: '4px 4px 8px' }}>
              Mes amis
            </div>
          )}
          {rows.length === 0 && (
            <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, padding: '12px 4px' }}>
              {query ? 'Aucun membre trouvé.' : 'Tapez un nom pour trouver un membre.'}
            </div>
          )}
          {rows.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: `1px solid ${th.line}` }}>
              <Avatar firstName={r.firstName} lastName={r.lastName} avatarUrl={r.avatarUrl ?? null} size={34} color={colorForSeed(r.id)} />
              <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14, color: th.text, fontWeight: 600 }}>{r.firstName} {r.lastName}</span>
              <LevelChip level={r.level} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/NewConversationPanel.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/messages/NewConversationPanel.tsx frontend/__tests__/NewConversationPanel.test.tsx
git commit -m "feat(messages): panneau nouvelle conversation - amis + recherche annuaire"
```

---

### Task 2: Selection flow — open (or create) the conversation, handle failure, exclude the viewer

**Files:**
- Modify: `frontend/components/messages/NewConversationPanel.tsx`
- Test: `frontend/__tests__/NewConversationPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/__tests__/NewConversationPanel.test.tsx`:

```tsx
it('le viewer est absent des amis et des résultats de recherche', async () => {
  apiMock.listClubFriends.mockResolvedValue([{ id: 'u1', firstName: 'Moi', lastName: 'Même', avatarUrl: null, mutual: true }]);
  apiMock.searchClubMembers.mockResolvedValue([{ id: 'u1', firstName: 'Moi', lastName: 'Même' }]);
  renderPanel();
  await waitFor(() => expect(apiMock.listClubFriends).toHaveBeenCalled());
  expect(screen.queryByText('Moi Même')).not.toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('Rechercher un membre…'), { target: { value: 'moi' } });
  await waitFor(() => expect(apiMock.searchClubMembers).toHaveBeenCalled());
  expect(screen.queryByText('Moi Même')).not.toBeInTheDocument();
});

it('clic sur un membre ouvre la conversation et notifie le parent', async () => {
  renderPanel();
  fireEvent.click(await screen.findByText('Léa M'));
  await waitFor(() => expect(apiMock.openConversation).toHaveBeenCalledWith('u2', 't', 'demo'));
  await waitFor(() => expect(onOpened).toHaveBeenCalledWith(expect.objectContaining({ id: 'c9' })));
});

it('échec de openConversation affiche une erreur et laisse le panneau ouvert', async () => {
  apiMock.openConversation.mockRejectedValue(new Error('boom'));
  renderPanel();
  fireEvent.click(await screen.findByText('Léa M'));
  expect(await screen.findByText("Impossible d'ouvrir cette conversation.")).toBeInTheDocument();
  expect(onOpened).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/NewConversationPanel.test.tsx`
Expected: FAIL — the 3 new tests fail (`onOpened` never called; "Moi Même" renders; clicking a row does nothing).

- [ ] **Step 3: Update the implementation**

In `frontend/components/messages/NewConversationPanel.tsx`, apply these edits:

Add `ConversationSummary` import already present in the props usage from Task 1 (no import change needed — it's already imported).

Add busy/error state, right after the existing `results` state:

```tsx
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
```

Add the `select` handler and filter the viewer out of `rows` — replace:

```tsx
  const rows: Row[] = query ? results : friends;
```

with:

```tsx
  const select = async (userId: string) => {
    setBusyId(userId);
    setError(null);
    try {
      const conversation = await api.openConversation(userId, token, slug);
      onOpened(conversation);
    } catch {
      setError("Impossible d'ouvrir cette conversation.");
      setBusyId(null);
    }
  };

  const rows: Row[] = (query ? results : friends).filter((r) => r.id !== viewerUserId);
```

Show the error message — replace:

```tsx
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un membre…" autoFocus
          style={{ border: `1px solid ${th.line}`, background: th.surface2, color: th.text, borderRadius: 10,
            padding: '10px 12px', fontFamily: th.fontUI, fontSize: 14, marginBottom: 10 }} />
        <div style={{ overflowY: 'auto', flex: 1 }}>
```

with:

```tsx
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un membre…" autoFocus
          style={{ border: `1px solid ${th.line}`, background: th.surface2, color: th.text, borderRadius: 10,
            padding: '10px 12px', fontFamily: th.fontUI, fontSize: 14, marginBottom: 10 }} />
        {error && <div style={{ fontFamily: th.fontUI, fontSize: 13, color: '#e5484d', marginBottom: 8 }}>{error}</div>}
        <div style={{ overflowY: 'auto', flex: 1 }}>
```

Make each row clickable — replace:

```tsx
          {rows.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: `1px solid ${th.line}` }}>
              <Avatar firstName={r.firstName} lastName={r.lastName} avatarUrl={r.avatarUrl ?? null} size={34} color={colorForSeed(r.id)} />
              <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14, color: th.text, fontWeight: 600 }}>{r.firstName} {r.lastName}</span>
              <LevelChip level={r.level} />
            </div>
          ))}
```

with:

```tsx
          {rows.map((r) => (
            <button key={r.id} type="button" disabled={busyId === r.id} onClick={() => select(r.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                border: 'none', background: 'transparent', cursor: busyId === r.id ? 'default' : 'pointer',
                padding: '8px 4px', borderBottom: `1px solid ${th.line}`, opacity: busyId === r.id ? 0.6 : 1 }}>
              <Avatar firstName={r.firstName} lastName={r.lastName} avatarUrl={r.avatarUrl ?? null} size={34} color={colorForSeed(r.id)} />
              <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14, color: th.text, fontWeight: 600 }}>{r.firstName} {r.lastName}</span>
              <LevelChip level={r.level} />
            </button>
          ))}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/NewConversationPanel.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/messages/NewConversationPanel.tsx frontend/__tests__/NewConversationPanel.test.tsx
git commit -m "feat(messages): ouverture de conversation depuis le panneau + gestion d'erreur"
```

---

### Task 3: Wire the "Nouveau" button and panel into `MessagesHub`

**Files:**
- Modify: `frontend/components/messages/MessagesHub.tsx`
- Modify: `frontend/__tests__/MessagesHub.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `frontend/__tests__/MessagesHub.test.tsx`, add `listClubFriends`/`searchClubMembers` to the mocked `api` object — replace:

```tsx
    postDmMessage: jest.fn(), uploadDmImage: jest.fn(), sendTyping: jest.fn().mockResolvedValue({ ok: true }),
    addDmReaction: jest.fn(), removeDmReaction: jest.fn(), deleteDmMessage: jest.fn(),
  },
}));
```

with:

```tsx
    postDmMessage: jest.fn(), uploadDmImage: jest.fn(), sendTyping: jest.fn().mockResolvedValue({ ok: true }),
    addDmReaction: jest.fn(), removeDmReaction: jest.fn(), deleteDmMessage: jest.fn(),
    listClubFriends: jest.fn().mockResolvedValue([]),
    searchClubMembers: jest.fn().mockResolvedValue([]),
  },
}));
```

Then append these two tests at the end of the file:

```tsx
it('bouton « Nouveau » ouvre le panneau, sélectionner un membre ouvre son fil et ferme le panneau', async () => {
  apiMock.searchClubMembers.mockResolvedValue([{ id: 'u5', firstName: 'Nina', lastName: 'K' }]);
  apiMock.openConversation.mockResolvedValue({
    id: 'c2', other: { userId: 'u5', firstName: 'Nina', lastName: 'K', avatarUrl: null },
    clubId: 'club-demo', lastMessageAt: null, unreadCount: 0, lastMessage: null,
  });
  renderHub();
  await screen.findByText('Marie Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Nouvelle conversation' }));
  fireEvent.change(await screen.findByPlaceholderText('Rechercher un membre…'), { target: { value: 'nina' } });
  fireEvent.click(await screen.findByText('Nina K'));
  await waitFor(() => expect(apiMock.openConversation).toHaveBeenCalledWith('u5', 't', 'demo'));
  expect(screen.queryByRole('dialog', { name: 'Nouvelle conversation' })).not.toBeInTheDocument();
  await waitFor(() => expect(apiMock.getDmMessages).toHaveBeenCalledWith('c2', 't'));
});

it('sans clubSlug, le bouton « Nouveau » est masqué', async () => {
  renderHub({ clubSlug: null });
  await screen.findByText('Marie Dupont');
  expect(screen.queryByRole('button', { name: 'Nouvelle conversation' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/MessagesHub.test.tsx`
Expected: FAIL — the 2 new tests fail (`getByRole('button', { name: 'Nouvelle conversation' })` not found).

- [ ] **Step 3: Update the implementation**

In `frontend/components/messages/MessagesHub.tsx`, apply these edits:

Add the two new imports — replace:

```tsx
import { api, notificationsStreamUrl, ConversationSummary, DmMeta, DmUserInfo } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { Avatar } from '@/components/ui/Avatar';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { colorForSeed } from '@/lib/playerColors';
import { ConversationList } from './ConversationList';
import { MessageThread } from './MessageThread';
```

with:

```tsx
import { api, notificationsStreamUrl, ConversationSummary, DmMeta, DmUserInfo } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { Avatar } from '@/components/ui/Avatar';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { colorForSeed } from '@/lib/playerColors';
import { ConversationList } from './ConversationList';
import { MessageThread } from './MessageThread';
import { NewConversationPanel } from './NewConversationPanel';
```

Add the panel's open/close state — replace:

```tsx
  const [blocked, setBlocked] = useState<DmUserInfo[]>([]);
  const [now, setNow] = useState<Date | null>(null);
```

with:

```tsx
  const [blocked, setBlocked] = useState<DmUserInfo[]>([]);
  const [now, setNow] = useState<Date | null>(null);
  const [newOpen, setNewOpen] = useState(false);
```

Add the "Nouveau" button next to "Bloqués" — replace:

```tsx
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: `1px solid ${th.line}` }}>
        <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>Conversations</span>
        <button type="button" aria-label="Membres bloqués" title="Membres bloqués" onClick={openBlocked}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontFamily: th.fontUI, fontSize: 12.5 }}>
          Bloqués
        </button>
      </div>
```

with:

```tsx
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: `1px solid ${th.line}` }}>
        <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>Conversations</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {clubSlug && (
            <button type="button" aria-label="Nouvelle conversation" title="Nouvelle conversation" onClick={() => setNewOpen(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: th.accent, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>
              <Icon name="plus" size={13} color={th.accent} />Nouveau
            </button>
          )}
          <button type="button" aria-label="Membres bloqués" title="Membres bloqués" onClick={openBlocked}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontFamily: th.fontUI, fontSize: 12.5 }}>
            Bloqués
          </button>
        </div>
      </div>
```

Mount the panel — replace:

```tsx
      {blockTarget && (
```

with:

```tsx
      {newOpen && clubSlug && (
        <NewConversationPanel slug={clubSlug} token={token} viewerUserId={viewerUserId}
          onClose={() => setNewOpen(false)}
          onOpened={(c) => { setSelected(c); reload(); setNewOpen(false); }} />
      )}
      {blockTarget && (
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/MessagesHub.test.tsx`
Expected: PASS (7 tests — 5 pre-existing + 2 new)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/messages/MessagesHub.tsx frontend/__tests__/MessagesHub.test.tsx
git commit -m "feat(messages): bouton Nouveau dans MessagesHub, ouvre le panneau nouvelle conversation"
```

---

### Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full set of touched/related test files**

Run: `npx jest __tests__/NewConversationPanel.test.tsx __tests__/MessagesHub.test.tsx __tests__/FriendsHub.test.tsx`
Expected: PASS — all tests green (FriendsHub is included because it shares `openDm`/messaging helpers; confirms nothing there regressed).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors introduced by `NewConversationPanel.tsx` or `MessagesHub.tsx` (pre-existing unrelated errors, if any, are out of scope).

- [ ] **Step 3: Manual smoke check (optional but recommended)**

Start the dev stack per `CLAUDE.md` (`docker-compose-v1.exe up -d`, backend `npm run dev`, frontend `npm run dev`), log in as a seeded user, open `/me/messages` on a club subdomain (e.g. `padel-arena-paris.localhost:3000`), click "Nouveau", confirm:
- the friends list (or the empty-state invite) shows when the field is empty
- typing a name queries the directory and shows results
- selecting someone opens a (possibly empty) thread and the panel closes
- sending the first message in that new thread works and the conversation now appears in the inbox on reload

- [ ] **Step 4: Update CLAUDE.md**

Add a short evolution note under the "Messagerie privée 1-à-1 (v1)" section documenting the new entry point, following the existing `> **Évolution (date) — ...**` convention used throughout the file.

```bash
git add CLAUDE.md
git commit -m "docs: nouvelle conversation depuis la page Messages"
```
