# Refonte joueurs — carte compacte + page détail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sortir l'ajout/modif de joueurs de la carte de liste (pastilles avatar seules, cliquable), en faire une page détail `/parties/[id]` belle et lisible (équipes éditables par joueur + chat, 2 colonnes desktop / onglets mobile), et propager le langage visuel « pastilles compactes / édition riche » à toutes les surfaces joueurs.

**Architecture :** Deux composants partagés — `PlayerAvatars` (affichage compact, avatars seuls) et `MatchTeams` (édition riche, +variante `lg`) — plus l'extraction du chat en panneau embarquable `MatchChatPanel`. La carte `OpenMatchCard` devient un lien compact ; `OpenMatchDetail` devient le hub 2 colonnes/onglets. On intègre en prérequis le plan backend « chat ouvert à tous / suppression de *Ça m'intéresse* ».

**Tech Stack :** React 19, Next.js 16 (App Router, `params` = Promise), TypeScript, React Testing Library + jest (ts-jest, `isolatedModules` → **jest ne type-check pas** ; `tsc --noEmit` est la barrière de types finale). Styles inline via `useTheme()`.

**Spec :** `docs/superpowers/specs/2026-07-01-refonte-joueurs-carte-page-detail-design.md`

---

## Notes d'exécution (à lire avant de commencer)

- **Arbre de travail sale :** le dépôt contient déjà des fichiers modifiés/non suivis sans rapport (`ClubReserve`, `StripePaymentStep`, la page `/parties/[id]/page.tsx`, `OpenMatchDetail.tsx`, ce plan…). **Chaque commit ne `git add` QUE les fichiers listés dans son étape** — jamais `git add -A`/`git add .`.
- **Branche volatile :** la branche a basculé sur `main` en cours de session. **Vérifier la branche courante avant chaque commit** (`git rev-parse --abbrev-ref HEAD`) ; si ce n'est pas la branche voulue, s'arrêter et demander.
- **jest ne type-check pas** (mémoire projet `frontend-jest-no-typecheck`) : les suites passent malgré des incohérences de types passagères. On ordonne les tâches par logique et on lance **`tsc --noEmit` en barrière finale** (Task 10). Ne pas s'alarmer d'une rougeur `tsc` transitoire entre deux tâches frontend.
- **Commandes** depuis `frontend/` sauf mention contraire. Tests : `npx jest <chemin>`.
- **ClubNav réel monté** (mémoire `clubnav-real-mount-test-suites`) : `OpenMatches`, `ClubReserve.*` montent le vrai `ClubNav`. Ne pas ajouter d'appel `api.*` non mocké dans un chemin monté par ces suites.

---

## Task 0 : Prérequis backend — chat ouvert à tous + suppression « intéressé »

But : exécuter la partie **backend** du plan existant, qui ouvre le chat à tout membre connecté (adhésion à la volée) et supprime le modèle/routes/notif `OpenMatchInterest`. Le **frontend** de ce plan-là est **remplacé** par le présent plan (carte compacte), donc on n'exécute PAS ses tâches front.

**Plan source :** `docs/superpowers/plans/2026-07-01-chat-partie-ouverte-ouvert-a-tous.md`

- [ ] **Step 1 : Exécuter les tâches backend du plan source**

Exécuter **Task 1** (helper `membership.ts`), **Task 2** (`assertChatAccess` ouvert à tous), **Task 3** (notifs = participants ∪ auteurs de messages), **Task 5** (drop modèle Prisma + migration `drop_open_match_interests`).

Pour **Task 4** du plan source : exécuter **uniquement les Steps 1→5** (backend : `openMatch.service.ts`, `notifications.ts` `notifyOpenMatchInterest`, routes `clubs.ts`, tests service + routes). **NE PAS** exécuter son **Step 6** (`frontend/lib/api.ts`) — traité ici en **Task 4**.

- [ ] **Step 2 : NE PAS exécuter** les Tasks 6 et 7 du plan source (frontend `OpenMatchCard`/`OpenMatches`)

Elles sont **remplacées** par les Tasks 5→7 du présent plan (carte compacte). Laisser leurs cases décochées et le noter.

- [ ] **Step 3 : Vérifier le backend**

Run (depuis `backend/`) :
```
npx tsc --noEmit
npx jest src/services/__tests__/membership.test.ts src/services/__tests__/openMatchChat.service.test.ts src/services/__tests__/openMatch.service.test.ts src/email/__tests__/notifications.openmatch-chat.test.ts src/routes/__tests__/clubs.openmatch-chat.routes.test.ts
```
Expected : `tsc` 0 erreur ; toutes les suites PASS. (Les commits sont ceux du plan source.)

---

## Task 1 : Composant `PlayerAvatars` (affichage compact)

But : une rangée d'avatars seuls (sans nom), réutilisable sur la carte et le calendrier.

**Files:**
- Create: `frontend/components/player/PlayerAvatars.tsx`
- Test: `frontend/__tests__/PlayerAvatars.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

Create `frontend/__tests__/PlayerAvatars.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import { PlayerAvatars } from '../components/player/PlayerAvatars';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/api', () => ({ assetUrl: (p: string | null) => p }));

const players = [
  { userId: 'a', firstName: 'Alex', lastName: 'Martin', avatarUrl: null, isOrganizer: true },
  { userId: 'b', firstName: 'Bea', lastName: 'Nom', avatarUrl: null },
];

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('PlayerAvatars', () => {
  it('rend un avatar par joueur, nom accessible mais non affiché en texte', () => {
    wrap(<PlayerAvatars players={players} spotsLeft={2} />);
    // Nom complet porté par title/aria-label, pas en tant que texte visible.
    expect(screen.getByLabelText('Alex Martin')).toBeInTheDocument();
    expect(screen.getByLabelText('Bea Nom')).toBeInTheDocument();
    expect(screen.queryByText('Alex Martin')).not.toBeInTheDocument();
  });

  it('affiche des places libres pour spotsLeft', () => {
    wrap(<PlayerAvatars players={players} spotsLeft={2} />);
    expect(screen.getAllByLabelText('Place libre')).toHaveLength(2);
  });

  it('résume en +N au-delà de max', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ userId: `u${i}`, firstName: `P${i}`, lastName: 'X', avatarUrl: null }));
    wrap(<PlayerAvatars players={many} max={4} />);
    expect(screen.getByText('+2')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2 : Lancer → échec**

Run : `npx jest __tests__/PlayerAvatars.test.tsx`
Expected : FAIL (`Cannot find module '../components/player/PlayerAvatars'`).

- [ ] **Step 3 : Créer le composant**

Create `frontend/components/player/PlayerAvatars.tsx` :

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import type { PlayerPillData } from '@/components/player/PlayerPills';

// Affichage COMPACT des joueurs : avatars seuls (aucun nom en texte), anneau « ami »,
// point orga discret, puces « place libre », débordement « +N ». Présentation pure.
// Le nom complet reste accessible (title + aria-label) au survol / lecteur d'écran.
export function PlayerAvatars({
  players, spotsLeft = 0, friendIds, size = 24, max = 8,
}: {
  players: PlayerPillData[];
  spotsLeft?: number;
  friendIds?: Set<string>;
  size?: number;
  max?: number;
}) {
  const { th } = useTheme();
  const shown = players.slice(0, max);
  const overflow = players.length - shown.length;
  const dot = { width: size, height: size, borderRadius: '50%', flexShrink: 0 } as const;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {shown.map((p) => {
        const c = colorForSeed(p.userId);
        const isFriend = !!friendIds?.has(p.userId);
        const avatar = (
          <span title={`${p.firstName} ${p.lastName}`} aria-label={`${p.firstName} ${p.lastName}`} style={{ position: 'relative', display: 'inline-flex' }}>
            <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl ?? null} size={size} color={c} />
            {p.isOrganizer && (
              <span aria-hidden="true" title="Organisateur" style={{ position: 'absolute', bottom: -1, right: -1, width: 8, height: 8, borderRadius: '50%', background: th.accent, boxShadow: `0 0 0 2px ${th.surface}` }} />
            )}
          </span>
        );
        return isFriend ? (
          <span key={p.userId} title="Vous suivez ce joueur" style={{ display: 'inline-flex', borderRadius: '50%', padding: 1.5, background: th.accent }}>{avatar}</span>
        ) : (
          <span key={p.userId} style={{ display: 'inline-flex' }}>{avatar}</span>
        );
      })}
      {overflow > 0 && (
        <span style={{ ...dot, background: th.line, color: th.textMute, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, fontSize: size * 0.4, fontWeight: 700 }}>
          +{overflow}
        </span>
      )}
      {Array.from({ length: Math.max(0, spotsLeft) }).map((_, i) => (
        <span key={`free-${i}`} aria-label="Place libre" title="Place libre" style={{ ...dot, border: `1.5px dashed ${th.lineStrong}` }} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4 : Lancer → succès**

Run : `npx jest __tests__/PlayerAvatars.test.tsx`
Expected : PASS (3 tests).

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/player/PlayerAvatars.tsx frontend/__tests__/PlayerAvatars.test.tsx
git commit -m "feat(player): PlayerAvatars — affichage compact avatars seuls"
```

---

## Task 2 : `MatchTeams` — variante `lg` (lisibilité page détail)

But : ajouter une taille `lg` (avatars/typo plus grands, cartes plus aérées) pour la page détail, sans toucher à la logique d'équipes.

**Files:**
- Modify: `frontend/components/match/MatchTeams.tsx`
- Test: `frontend/__tests__/MatchTeams.test.tsx` (ajout d'un cas `lg`)

- [ ] **Step 1 : Ajouter le test (rouge d'abord)**

Dans `frontend/__tests__/MatchTeams.test.tsx`, ajouter (adapter l'import/wrapper au style existant du fichier) :

```tsx
  it('accepte la taille lg et affiche le nom complet', () => {
    render(
      <ThemeProvider>
        <MatchTeams
          size="lg"
          capacity={4}
          players={[{ userId: 'a', firstName: 'Alexandre', lastName: 'Durand', avatarUrl: null, isOrganizer: true, team: 1 }]}
        />
      </ThemeProvider>
    );
    expect(screen.getByText('Alexandre Durand')).toBeInTheDocument();
  });
```

- [ ] **Step 2 : Lancer → échec (type/props)**

Run : `npx jest __tests__/MatchTeams.test.tsx -t "taille lg"`
Expected : FAIL — `size="lg"` non accepté (l'union est `'sm' | 'md'`). (jest ne type-check pas : l'échec vient de ce que `av`/`fs` ne changent pas et le test pourrait passer ; dans ce cas, considérer l'échec « attendu » satisfait dès l'implémentation faite — l'objectif réel est d'élargir l'union + tailles.)

- [ ] **Step 3 : Étendre la taille**

Dans `frontend/components/match/MatchTeams.tsx` :

1. Élargir l'union `size` dans la signature :
```ts
  players, capacity, friendIds, size = 'md', busy = false,
```
reste identique ; changer le type :
```ts
  size?: 'sm' | 'md' | 'lg';
```

2. Remplacer les deux dérivations de taille :
```ts
  const av = size === 'sm' ? 20 : 22;
  const fs = size === 'sm' ? 12.5 : 13;
```
par :
```ts
  const av = size === 'sm' ? 20 : size === 'lg' ? 32 : 22;
  const fs = size === 'sm' ? 12.5 : size === 'lg' ? 15 : 13;
```

3. Dans `renderPlayer`, rendre le padding/rayon des mini-cartes proportionnels en `lg` — remplacer la ligne de style de la carte :
```ts
          borderRadius: 12, padding: '5px 8px',
```
par :
```ts
          borderRadius: size === 'lg' ? 14 : 12, padding: size === 'lg' ? '9px 12px' : '5px 8px',
```

- [ ] **Step 4 : Lancer → succès**

Run : `npx jest __tests__/MatchTeams.test.tsx`
Expected : PASS (cas `lg` + cas existants).

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/match/MatchTeams.tsx frontend/__tests__/MatchTeams.test.tsx
git commit -m "feat(match): MatchTeams — variante lg pour la page détail"
```

---

## Task 3 : `MatchChatPanel` (chat embarquable, extrait du sheet)

But : extraire le contenu du chat (liste + saisie + SSE + emojis + suppression) en un panneau qui remplit son conteneur, pour l'embarquer dans la page détail. `OpenMatchChatSheet` devient un fin habillage.

**Files:**
- Create: `frontend/components/openmatch/MatchChatPanel.tsx`
- Modify: `frontend/components/openmatch/OpenMatchChatSheet.tsx` (déléguer au panneau)
- Test: `frontend/__tests__/MatchChatPanel.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

Create `frontend/__tests__/MatchChatPanel.test.tsx` :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MatchChatPanel } from '../components/openmatch/MatchChatPanel';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  chatStreamUrl: () => 'http://x/stream',
  api: {
    getChatMessages: jest.fn().mockResolvedValue([
      { id: 'm1', author: { userId: 'other', firstName: 'Bea', lastName: 'N', avatarUrl: null }, body: 'salut', createdAt: new Date().toISOString(), deleted: false },
    ]),
    postChatMessage: jest.fn().mockResolvedValue({ id: 'm2', author: { userId: 'me', firstName: 'Moi', lastName: 'X', avatarUrl: null }, body: 'hello', createdAt: new Date().toISOString(), deleted: false }),
    deleteChatMessage: jest.fn(),
  },
}));
beforeAll(() => { (global as any).EventSource = class { onmessage: any = null; onerror: any = null; close() {} }; });

const wrap = () => render(
  <ThemeProvider>
    <MatchChatPanel slug="demo" token="t" reservationId="r1" viewerUserId="me" viewerIsOrganizer={false} timezone="Europe/Paris" />
  </ThemeProvider>
);

describe('MatchChatPanel', () => {
  it('charge et affiche les messages', async () => {
    wrap();
    expect(await screen.findByText('salut')).toBeInTheDocument();
  });

  it('envoie un message (optimiste)', async () => {
    const { api } = require('../lib/api');
    wrap();
    await screen.findByText('salut');
    fireEvent.change(screen.getByPlaceholderText('Votre message…'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByLabelText('Envoyer'));
    await waitFor(() => expect(api.postChatMessage).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2 : Lancer → échec**

Run : `npx jest __tests__/MatchChatPanel.test.tsx`
Expected : FAIL (`Cannot find module '../components/openmatch/MatchChatPanel'`).

- [ ] **Step 3 : Créer `MatchChatPanel`**

Create `frontend/components/openmatch/MatchChatPanel.tsx` (déplacer la logique interne de `OpenMatchChatSheet`, sans `position:fixed` ni enveloppe grisée ; le panneau remplit son parent via `height:'100%'` + `flex:1`) :

```tsx
'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { api, chatStreamUrl, OpenMatchMessage } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { colorForSeed } from '@/lib/playerColors';

const CHAT_EMOJIS = [
  '😀', '😁', '😄', '😅', '😂', '🙂', '😉', '😍', '😎', '🤩',
  '😘', '😴', '🥵', '😢', '😡', '🤝', '👍', '👎', '👏', '🙌',
  '💪', '🔥', '🎾', '🏆', '⏰', '📍', '✅', '❌', '❓', '🎉', '🙏', '💯',
];

function hhmm(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}

export interface MatchChatPanelProps {
  slug: string;
  token: string;
  reservationId: string;
  viewerUserId: string;
  viewerIsOrganizer: boolean;
  canModerate?: boolean;
  timezone: string;
}

// Chat d'une partie ouverte : liste + saisie + emojis, temps réel SSE, envoi optimiste,
// suppression (auteur / organisateur / staff). Remplit son conteneur (aucun position:fixed) —
// embarqué dans la page détail (colonne / onglet) et habillé par OpenMatchChatSheet.
export function MatchChatPanel({ slug, token, reservationId, viewerUserId, viewerIsOrganizer, canModerate, timezone }: MatchChatPanelProps) {
  const { th } = useTheme();
  const [messages, setMessages] = useState<OpenMatchMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<OpenMatchMessage | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const addEmoji = (e: string) => setDraft((d) => (d + e).slice(0, 2000));

  const upsert = useCallback((m: OpenMatchMessage) => {
    setMessages((prev) => {
      const i = prev.findIndex((x) => x.id === m.id);
      if (i === -1) return [...prev, m];
      const next = prev.slice(); next[i] = m; return next;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    api.getChatMessages(slug, reservationId, token).then((rows) => { if (alive) setMessages(rows); }).catch(() => {});
    return () => { alive = false; };
  }, [slug, reservationId, token]);

  useEffect(() => {
    const es = new EventSource(chatStreamUrl(slug, reservationId, token));
    es.onmessage = (e: MessageEvent) => {
      try {
        const evt = JSON.parse(e.data) as { type: string; message?: OpenMatchMessage };
        if ((evt.type === 'chat_message' || evt.type === 'chat_deleted') && evt.message) upsert(evt.message);
      } catch { /* ignore */ }
    };
    es.onerror = () => { /* EventSource reconnecte tout seul */ };
    return () => es.close();
  }, [slug, reservationId, token, upsert]);

  useEffect(() => { listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight }); }, [messages]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true); setDraft('');
    try { upsert(await api.postChatMessage(slug, reservationId, body, token)); }
    catch { setDraft(body); }
    finally { setSending(false); }
  };

  const canDelete = (m: OpenMatchMessage) => !m.deleted && (m.author.userId === viewerUserId || viewerIsOrganizer || !!canModerate);
  const doDelete = async (m: OpenMatchMessage) => {
    try { upsert(await api.deleteChatMessage(slug, reservationId, m.id, token)); }
    catch { /* best-effort */ }
    finally { setPendingDelete(null); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div ref={listRef} style={{ overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: th.textFaint, fontFamily: th.fontUI, fontSize: 13.5, padding: '24px 0' }}>
            Aucun message. Lancez la discussion !
          </div>
        ) : messages.map((m) => {
          const mine = m.author.userId === viewerUserId;
          return (
            <div key={m.id} style={{ display: 'flex', gap: 8, flexDirection: mine ? 'row-reverse' : 'row', alignItems: 'flex-end' }}>
              <Avatar firstName={m.author.firstName} lastName={m.author.lastName} avatarUrl={m.author.avatarUrl} size={28} color={colorForSeed(m.author.userId)} />
              <div style={{ maxWidth: '72%' }}>
                <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, marginBottom: 2, textAlign: mine ? 'right' : 'left' }}>
                  {m.author.firstName} · {hhmm(m.createdAt, timezone)}
                </div>
                <div style={{ background: mine ? th.accent : th.surface, color: mine ? th.onAccent : th.text, borderRadius: 14, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 14, fontStyle: m.deleted ? 'italic' : 'normal', opacity: m.deleted ? 0.6 : 1 }}>
                  {m.deleted ? 'message supprimé' : m.body}
                </div>
                {canDelete(m) && (
                  <button type="button" onClick={() => setPendingDelete(m)}
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontFamily: th.fontUI, fontSize: 11.5, marginTop: 2, padding: 0, textAlign: mine ? 'right' : 'left', width: '100%' }}>
                    Supprimer
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ position: 'relative', borderTop: `1px solid ${th.line}` }}>
        {emojiOpen && (
          <div role="menu" aria-label="Choisir un emoji"
            style={{ position: 'absolute', bottom: '100%', left: 12, right: 12, marginBottom: 8, background: th.surface,
              boxShadow: `inset 0 0 0 1px ${th.line}, 0 8px 24px rgba(0,0,0,0.18)`, borderRadius: 12, padding: 8,
              display: 'flex', flexWrap: 'wrap', gap: 2, maxHeight: 180, overflowY: 'auto' }}>
            {CHAT_EMOJIS.map((e) => (
              <button key={e} type="button" aria-label={`Emoji ${e}`} onClick={() => addEmoji(e)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: 6, borderRadius: 8 }}>
                {e}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, padding: '10px 16px', paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}>
          <button type="button" aria-label="Emojis" aria-expanded={emojiOpen} onClick={() => setEmojiOpen((o) => !o)}
            style={{ border: `1px solid ${th.line}`, borderRadius: 12, background: emojiOpen ? th.surface : 'transparent', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 12px', color: th.text }}>
            🙂
          </button>
          <input value={draft} onChange={(e) => setDraft(e.target.value)}
            onFocus={() => setEmojiOpen(false)}
            onKeyDown={(e) => { if (e.key === 'Escape') setEmojiOpen(false); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Votre message…" maxLength={2000}
            style={{ flex: 1, minWidth: 0, border: `1px solid ${th.line}`, borderRadius: 12, padding: '10px 12px', fontFamily: th.fontUI, fontSize: 14, background: th.surface, color: th.text }} />
          <button type="button" aria-label="Envoyer" onClick={send} disabled={sending || !draft.trim()}
            style={{ border: 'none', borderRadius: 12, padding: '0 16px', background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontWeight: 700, cursor: sending || !draft.trim() ? 'default' : 'pointer', opacity: sending || !draft.trim() ? 0.5 : 1 }}>
            Envoyer
          </button>
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Supprimer le message"
          message="Ce message sera retiré de la discussion."
          confirmLabel="Supprimer" cancelLabel="Annuler"
          onConfirm={() => doDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4 : Rebrancher `OpenMatchChatSheet` sur le panneau**

Remplacer **tout le corps de rendu interne** de `frontend/components/openmatch/OpenMatchChatSheet.tsx` (liste + saisie + emojis + ConfirmDialog) par un appel à `<MatchChatPanel .../>`, en gardant l'enveloppe feuille/widget + l'en-tête + `onClose`. Le fichier devient :

```tsx
'use client';
import { api } from '@/lib/api';
import { useEffect } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { Icon } from '@/components/ui/Icon';
import { MatchChatPanel } from '@/components/openmatch/MatchChatPanel';

export interface OpenMatchChatSheetProps {
  slug: string;
  token: string;
  reservationId: string;
  viewerUserId: string;
  viewerIsOrganizer: boolean;
  canModerate?: boolean;
  title: string;
  timezone: string;
  onClose: () => void;
}

// Habillage « feuille » (mobile) / « widget bas-droite » (desktop) autour de MatchChatPanel.
export function OpenMatchChatSheet({ slug, token, reservationId, viewerUserId, viewerIsOrganizer, canModerate, title, timezone, onClose }: OpenMatchChatSheetProps) {
  const { th } = useTheme();
  const isDesktop = useIsDesktop();
  useEffect(() => { api.markOpenMatchChatRead(slug, reservationId, token).catch(() => {}); }, [slug, reservationId, token]);
  return (
    <div role="dialog" aria-label="Discussion de la partie"
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex',
        ...(isDesktop
          ? { alignItems: 'flex-end', justifyContent: 'flex-end', padding: 24, background: 'transparent', pointerEvents: 'none' }
          : { flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(0,0,0,0.4)' }) }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: th.bg, display: 'flex', flexDirection: 'column', pointerEvents: 'auto',
          ...(isDesktop
            ? { width: 'min(380px, 92vw)', height: '70vh', borderRadius: 20, boxShadow: '0 24px 64px rgba(0,0,0,0.35)' }
            : { width: '100%', height: '85vh', borderTopLeftRadius: 20, borderTopRightRadius: 20 }) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${th.line}`, flexShrink: 0 }}>
          <Icon name="users" size={18} color={th.accent} />
          <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>{title}</span>
          <button type="button" aria-label="Fermer" onClick={onClose}
            style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 20 }}>×</button>
        </div>
        <MatchChatPanel slug={slug} token={token} reservationId={reservationId} viewerUserId={viewerUserId} viewerIsOrganizer={viewerIsOrganizer} canModerate={canModerate} timezone={timezone} />
      </div>
    </div>
  );
}
```

> Note : `markOpenMatchChatRead` était appelé par `openChat` dans `useOpenMatchActions` ; il est déplacé ici (au montage du sheet) pour rester correct même après le nettoyage de la Task 6.

- [ ] **Step 5 : Lancer les tests chat**

Run : `npx jest __tests__/MatchChatPanel.test.tsx __tests__/OpenMatchChatSheet.test.tsx`
Expected : PASS. (Si `OpenMatchChatSheet.test.tsx` existait et testait le rendu interne, adapter ses sélecteurs — la liste/saisie sont désormais rendues par `MatchChatPanel`, mêmes libellés/aria.)

- [ ] **Step 6 : Commit**

```bash
git add frontend/components/openmatch/MatchChatPanel.tsx frontend/components/openmatch/OpenMatchChatSheet.tsx frontend/__tests__/MatchChatPanel.test.tsx
git commit -m "feat(open-match): MatchChatPanel embarquable + sheet en habillage"
```

---

## Task 4 : `lib/api.ts` — retrait des types/méthodes « intéressé » (côté front)

But : supprimer `interestedCount`/`viewerIsInterested`/`interested` du type `OpenMatch` et les méthodes `setInterested`/`removeInterested`. (Miroir front du plan backend, non exécuté en Task 0.)

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1 : Retirer les 3 champs du type `OpenMatch`**

Dans `frontend/lib/api.ts`, interface `OpenMatch` (~1208-1210), **supprimer** :
```ts
  interestedCount: number;
  viewerIsInterested: boolean;
  interested: OpenMatchPlayer[];
```

- [ ] **Step 2 : Retirer les méthodes**

Chercher et **supprimer** les méthodes `setInterested` et `removeInterested` (les 2 lignes `request<...>('/open-matches/${id}/interest', …)`).

Run : `grep -n "Interested\|/interest" frontend/lib/api.ts` → doit ne plus rien renvoyer après suppression.

- [ ] **Step 3 : Commit**

```bash
git add frontend/lib/api.ts
git commit -m "refactor(api): retirer les types/méthodes « intéressé » des parties ouvertes"
```

> jest ne type-check pas : les fichiers qui référencent encore ces champs ne casseront pas les suites tout de suite ; ils sont nettoyés en Tasks 5→9 et vérifiés par `tsc` en Task 10.

---

## Task 5 : `OpenMatchCard` → carte compacte cliquable

But : la carte ne montre que des **pastilles avatar** (pas de noms), toute la carte est un **lien vers `/parties/[id]`**, on garde **« Rejoindre »** (et l'invite anonyme) + un indicateur de non-lus ; on retire équipes/ajout/discuter/intérêt/résultat/quitter/partage.

**Files:**
- Modify: `frontend/components/openmatch/OpenMatchCard.tsx`
- Test: `frontend/__tests__/OpenMatchCard.test.tsx`

- [ ] **Step 1 : Réécrire les tests (rouges d'abord)**

Remplacer `frontend/__tests__/OpenMatchCard.test.tsx` par une version alignée sur la nouvelle carte (adapter `makeMatch`/`makeProps` : plus de `interested*`, plus de `onToggleInterest`/`onSetTeams`/`onAddPlayer`/`onReplacePlayer`/`onToggleAdd`/`onCancelAdd`/`onRemovePlayer`/`onRecordResult`/`onOpenChat`, plus de `addingOpen`) :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { OpenMatchCard } from '../components/openmatch/OpenMatchCard';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a> }));
jest.mock('../lib/api', () => ({ assetUrl: (p: string | null) => p }));

const makeMatch = (over: any = {}) => ({
  id: 'm1', resourceName: 'Terrain 1', startTime: new Date(Date.now() + 36e5).toISOString(), endTime: new Date(Date.now() + 72e5).toISOString(),
  maxPlayers: 4, spotsLeft: 2, full: false, viewerIsParticipant: false, viewerIsOrganizer: false,
  players: [{ userId: 'o', firstName: 'Org', lastName: 'A', avatarUrl: null, isOrganizer: true, team: 1 }],
  targetLevelMin: null, targetLevelMax: null, lastMessageAt: null, unreadCount: 0, sport: { key: 'padel', name: 'Padel' }, ...over,
});
const makeProps = (match: any, over: any = {}) => ({ match, timezone: 'Europe/Paris', onJoin: jest.fn(), onAuthPrompt: jest.fn(), ...over });

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('OpenMatchCard (compacte)', () => {
  it('est un lien vers la page détail et ne montre pas les noms', () => {
    const match = makeMatch();
    wrap(<OpenMatchCard {...makeProps(match)} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/parties/m1');
    expect(screen.queryByText('Org A')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Org A')).toBeInTheDocument(); // nom accessible via avatar
  });

  it('« Rejoindre » appelle onJoin sans naviguer (stopPropagation)', () => {
    const match = makeMatch();
    const onJoin = jest.fn();
    wrap(<OpenMatchCard {...makeProps(match, { onJoin })} />);
    fireEvent.click(screen.getByRole('button', { name: /Rejoindre/i }));
    expect(onJoin).toHaveBeenCalledWith(match);
  });

  it('anonyme : « Rejoindre » appelle onAuthPrompt', () => {
    const match = makeMatch();
    const onAuthPrompt = jest.fn(), onJoin = jest.fn();
    wrap(<OpenMatchCard {...makeProps(match, { onAuthPrompt, onJoin, isAnonymous: true })} />);
    fireEvent.click(screen.getByRole('button', { name: /Rejoindre/i }));
    expect(onAuthPrompt).toHaveBeenCalledWith(match);
    expect(onJoin).not.toHaveBeenCalled();
  });

  it('participant : montre l\'état inscrit, pas de « Rejoindre »', () => {
    const match = makeMatch({ viewerIsParticipant: true });
    wrap(<OpenMatchCard {...makeProps(match)} />);
    expect(screen.queryByRole('button', { name: /Rejoindre/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Inscrit/i)).toBeInTheDocument();
  });

  it('affiche l\'indicateur de non-lus', () => {
    const match = makeMatch({ viewerIsParticipant: true, unreadCount: 3 });
    wrap(<OpenMatchCard {...makeProps(match)} />);
    expect(screen.getByLabelText('3 non lus')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2 : Lancer → échec**

Run : `npx jest __tests__/OpenMatchCard.test.tsx`
Expected : FAIL (l'ancienne carte n'est pas un lien, montre les noms, garde les boutons retirés).

- [ ] **Step 3 : Réécrire `OpenMatchCard.tsx`**

Remplacer **tout** `frontend/components/openmatch/OpenMatchCard.tsx` par :

```tsx
'use client';
import Link from 'next/link';
import { OpenMatch } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn, Chip } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { PlayerAvatars } from '@/components/player/PlayerAvatars';
import { rangeLabel } from '@/lib/levelMatch';

function formatWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz })
    .format(new Date(iso)).replace(':', 'h');
}

export interface OpenMatchCardProps {
  match: OpenMatch;
  timezone: string;
  busy?: boolean;
  onJoin: (m: OpenMatch) => void;
  showSport?: boolean;
  isAnonymous?: boolean;
  onAuthPrompt: (m: OpenMatch) => void;
  friendIds?: Set<string>;
}

// Carte COMPACTE d'une partie ouverte : méta + pastilles avatar (pas de noms). Toute la carte
// est un lien vers /parties/[id] (édition des joueurs, chat, résultat, partage → page détail).
// On garde seulement « Rejoindre » (stopPropagation ; anonyme → invite) + un indicateur de non-lus.
export function OpenMatchCard({ match: m, timezone, busy = false, onJoin, showSport, isAnonymous = false, onAuthPrompt, friendIds }: OpenMatchCardProps) {
  const { th } = useTheme();
  const friendCount = m.players.filter((p) => friendIds?.has(p.userId)).length;
  const players = m.players.map((p) => ({ userId: p.userId, firstName: p.firstName, lastName: p.lastName, avatarUrl: p.avatarUrl, isOrganizer: p.isOrganizer, level: p.level }));

  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };

  return (
    <Link href={`/parties/${m.id}`} style={{ display: 'block', textDecoration: 'none', color: 'inherit', background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Icon name="users" size={18} color={th.accent} />
        <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>{m.resourceName}</span>
        {showSport && m.sport && <Chip tone="line">{m.sport.name}</Chip>}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {(m.targetLevelMin != null || m.targetLevelMax != null) && (
            <Chip tone="line">{rangeLabel(m.targetLevelMin ?? null, m.targetLevelMax ?? null)}</Chip>
          )}
          {!isAnonymous && m.unreadCount > 0 && (
            <span aria-label={`${m.unreadCount} non lus`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: th.accent, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700 }}>
              <Icon name="users" size={14} color={th.accent} />{m.unreadCount > 99 ? '99+' : m.unreadCount}
            </span>
          )}
          <Chip tone={m.full ? 'mute' : 'accent'}>{m.full ? 'Complet' : `${m.spotsLeft} place${m.spotsLeft > 1 ? 's' : ''}`}</Chip>
        </span>
      </div>
      <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginBottom: 12 }}>
        {formatWhen(m.startTime, timezone)} → {formatWhen(m.endTime, timezone)}
      </div>
      <PlayerAvatars players={players} spotsLeft={m.spotsLeft} friendIds={friendIds} />
      {friendCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: th.fontUI, fontSize: 12.5, color: th.accent, fontWeight: 600, marginTop: 8 }}>
          <Icon name="users" size={14} color={th.accent} />
          {friendCount === 1 ? '1 de vos amis joue ici' : `${friendCount} de vos amis jouent ici`}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${th.line}` }}>
        <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          Ouvrir<Icon name="chevR" size={15} color={th.textMute} />
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center' }} onClick={stop}>
          {m.viewerIsOrganizer ? (
            <Chip tone="line" icon="check">Vous organisez</Chip>
          ) : m.viewerIsParticipant ? (
            <Chip tone="accent" icon="check">Inscrit</Chip>
          ) : (
            <Btn icon="plus" style={{ height: 46, fontSize: 15, padding: '0 18px' }} disabled={busy || m.full} onClick={() => (isAnonymous ? onAuthPrompt(m) : onJoin(m))}>Rejoindre</Btn>
          )}
        </span>
      </div>
    </Link>
  );
}
```

- [ ] **Step 4 : Lancer → succès**

Run : `npx jest __tests__/OpenMatchCard.test.tsx`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/openmatch/OpenMatchCard.tsx frontend/__tests__/OpenMatchCard.test.tsx
git commit -m "feat(open-match): carte compacte cliquable (pastilles + Rejoindre)"
```

---

## Task 6 : `useOpenMatchActions` + `OpenMatchModals` — nettoyage intérêt/chat-sheet

But : retirer `toggleInterest` (méthode supprimée) et le pilotage du chat-en-modale (`chatting`/`openChat` + `OpenMatchChatSheet` dans les modales). Conserver join/leave/teams/add/replace/remove/record pour la page détail et la liste.

**Files:**
- Modify: `frontend/components/openmatch/useOpenMatchActions.ts`
- Modify: `frontend/components/openmatch/OpenMatchModals.tsx`

- [ ] **Step 1 : `useOpenMatchActions.ts`**

1. **Supprimer** le state `chatting` et `authPrompt`? — garder `authPrompt` (encore utilisé). Supprimer **`chatting`** : la ligne `const [chatting, setChatting] = useState<OpenMatch | null>(null);`.
2. **Supprimer** `toggleInterest` (lignes 68-69) et **`openChat`** (lignes 71-76).
3. Retirer `chatting`, `setChatting`, `toggleInterest`, `openChat` du `return`.

Le `return` final devient :
```ts
  return {
    busyId, error, addingId, recordingFor, joinWarning, authPrompt,
    setError, setAddingId, setRecordingFor, setJoinWarning, setAuthPrompt,
    join, confirmJoin, leave, removePlayer, setTeams, addPlayerToTeam, replacePlayer,
    onToggleAdd, onCancelAdd,
  };
```

- [ ] **Step 2 : `OpenMatchModals.tsx`**

**Supprimer** le bloc `{a.chatting && token && (<OpenMatchChatSheet .../>)}` (lignes 40-49) et l'import `OpenMatchChatSheet`. Les 3 modales restantes (résultat, join-warning, auth-prompt) sont inchangées.

- [ ] **Step 3 : Vérifier les suites qui montent ces modules**

Run : `npx jest __tests__/OpenMatches.test.tsx`
Expected : peut échouer si `OpenMatches` passe encore `onOpenChat`/`onToggleInterest` — corrigé en Task 7. Continuer.

- [ ] **Step 4 : Commit**

```bash
git add frontend/components/openmatch/useOpenMatchActions.ts frontend/components/openmatch/OpenMatchModals.tsx
git commit -m "refactor(open-match): retirer intérêt + chat-en-modale des actions"
```

---

## Task 7 : `OpenMatches` — câblage carte compacte + mocks

But : adapter la liste aux nouvelles props réduites d'`OpenMatchCard`, retirer le handler d'intérêt, purger les mocks.

**Files:**
- Modify: `frontend/components/openmatch/OpenMatches.tsx`
- Test: `frontend/__tests__/OpenMatches.test.tsx`
- Test: `frontend/__tests__/OpenMatchCard.friends.test.tsx`, `frontend/__tests__/MatchesForYou.test.tsx`, `frontend/__tests__/recommend.test.ts`

- [ ] **Step 1 : Adapter `OpenMatches.tsx`**

Remplacer **les deux** blocs `<OpenMatchCard .../>` (section « Pour toi » et « Autres ») par la forme réduite :

```tsx
                <OpenMatchCard
                  key={m.id} match={m} friendIds={friendIds} timezone={club.timezone}
                  busy={a.busyId === m.id}
                  onJoin={a.join}
                  showSport={multiSport}
                  isAnonymous={!token}
                  onAuthPrompt={a.setAuthPrompt}
                />
```

(supprimer tous les passages `onLeave`/`onRemovePlayer`/`onSetTeams`/`onAddPlayer`/`onReplacePlayer`/`onToggleAdd`/`onCancelAdd`/`onRecordResult`/`canRecordResult`/`onToggleInterest`/`onOpenChat`/`addingOpen`/`slug`/`token`).

- [ ] **Step 2 : Purger les mocks des suites**

- `frontend/__tests__/OpenMatches.test.tsx` : retirer du mock `api` les clés `setInterested`/`removeInterested` si présentes ; dans la factory `match()`, retirer `interestedCount`/`viewerIsInterested`/`interested` ; supprimer un éventuel test « Ça m'intéresse » et adapter les tests « Discuter » (le chat n'est plus sur la carte — supprimer ces assertions ou les déplacer vers `OpenMatchDetail`).
- `frontend/__tests__/OpenMatchCard.friends.test.tsx` : aligner sur la nouvelle carte (props réduites, `Link` mocké comme en Task 5, plus de `interested*`) ; l'anneau ami se vérifie via `PlayerAvatars` (title = nom).
- `frontend/__tests__/MatchesForYou.test.tsx` et `frontend/__tests__/recommend.test.ts` : retirer `interestedCount`/`viewerIsInterested`/`interested` des objets `OpenMatch` mockés.

- [ ] **Step 3 : Lancer → succès**

Run : `npx jest __tests__/OpenMatches.test.tsx __tests__/OpenMatchCard.friends.test.tsx __tests__/MatchesForYou.test.tsx __tests__/recommend.test.ts`
Expected : PASS.

- [ ] **Step 4 : Commit**

```bash
git add frontend/components/openmatch/OpenMatches.tsx frontend/__tests__/OpenMatches.test.tsx frontend/__tests__/OpenMatchCard.friends.test.tsx frontend/__tests__/MatchesForYou.test.tsx frontend/__tests__/recommend.test.ts
git commit -m "feat(open-match): liste — câblage carte compacte + purge des mocks"
```

---

## Task 8 : `OpenMatchDetail` → hub 2 colonnes / onglets + chat embarqué

But : la page détail devient le centre : header + partage, **infos + équipes éditables (MatchTeams `lg`) + ajout par joueur (PartnerSearch) + actions** à gauche, **chat (MatchChatPanel)** à droite en desktop, **onglets `Partie`/`Discussion`** en mobile.

**Files:**
- Modify: `frontend/components/openmatch/OpenMatchDetail.tsx`
- Test: `frontend/__tests__/OpenMatchDetail.test.tsx`

- [ ] **Step 1 : Adapter le test existant (rouge d'abord)**

Dans `frontend/__tests__/OpenMatchDetail.test.tsx` :
1. Retirer `interestedCount`/`viewerIsInterested`/`interested` de l'objet `match` (l.45).
2. Ajouter aux mocks `api` : `getChatMessages: jest.fn().mockResolvedValue([])`, `markOpenMatchChatRead: jest.fn().mockResolvedValue({}), postChatMessage: jest.fn(), deleteChatMessage: jest.fn()`.
3. Conserver les 2 tests existants (carte visible / 404) — ils vérifient « Terrain 1 » et l'état « n'existe plus ». Ajouter :

```tsx
  it('affiche les équipes et un panneau de discussion', async () => {
    mocked.getOpenMatch.mockResolvedValue({ ...match, players: [
      { userId: 'u-org', firstName: 'Org', lastName: 'A', avatarUrl: null, isOrganizer: true, team: 1 },
    ] } as never);
    render(<ThemeProvider><OpenMatchDetail matchId="m1" /></ThemeProvider>);
    expect(await screen.findByText('Org A')).toBeInTheDocument();      // nom complet lisible (équipes)
    expect(screen.getByText('Équipe 1')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Votre message…')).toBeInTheDocument(); // chat embarqué
  });
```

> jsdom : `useIsDesktop` s'appuie sur `matchMedia` (stubé dans `jest.setup.ts`, renvoie desktop=false par défaut → rendu mobile/onglets). Le test cible des éléments présents dans les deux layouts (équipes toujours rendues ; le champ de message est rendu dans l'onglet actif par défaut « Discussion » **seulement si** on le rend d'emblée). **Choix d'implémentation testable** (voir Step 2) : en mobile, rendre l'onglet « Partie » par défaut ET monter le `MatchChatPanel` masqué (display) plutôt que démonté — OU faire pointer le test sur l'onglet Discussion. Ici on rend les deux (Partie visible + panneau chat monté), l'onglet ne fait que basculer la visibilité → le `placeholder` reste trouvable.

- [ ] **Step 2 : Réécrire `OpenMatchDetail.tsx`**

Remplacer **tout** `frontend/components/openmatch/OpenMatchDetail.tsx` par :

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, OpenMatch } from '@/lib/api';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { Screen } from '@/components/ui/Screen';
import { ClubNav } from '@/components/ClubNav';
import { Icon } from '@/components/ui/Icon';
import { Btn, Chip, Segmented } from '@/components/ui/atoms';
import { clubHasPadel } from '@/lib/sport';
import { clubIsMultiSport } from '@/lib/sportBadge';
import { rangeLabel } from '@/lib/levelMatch';
import { MatchTeams, MatchPlayerData } from '@/components/match/MatchTeams';
import { MatchChatPanel } from '@/components/openmatch/MatchChatPanel';
import { PartnerSearch } from '@/components/tournament/PartnerSearch';
import { OpenMatchModals } from '@/components/openmatch/OpenMatchModals';
import { useOpenMatchActions } from '@/components/openmatch/useOpenMatchActions';
import { ShareActions } from '@/components/tournament/ShareActions';

function formatWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}

// /parties/[id] — hub d'une partie ouverte : infos + équipes éditables + chat.
export function OpenMatchDetail({ matchId }: { matchId: string }) {
  const { club, loading } = useClub();
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const router = useRouter();
  const isDesktop = useIsDesktop(900);

  const [match, setMatch] = useState<OpenMatch | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'notfound'>('loading');
  const [myLevel, setMyLevel] = useState<number | null>(null);
  const [viewerUserId, setViewerUserId] = useState('');
  const [canModerate, setCanModerate] = useState(false);
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'partie' | 'chat'>('partie');
  const [addMode, setAddMode] = useState<{ kind: 'add'; team: 1 | 2 } | { kind: 'replace'; player: MatchPlayerData } | null>(null);

  const noPadel = !!club && !clubHasPadel(club);
  useEffect(() => { if (noPadel) router.replace('/'); }, [noPadel, router]);

  const reload = useCallback(async () => {
    if (!club) return;
    try { setMatch(await api.getOpenMatch(club.slug, matchId, token ?? undefined)); setStatus('ready'); }
    catch { setStatus('notfound'); }
  }, [club, matchId, token]);

  useEffect(() => { if (ready && club) reload(); }, [ready, club, reload]);
  useEffect(() => { if (token) api.getMyRating(token, 'padel').then((r) => setMyLevel(r?.level ?? null)).catch(() => {}); }, [token]);
  useEffect(() => { if (token) api.getMyProfile(token).then((p) => setViewerUserId(p.id)).catch(() => {}); }, [token]);
  useEffect(() => { if (token && club) api.getMyClubs(token).then((list) => setCanModerate(list.some((c) => c.slug === club.slug && (c.role === 'OWNER' || c.role === 'ADMIN')))).catch(() => {}); }, [token, club]);
  useEffect(() => { if (token) api.listFollowing(token).then((fs) => setFriendIds(new Set(fs.map((f) => f.id)))).catch(() => {}); }, [token]);
  // Marquage « lu » à l'arrivée sur la page (chat visible d'emblée en desktop / onglet Discussion en mobile).
  useEffect(() => { if (token && club) api.markOpenMatchChatRead(club.slug, matchId, token).then(() => window.dispatchEvent(new Event('palova:openmatch-unread'))).catch(() => {}); }, [token, club, matchId]);

  const a = useOpenMatchActions({ club: club!, token, myLevel, reload });

  if (loading || !club) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>;
  if (noPadel) return <div style={{ minHeight: '100vh', background: th.bg }} />;

  const back = (
    <Link href="/parties" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: th.fontUI, fontSize: 14, color: th.textMute, textDecoration: 'none', padding: '16px 20px 0' }}>
      <Icon name="chevL" size={16} color={th.textMute} /> Parties
    </Link>
  );

  const teamPlayers: MatchPlayerData[] = match ? match.players.map((p) => ({
    userId: p.userId, firstName: p.firstName, lastName: p.lastName, avatarUrl: p.avatarUrl,
    isOrganizer: p.isOrganizer, level: p.level, team: (p.team ?? 1) as 1 | 2,
  })) : [];

  // Colonne « Partie » : infos + équipes + ajout + actions.
  const partie = match && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: th.surface, borderRadius: 16, padding: 16, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Icon name="users" size={18} color={th.accent} />
          <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 16, color: th.text }}>{match.resourceName}</span>
          {clubIsMultiSport(club) && match.sport && <Chip tone="line">{match.sport.name}</Chip>}
          {(match.targetLevelMin != null || match.targetLevelMax != null) && (
            <Chip tone="line">{rangeLabel(match.targetLevelMin ?? null, match.targetLevelMax ?? null)}</Chip>
          )}
          <span style={{ marginLeft: 'auto' }}><Chip tone={match.full ? 'mute' : 'accent'}>{match.full ? 'Complet' : `${match.spotsLeft} place${match.spotsLeft > 1 ? 's' : ''}`}</Chip></span>
        </div>
        <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 8 }}>{formatWhen(match.startTime, club.timezone)} → {formatWhen(match.endTime, club.timezone)}</div>
      </div>

      <MatchTeams
        size="lg" capacity={match.maxPlayers} players={teamPlayers} friendIds={friendIds}
        busy={a.busyId === match.id} editable={match.viewerIsOrganizer}
        onSetTeams={(teams) => a.setTeams(match, teams)}
        onRemove={(p) => a.removePlayer(match, { userId: p.userId, firstName: p.firstName, lastName: p.lastName, isOrganizer: p.isOrganizer })}
        canRemove={(p) => match.viewerIsOrganizer && !p.isOrganizer}
        onReplace={match.viewerIsOrganizer ? ((p) => setAddMode({ kind: 'replace', player: p })) : undefined}
        canReplace={(p) => match.viewerIsOrganizer && !p.isOrganizer}
        onAddToTeam={match.viewerIsOrganizer ? ((team) => setAddMode({ kind: 'add', team })) : undefined}
      />

      {match.viewerIsOrganizer && addMode && (
        <div style={{ background: th.surface, borderRadius: 16, padding: 14, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
          <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginBottom: 6 }}>
            {addMode.kind === 'replace' ? `Remplacer ${addMode.player.firstName} ${addMode.player.lastName} par…` : `Ajouter un joueur à l'équipe ${addMode.team}`}
          </div>
          <PartnerSearch
            autoFocus slug={club.slug} token={token ?? ''} selected={null}
            excludeIds={match.players.map((p) => p.userId)}
            onSelect={(member) => {
              if (addMode.kind === 'replace') a.replacePlayer(match, addMode.player, member.id);
              else a.addPlayerToTeam(match, member.id, addMode.team);
              setAddMode(null);
            }}
            onClear={() => {}} disabled={a.busyId === match.id}
          />
          <button type="button" onClick={() => setAddMode(null)} style={{ marginTop: 8, border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13 }}>Annuler</button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {club.levelSystemEnabled !== false && new Date(match.endTime).getTime() <= Date.now() && match.players.length === 4 && (
          <Btn variant="surface" style={{ height: 46, fontSize: 15, padding: '0 18px' }} disabled={a.busyId === match.id} onClick={() => a.setRecordingFor(match)}>Saisir le résultat</Btn>
        )}
        <span style={{ marginLeft: 'auto' }}>
          {match.viewerIsOrganizer ? (
            <Chip tone="line" icon="check">Vous organisez</Chip>
          ) : match.viewerIsParticipant ? (
            <Btn variant="surface" style={{ height: 46, fontSize: 15, padding: '0 18px' }} disabled={a.busyId === match.id} onClick={() => a.leave(match)}>Quitter</Btn>
          ) : (
            <Btn icon="plus" style={{ height: 46, fontSize: 15, padding: '0 18px' }} disabled={a.busyId === match.id || match.full} onClick={() => (token ? a.join(match) : a.setAuthPrompt(match))}>Rejoindre</Btn>
          )}
        </span>
      </div>
    </div>
  );

  // Colonne « Discussion » : chat embarqué (connecté) ou invite (anonyme).
  const chat = match && (
    <div style={{ background: th.surface, borderRadius: 16, boxShadow: `inset 0 0 0 1px ${th.line}`, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: isDesktop ? 'calc(100vh - 220px)' : '70vh', minHeight: 320 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: `1px solid ${th.line}`, flexShrink: 0 }}>
        <Icon name="users" size={16} color={th.accent} />
        <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14, color: th.text }}>Discussion</span>
      </div>
      {token ? (
        <MatchChatPanel slug={club.slug} token={token} reservationId={match.id} viewerUserId={viewerUserId} viewerIsOrganizer={match.viewerIsOrganizer} canModerate={canModerate} timezone={club.timezone} />
      ) : (
        <div style={{ padding: 24, textAlign: 'center', fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>
          <button type="button" onClick={() => a.setAuthPrompt(match)} style={{ border: 'none', background: th.accent, color: th.onAccent, borderRadius: 12, padding: '10px 16px', fontFamily: th.fontUI, fontWeight: 700, cursor: 'pointer' }}>Se connecter pour discuter</button>
        </div>
      )}
    </div>
  );

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        <ClubNav club={club} />
        {back}
        {status === 'loading' && <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>}
        {status === 'notfound' && <div style={{ padding: '40px 20px', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>Cette partie n&apos;existe plus.</div>}
        {status === 'ready' && match && (
          <>
            <ShareActions
              uidPrefix="match"
              item={{
                id: match.id,
                name: `Partie ouverte · ${match.resourceName}`,
                description: [match.full ? 'Complet' : `${match.spotsLeft} place${match.spotsLeft > 1 ? 's' : ''}`, (match.targetLevelMin != null || match.targetLevelMax != null) ? rangeLabel(match.targetLevelMin ?? null, match.targetLevelMax ?? null) : null, club.name].filter(Boolean).join(' · '),
                startTime: match.startTime, endTime: match.endTime, club: { name: club.name },
              }}
            />
            {a.error && (
              <div style={{ margin: '14px 20px 0', background: th.accent, color: th.onAccent, borderRadius: 12, padding: '10px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{a.error}</div>
            )}
            {isDesktop ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 16, padding: '14px 20px 0', alignItems: 'start' }}>
                <div>{partie}</div>
                <div style={{ position: 'sticky', top: 16 }}>{chat}</div>
              </div>
            ) : (
              <div style={{ padding: '14px 20px 0' }}>
                <Segmented<'partie' | 'chat'> value={tab} onChange={setTab} options={[{ value: 'partie', label: 'Partie' }, { value: 'chat', label: 'Discussion' }]} />
                <div style={{ marginTop: 14, display: tab === 'partie' ? 'block' : 'none' }}>{partie}</div>
                <div style={{ marginTop: 14, display: tab === 'chat' ? 'block' : 'none' }}>{chat}</div>
              </div>
            )}
          </>
        )}
      </div>
      <OpenMatchModals club={club} token={token} viewerUserId={viewerUserId} canModerate={canModerate} actions={a} reload={reload} authNextPath={`/parties/${matchId}`} />
    </Screen>
  );
}
```

> Note test : le champ « Votre message… » est monté dans les deux onglets (mobile) via `display:none` sur l'onglet inactif, donc `getByPlaceholderText` le trouve même quand « Partie » est l'onglet actif. En desktop les deux colonnes sont montées.

- [ ] **Step 3 : Lancer → succès**

Run : `npx jest __tests__/OpenMatchDetail.test.tsx`
Expected : PASS (3 tests).

- [ ] **Step 4 : Commit**

```bash
git add frontend/components/openmatch/OpenMatchDetail.tsx frontend/__tests__/OpenMatchDetail.test.tsx
git commit -m "feat(open-match): page détail hub (2 colonnes / onglets + chat embarqué)"
```

---

## Task 9 : Calendrier — affichage lecture en pastilles

But : l'affichage **lecture** des joueurs dans `MyAgendaListItem` et `DayPanel` passe de `MatchTeams`/`PlayerPills` à `PlayerAvatars` (compact, cohérent avec la carte). L'**édition** inline (`ReservationPlayersInline`) reste inchangée.

**Files:**
- Modify: `frontend/components/calendar/MyAgendaListItem.tsx`
- Modify: `frontend/components/calendar/DayPanel.tsx`
- Test: suites calendrier existantes (`MonthCalendar`/`DayPanel`/`MyAgenda*` selon présence)

- [ ] **Step 1 : `MyAgendaListItem.tsx`**

Dans la branche **lecture** (résa passée / étrangère : `(r.participants?.length ?? 0) > 0`), remplacer le bloc conditionnel `MatchTeams`/`PlayerPills` (lignes ~106-122) par un unique `PlayerAvatars` :

```tsx
        {!isForeign && !item.past && token ? (
          <ReservationPlayersInline reservation={r} token={token} now={now} onChanged={onPlayersChanged} />
        ) : (r.participants?.length ?? 0) > 0 ? (
          <div style={{ marginTop: 9 }}>
            <PlayerAvatars
              players={(r.participants ?? []).map((p) => ({ userId: p.userId, firstName: p.firstName, lastName: p.lastName, avatarUrl: p.avatarUrl, isOrganizer: p.isOrganizer, level: p.level }))}
              spotsLeft={Math.max(0, (r.capacity ?? 0) - (r.participants?.length ?? 0))}
            />
          </div>
        ) : null}
```

Ajouter l'import `import { PlayerAvatars } from '@/components/player/PlayerAvatars';` et **retirer** les imports `MatchTeams`/`PlayerPills` s'ils ne servent plus dans le fichier.

- [ ] **Step 2 : `DayPanel.tsx`**

Repérer l'affichage lecture des participants (recherche `MatchTeams`/`PlayerPills` dans le fichier) et le remplacer par `PlayerAvatars` de la même façon (players mappés `{userId,firstName,lastName,avatarUrl,isOrganizer,level}`, `spotsLeft = capacity - participants`). Conserver `ReservationPlayersInline` pour l'édition de sa propre résa à venir. Ajuster les imports.

- [ ] **Step 3 : Lancer les suites calendrier**

Run : `npx jest __tests__/MonthCalendar.test.tsx __tests__/DayPanel.test.tsx __tests__/MyAgendaListItem.test.tsx`
(lancer celles qui existent ; adapter les assertions qui cherchaient un nom complet en lecture → le nom est désormais porté par `aria-label`/`title` de l'avatar, donc `getByLabelText('Prénom Nom')`.)
Expected : PASS.

- [ ] **Step 4 : Commit**

```bash
git add frontend/components/calendar/MyAgendaListItem.tsx frontend/components/calendar/DayPanel.tsx frontend/__tests__/MonthCalendar.test.tsx frontend/__tests__/DayPanel.test.tsx frontend/__tests__/MyAgendaListItem.test.tsx
git commit -m "feat(calendar): affichage lecture des joueurs en pastilles compactes"
```

---

## Task 10 : Documentation + vérification finale

But : refléter le nouveau comportement dans `CLAUDE.md` et garantir compilation + suites vertes.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1 : Note d'évolution dans `CLAUDE.md`**

Sous la section « Chat de partie ouverte… » (ou « Équipes gauche/droite… »), ajouter :

```markdown
> **Évolution (2026-07-01) — carte compacte + page détail joueurs :** l'ajout/modif de joueurs sort de la carte de liste. Nouveau composant **`PlayerAvatars`** (avatars seuls, sans nom, `+N`, places libres, anneau ami — nom en `title`/`aria-label`) pour les surfaces résumé (carte /parties, calendrier lecture). `OpenMatchCard` devient une **carte compacte cliquable** vers **`/parties/[id]`** (garde « Rejoindre » + indicateur de non-lus ; plus d'équipes/ajout/chat/résultat/partage sur la carte). La **page détail `OpenMatchDetail`** est le hub : **2 colonnes desktop** (infos + `MatchTeams` `lg` éditable + `PartnerSearch` d'ajout + actions à gauche, **`MatchChatPanel`** à droite) / **onglets `Partie`/`Discussion` en mobile**. Le chat interne est extrait de `OpenMatchChatSheet` en **`MatchChatPanel`** embarquable (le sheet en devient un habillage). Intègre le chantier « chat ouvert à tous / suppression de *Ça m'intéresse* ». Le calendrier (`MyAgendaListItem`/`DayPanel`) affiche les joueurs en pastilles compactes ; l'édition inline (`ReservationPlayersInline`) et `BookingModal` héritent du `MatchTeams` retouché. Spec & plan : `docs/superpowers/{specs,plans}/2026-07-01-refonte-joueurs-carte-page-detail*`.
```

- [ ] **Step 2 : Barrière de types + suites ciblées**

Run (depuis `frontend/`) :
```
npx tsc --noEmit
npx jest __tests__/PlayerAvatars.test.tsx __tests__/MatchTeams.test.tsx __tests__/MatchChatPanel.test.tsx __tests__/OpenMatchCard.test.tsx __tests__/OpenMatchCard.friends.test.tsx __tests__/OpenMatches.test.tsx __tests__/OpenMatchDetail.test.tsx __tests__/MatchesForYou.test.tsx __tests__/recommend.test.ts __tests__/MonthCalendar.test.tsx __tests__/DayPanel.test.tsx
```
Expected : `tsc` **0 erreur** (aucun `interested*`/`onToggleInterest`/`onOpenChat`/`onSetTeams` résiduel) ; toutes les suites PASS.

- [ ] **Step 3 : Recherche d'orphelins**

Run (racine) : `git grep -n "interestedCount\|viewerIsInterested\|setInterested\|removeInterested\|onToggleInterest\|onOpenChat" -- frontend/lib frontend/components frontend/__tests__`
Expected : **aucune** occurrence hors `docs/**`.

> Rappel mémoire `frontend-full-suite-bookingmodal-flake` : la suite complète `npx jest` présente ~6 échecs `BookingModal` d'isolation pré-existants, sans rapport — vérifier par suites ciblées + `tsc`, pas par le run complet.

- [ ] **Step 4 : Commit**

```bash
git add CLAUDE.md
git commit -m "docs: refonte joueurs — carte compacte + page détail"
```

---

## Self-Review (effectuée)

- **Couverture spec :** `PlayerAvatars` (T1), `MatchTeams` lisibilité/`lg` (T2), `MatchChatPanel` (T3), retrait front intérêt (T4), carte compacte cliquable + Rejoindre + non-lus (T5), nettoyage actions/modales (T6), câblage liste + mocks (T7), page détail 2 colonnes/onglets + chat embarqué + ajout par joueur + actions (T8), calendrier pastilles (T9), chat-ouvert/backend (T0 → plan source), BookingModal/ReservationPlayersInline héritent du `MatchTeams` (T2, sans changement de logique), docs (T10). ✅
- **Placeholders :** aucun — code réel à chaque étape (les seules parties « repérer/adapter » concernent des suites de test existantes dont le contenu exact dépend de l'état du repo ; les composants et pages sont fournis en entier). ✅
- **Cohérence des types :** `PlayerPillData` réutilisé pour `PlayerAvatars`/carte/calendrier ; `MatchPlayerData` pour `MatchTeams`/détail ; `OpenMatchCardProps` réduit et cohérent entre T5 (déf) et T7 (usage) ; `MatchChatPanelProps` identique entre T3 (déf), sheet (T3) et détail (T8). ✅
- **Ordre :** composants d'abord (T1-T3), retrait api (T4), puis consommateurs (T5-T9) ; `tsc` en barrière finale car jest ne type-check pas → pas de blocage entre commits. ✅
- **Point de vigilance à l'exécution :** confirmer les noms/emplacements exacts des suites calendrier (T9) et `OpenMatchChatSheet.test.tsx` (T3) avant de les modifier ; si absentes, ne pas les inventer.
