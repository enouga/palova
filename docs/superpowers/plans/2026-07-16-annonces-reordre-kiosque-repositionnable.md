# Annonces réordonnables + kiosque repositionnable — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre les annonces réordonnables par glisser-déposer (page Annonces) et faire du kiosque « À la une » une section repositionnable/masquable (page club), avec refonte visuelle des deux surfaces.

**Architecture :** Deux parties indépendantes. **Partie A** ajoute `Announcement.sortOrder` (migration additive), remplace le tri `pinned/createdAt` par un ordre manuel, ajoute une route de réordonnancement, et refond la page `/admin/announcements` (liste déplaçable + studio en fenêtre). **Partie B** ajoute une clé de section `kiosk` au système `clubHouseSections` (JSON, sans migration) pour que le kiosque se rende à sa position dans l'ordre, et repolit la carte « Sections du Club-house ». Chaque partie produit un logiciel fonctionnel et testable seule.

**Tech Stack :** Prisma 7 (driver adapter), Express, Jest (backend service-level, `__mocks__/prisma`), Next.js 16, React Testing Library, TypeScript. Style maison : `useTheme()` tokens, `HERO_GRADIENT`/`HERO_INK`, glisser natif HTML5 (pattern `ClubHouseSectionsCard`).

**Spec :** `docs/superpowers/specs/2026-07-16-annonces-reordre-kiosque-repositionnable-design.md`

**Décisions clés :**
- Ordre manuel roi ; `pinned` ne trie plus (devient un badge ★).
- Nouvelle annonce en tête (`sortOrder = min − 1`).
- Clé de section neuve **`kiosk`** (évite collision avec les anciennes clés `announcements`/`posters` retirées).
- `kiosk` absent d'une config existante → **inséré en tête** (front + back).

---

## File Structure

**Partie A — Page Annonces**
- Modify: `backend/prisma/schema.prisma` — `Announcement.sortOrder`
- Create: `backend/prisma/migrations/20260716120000_add_announcement_sort_order/migration.sql`
- Modify: `backend/src/services/announcement.service.ts` — tri, `create`, `reorder`
- Modify: `backend/src/services/__tests__/announcement.service.test.ts` — tests
- Modify: `backend/src/routes/admin.ts` — route `PATCH /announcements/reorder` (avant `/:id`)
- Modify: `frontend/lib/api.ts` — `Announcement.sortOrder` + `adminReorderAnnouncements`
- Create: `frontend/components/admin/AnnouncementStudio.tsx` — fenêtre création/édition + aperçu
- Modify: `frontend/app/admin/announcements/page.tsx` — liste déplaçable + ouverture studio
- Create: `frontend/__tests__/AnnouncementStudio.test.tsx`
- Modify: `frontend/__tests__/AdminAnnouncements.test.tsx`

**Partie B — Kiosque section**
- Modify: `backend/src/services/club.service.ts` — `CLUB_HOUSE_SECTION_KEYS` + normalizer (préfixe `kiosk`)
- Modify: `backend/src/services/__tests__/club.service.test.ts` — tests
- Modify: `frontend/lib/api.ts` — `ClubHouseSectionKey` gagne `'kiosk'`
- Modify: `frontend/lib/clubhouse.ts` — `SECTION_KEYS`/`SECTION_DEFS`/orders/resolveSections/fullSectionSettings
- Modify: `frontend/__tests__/clubhouse.test.ts` — tests (6→7 clés, préfixe kiosk)
- Modify: `frontend/components/ClubHouse.tsx` — kiosque = `sections.kiosk` rendu à sa position
- Modify: `frontend/__tests__/ClubHouse.test.tsx`
- Modify: `frontend/components/admin/ClubHouseSectionsCard.tsx` — refonte + rangée kiosque
- Modify: `frontend/__tests__/AdminClub.test.tsx`

**Commandes de vérification** (cf. mémoires : shims `.bin` cassés → `node` direct) :
- Backend jest : `node node_modules/jest/bin/jest.js <chemin> --runInBand`
- Backend tsc : `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
- Frontend jest : `node node_modules/jest/bin/jest.js <chemin>`
- Frontend tsc : `node node_modules/typescript/bin/tsc --noEmit` (⚠️ jest ne type-check pas)

---

# PARTIE A — Page Annonces : réordonnancement + studio

## Task A1 : Migration `Announcement.sortOrder`

**Files:**
- Modify: `backend/prisma/schema.prisma` (modèle `Announcement`, ~ligne 1010-1028)
- Create: `backend/prisma/migrations/20260716120000_add_announcement_sort_order/migration.sql`

- [ ] **Step 1 : Ajouter la colonne au schéma Prisma**

Dans `backend/prisma/schema.prisma`, modèle `Announcement`, ajouter la ligne `sortOrder` juste après `pinned` :

```prisma
  isPublished Boolean  @default(true) @map("is_published")
  pinned      Boolean  @default(false)
  sortOrder   Int      @default(0) @map("sort_order")
  createdAt   DateTime @default(now()) @map("created_at")
```

- [ ] **Step 2 : Écrire le SQL de migration (additif)**

Créer `backend/prisma/migrations/20260716120000_add_announcement_sort_order/migration.sql` :

```sql
-- Ordre manuel des annonces (glisser-déposer). Additif, 0 par défaut (les existantes
-- restent triées par createdAt desc tant qu'on ne réordonne pas).
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 3 : Appliquer en DEV + régénérer le client**

Prisma 7 : la config vient de `prisma.config.ts` (pas de `--schema`). Depuis `backend/` :

Run:
```bash
npx prisma db execute --file prisma/migrations/20260716120000_add_announcement_sort_order/migration.sql
npx prisma generate
```
Repli si `npx` échoue (shims cassés) : `node node_modules/prisma/build/index.js db execute --file <sql>` puis `node node_modules/prisma/build/index.js generate`.
Expected : `db execute` OK (idempotent grâce à `IF NOT EXISTS`), `generate` régénère `.prisma/client` avec `sortOrder`.

- [ ] **Step 4 : Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260716120000_add_announcement_sort_order
git commit -m "feat(annonces): colonne sortOrder (ordre manuel) - migration additive"
```

## Task A2 : Service — tri par sortOrder, création en tête, `reorder`

**Files:**
- Modify: `backend/src/services/announcement.service.ts`
- Test: `backend/src/services/__tests__/announcement.service.test.ts`

- [ ] **Step 1 : Écrire les tests (échouants)**

Ajouter dans `announcement.service.test.ts`, à l'intérieur du `describe('AnnouncementService', …)` :

```typescript
describe('ordre manuel (sortOrder)', () => {
  it('listPublic/listAdmin trient par sortOrder asc puis createdAt desc (plus de pinned)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.announcement.findMany.mockResolvedValue([] as any);
    await service.listPublic('padel-arena-paris');
    expect(prismaMock.announcement.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { clubId: 'club-demo', isPublished: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    }));
    await service.listAdmin('club-demo');
    expect(prismaMock.announcement.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    }));
  });

  it('create place la nouvelle annonce en tête (sortOrder = min - 1 ; 0 si aucune)', async () => {
    prismaMock.announcement.aggregate.mockResolvedValue({ _min: { sortOrder: -2 } } as any);
    prismaMock.announcement.create.mockResolvedValue({ id: 'a1' } as any);
    await service.create('club-1', { title: 't', body: 'b' });
    expect(prismaMock.announcement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sortOrder: -3 }),
    }));

    prismaMock.announcement.aggregate.mockResolvedValue({ _min: { sortOrder: null } } as any);
    await service.create('club-1', { title: 't', body: 'b' });
    expect(prismaMock.announcement.create).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sortOrder: 0 }),
    }));
  });

  it('reorder réécrit sortOrder = index pour les annonces du club, ignore les ids étrangers', async () => {
    prismaMock.announcement.findMany.mockResolvedValueOnce(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as any, // annonces du club (pour filtrer)
    );
    prismaMock.$transaction.mockImplementation(async (ops: any) => Promise.all(ops));
    prismaMock.announcement.update.mockResolvedValue({} as any);
    prismaMock.announcement.findMany.mockResolvedValueOnce([{ id: 'b' }, { id: 'a' }, { id: 'c' }] as any); // relecture
    await service.reorder('club-1', ['b', 'a', 'ETRANGER', 'c']);
    const calls = (prismaMock.announcement.update as jest.Mock).mock.calls.map((c) => c[0]);
    expect(calls).toEqual([
      { where: { id: 'b' }, data: { sortOrder: 0 } },
      { where: { id: 'a' }, data: { sortOrder: 1 } },
      { where: { id: 'c' }, data: { sortOrder: 2 } },
    ]);
  });
});
```

- [ ] **Step 2 : Lancer les tests → échec attendu**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/announcement.service.test.ts --runInBand`
Expected : FAIL (`orderBy` encore `pinned`, `create` sans `sortOrder`, `reorder` n'existe pas).

- [ ] **Step 3 : Implémenter dans `announcement.service.ts`**

Changer le tri de `listPublic` et `listAdmin` :

```typescript
  async listPublic(slug: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    return prisma.announcement.findMany({
      where: { clubId: club.id, isPublished: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async listAdmin(clubId: string) {
    return prisma.announcement.findMany({ where: { clubId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] });
  }
```

Dans `create`, calculer `sortOrder` (en tête) avant le `create` et l'ajouter au `data` :

```typescript
  async create(clubId: string, data: AnnouncementInput) {
    const title = (data.title ?? '').trim();
    const body = (data.body ?? '').trim();
    if (!title || !body) throw new Error('VALIDATION_ERROR');
    const agg = await prisma.announcement.aggregate({ where: { clubId }, _min: { sortOrder: true } });
    const sortOrder = agg._min.sortOrder == null ? 0 : agg._min.sortOrder - 1;
    return prisma.announcement.create({
      data: {
        clubId, title, body,
        linkUrl: data.linkUrl?.trim() || null,
        imageUrl: data.imageUrl?.trim() || null,
        kind: asKind(data.kind) ?? 'INFO',
        validUntil: parseValidUntil(data.validUntil) ?? null,
        isPublished: data.isPublished ?? true,
        pinned: data.pinned ?? false,
        sortOrder,
      },
    });
  }
```

Ajouter la méthode `reorder` (après `setImage`) :

```typescript
  /** Applique un ordre manuel : sortOrder = index. Ignore les ids n'appartenant pas au club. */
  async reorder(clubId: string, orderedIds: string[]) {
    const owned = new Set(
      (await prisma.announcement.findMany({ where: { clubId }, select: { id: true } })).map((a) => a.id),
    );
    const ids = orderedIds.filter((id) => owned.has(id));
    await prisma.$transaction(
      ids.map((id, index) => prisma.announcement.update({ where: { id }, data: { sortOrder: index } })),
    );
    return this.listAdmin(clubId);
  }
```

- [ ] **Step 4 : Lancer les tests → succès**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/announcement.service.test.ts --runInBand`
Expected : PASS (dont le test existant « listPublic ne renvoie que les annonces publiées » — **il faut mettre à jour son `orderBy` attendu** en `[{ sortOrder: 'asc' }, { createdAt: 'desc' }]` ; renommer le libellé « épinglées d'abord » en « ordre manuel »).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/announcement.service.ts backend/src/services/__tests__/announcement.service.test.ts
git commit -m "feat(annonces): tri par sortOrder + creation en tete + reorder"
```

## Task A3 : Route `PATCH /announcements/reorder`

**Files:**
- Modify: `backend/src/routes/admin.ts` (section `// --- Annonces ---`, ~ligne 586-598)

- [ ] **Step 1 : Ajouter la route AVANT `/announcements/:id`**

⚠️ Express : `/announcements/reorder` doit être déclarée **avant** `PATCH /announcements/:id` (sinon `:id = 'reorder'`). L'insérer juste après `router.post('/announcements', …)` et avant `router.patch('/announcements/:id', …)` :

```typescript
router.patch('/announcements/reorder', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const ids = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds.filter((x: unknown): x is string => typeof x === 'string') : [];
    res.json(await announcementService.reorder(req.membership!.clubId, ids));
  } catch (e) { handleError(e, res, next); }
});
```

Le routeur est déjà gardé par `router.use(authMiddleware, requireClubMember('STAFF'))` (ligne 182) → pas de garde supplémentaire.

- [ ] **Step 2 : Vérifier la compilation**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` (depuis `backend/`)
Expected : PASS (aucune erreur de type).

- [ ] **Step 3 : Fumée manuelle (ordre de route)**

Démarrer le backend (`start.ps1` ou `npm run dev`), se connecter admin, puis :
Run: `curl -s -X PATCH "http://localhost:3001/api/clubs/club-demo/admin/announcements/reorder" -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"orderedIds":[]}'`
Expected : `200` avec la liste JSON (et **pas** une 404 « ANNOUNCEMENT_NOT_FOUND » qui indiquerait une capture par `/:id`).

- [ ] **Step 4 : Commit**

```bash
git add backend/src/routes/admin.ts
git commit -m "feat(annonces): route PATCH /announcements/reorder (avant /:id)"
```

## Task A4 : Frontend api.ts

**Files:**
- Modify: `frontend/lib/api.ts` (interface `Announcement` ~ligne 2032 ; objet `api` section annonces ~ligne 605)

- [ ] **Step 1 : Ajouter `sortOrder` à l'interface `Announcement`**

Dans `interface Announcement { … }`, ajouter après `pinned: boolean;` :

```typescript
  pinned: boolean;
  sortOrder: number;
```

- [ ] **Step 2 : Ajouter la méthode `adminReorderAnnouncements`**

Juste après `adminDeleteAnnouncement` (~ligne 612) :

```typescript
  adminReorderAnnouncements: (clubId: string, orderedIds: string[], token: string) =>
    request<Announcement[]>(`/api/clubs/${clubId}/admin/announcements/reorder`, { method: 'PATCH', body: JSON.stringify({ orderedIds }) }, token),
```

- [ ] **Step 3 : Vérifier la compilation**

Run: `node node_modules/typescript/bin/tsc --noEmit` (depuis `frontend/`)
Expected : PASS.

- [ ] **Step 4 : Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(annonces): api sortOrder + adminReorderAnnouncements"
```

## Task A5 : Composant `AnnouncementStudio` (fenêtre + aperçu)

**Files:**
- Create: `frontend/components/admin/AnnouncementStudio.tsx`
- Test: `frontend/__tests__/AnnouncementStudio.test.tsx`

Ce composant **extrait** tout le formulaire actuel de `app/admin/announcements/page.tsx` (titre, contenu, type, valable jusqu'au, lien, affiche, épinglée, publiée) — logique verbatim — dans une fenêtre modale à 2 colonnes (formulaire + **aperçu en direct** sur `HERO_GRADIENT`).

- [ ] **Step 1 : Écrire le test (échouant)**

Créer `frontend/__tests__/AnnouncementStudio.test.tsx` :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnnouncementStudio } from '@/components/admin/AnnouncementStudio';
import { api } from '@/lib/api';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: new Proxy({}, { get: (_t, p) => (p === 'mode' ? 'daylight' : `--${String(p)}`) }) }) }));
jest.mock('@/lib/api', () => ({
  api: {
    adminCreateAnnouncement: jest.fn().mockResolvedValue({ id: 'new1' }),
    adminUpdateAnnouncement: jest.fn().mockResolvedValue({ id: 'e1' }),
    adminUploadAnnouncementImage: jest.fn().mockResolvedValue({ id: 'new1' }),
  },
  assetUrl: (u: string | null) => u,
}));

describe('AnnouncementStudio', () => {
  const base = { clubId: 'club-1', token: 'tok', onClose: jest.fn(), onSaved: jest.fn() };

  it('création : titre + contenu → adminCreateAnnouncement puis onSaved', async () => {
    render(<AnnouncementStudio {...base} editing={null} />);
    fireEvent.change(screen.getByPlaceholderText("Titre de l'annonce"), { target: { value: 'Mon titre' } });
    fireEvent.change(screen.getByPlaceholderText('Détail de l’annonce…'), { target: { value: 'Mon contenu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publier' }));
    await waitFor(() => expect(api.adminCreateAnnouncement).toHaveBeenCalled());
    expect(base.onSaved).toHaveBeenCalled();
  });

  it('aperçu en direct : le titre saisi apparaît dans la zone d’aperçu', () => {
    render(<AnnouncementStudio {...base} editing={null} />);
    fireEvent.change(screen.getByPlaceholderText("Titre de l'annonce"), { target: { value: 'Tournoi P100' } });
    expect(screen.getByTestId('studio-preview')).toHaveTextContent('Tournoi P100');
  });

  it('validation : titre/contenu vides → message, pas d’appel', () => {
    render(<AnnouncementStudio {...base} editing={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publier' }));
    expect(screen.getByRole('alert')).toHaveTextContent('obligatoires');
    expect(api.adminCreateAnnouncement).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Lancer → échec**

Run: `node node_modules/jest/bin/jest.js __tests__/AnnouncementStudio.test.tsx`
Expected : FAIL (module introuvable).

- [ ] **Step 3 : Créer le composant**

Créer `frontend/components/admin/AnnouncementStudio.tsx` (reprend la logique `submit`/`startEdit`/image de la page actuelle, ajoute l'aperçu) :

```tsx
'use client';
import { useState, useEffect, useRef, CSSProperties } from 'react';
import { api, Announcement, AnnouncementBody, AnnouncementKind, assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { Btn } from '@/components/ui/atoms';

const KIND_LABEL: Record<AnnouncementKind, string> = { INFO: 'Info', OFFER: 'Offre', TOURNAMENT: 'Tournoi', EVENT: 'Event' };
const EMPTY = { title: '', body: '', linkUrl: '', kind: 'INFO' as AnnouncementKind, validUntil: '', pinned: false, isPublished: true };

export function AnnouncementStudio({ clubId, token, editing, onClose, onSaved }: {
  clubId: string; token: string; editing: Announcement | null; onClose: () => void; onSaved: () => void;
}) {
  const { th } = useTheme();
  const editId = editing?.id ?? null;
  const [form, setForm] = useState(() => editing
    ? { title: editing.title, body: editing.body, linkUrl: editing.linkUrl ?? '', kind: editing.kind ?? 'INFO', validUntil: editing.validUntil ? editing.validUntil.slice(0, 10) : '', pinned: editing.pinned, isPublished: editing.isPublished }
    : EMPTY);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!imageFile || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(imageFile); setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const labelStyle: CSSProperties = { fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 6 };
  const inputStyle: CSSProperties = { height: 46, padding: '0 14px', borderRadius: 12, background: th.bg, color: th.text, border: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 15 };
  const miniBtn: CSSProperties = { border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '7px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text };
  const checkboxLabel: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text, cursor: 'pointer' };

  const currentImageUrl = editing?.imageUrl ?? null;
  const shownImage = previewUrl ?? (!removeImage && currentImageUrl ? assetUrl(currentImageUrl) : null);
  const hasImage = Boolean(imageFile || (!removeImage && currentImageUrl));
  const clearImage = () => {
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (imageFile) { setImageFile(null); return; }
    if (currentImageUrl) setRemoveImage(true);
  };

  const submit = async () => {
    if (saving) return;
    if (!form.title.trim() || !form.body.trim()) { setFormError('Le titre et le contenu sont obligatoires.'); return; }
    setSaving(true); setFormError(null);
    const body: AnnouncementBody = {
      title: form.title.trim(), body: form.body.trim(), linkUrl: form.linkUrl.trim() || null,
      kind: form.kind, validUntil: form.validUntil || null, pinned: form.pinned, isPublished: form.isPublished,
      ...(editId && removeImage && !imageFile ? { imageUrl: null } : {}),
    };
    let saved: Announcement;
    try {
      saved = editId ? await api.adminUpdateAnnouncement(clubId, editId, body, token) : await api.adminCreateAnnouncement(clubId, body, token);
    } catch (e) { setFormError((e as Error).message); setSaving(false); return; }
    try {
      if (imageFile) await api.adminUploadAnnouncementImage(clubId, saved.id, imageFile, token);
      onSaved(); onClose();
    } catch (e) {
      setFormError(`L'annonce est enregistrée, mais l'envoi de l'image a échoué (${(e as Error).message}). Réessayez.`);
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div role="dialog" aria-modal="true" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: th.surface, borderRadius: 18, boxShadow: th.shadow, width: '100%', maxWidth: 860, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 20, margin: 0, color: th.text }}>{editId ? "Modifier l'annonce" : 'Nouvelle annonce'}</h2>
          <button onClick={onClose} aria-label="Fermer" style={{ ...miniBtn, borderRadius: 999 }}>✕</button>
        </div>

        <style>{`.st-grid{display:grid;grid-template-columns:1fr;gap:16px}@media(min-width:700px){.st-grid{grid-template-columns:1fr 300px}}`}</style>
        <div className="st-grid">
          {/* colonne formulaire */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={labelStyle}>Titre *
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Titre de l'annonce" style={inputStyle} />
            </label>
            <label style={labelStyle}>Contenu *
              <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Détail de l’annonce…" rows={4}
                style={{ ...inputStyle, height: 'auto', padding: '12px 14px', resize: 'vertical', lineHeight: 1.5 }} />
            </label>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label style={{ ...labelStyle, flex: 1, minWidth: 150 }}>Type
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as AnnouncementKind })} style={{ ...inputStyle, cursor: 'pointer' }}>
                  {(Object.keys(KIND_LABEL) as AnnouncementKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
              </label>
              <label style={{ ...labelStyle, flex: 1, minWidth: 150 }}>Afficher jusqu'au
                <input value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} type="date" style={inputStyle} />
              </label>
            </div>
            <label style={labelStyle}>Lien (optionnel)
              <input value={form.linkUrl} onChange={(e) => setForm({ ...form, linkUrl: e.target.value })} placeholder="https://…" type="url" style={inputStyle} />
            </label>
            <div style={labelStyle}>Affiche (image)
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Affiche (image)" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0] ?? null; if (f) { setImageFile(f); setRemoveImage(false); } }} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => fileInputRef.current?.click()} style={miniBtn}>{hasImage ? "Changer l'image" : 'Ajouter une image'}</button>
                {hasImage && <button type="button" onClick={clearImage} style={{ ...miniBtn, color: '#ff7a4d' }}>Retirer l'image</button>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 2 }}>
              <label style={checkboxLabel}><input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} style={{ width: 18, height: 18, accentColor: th.accent }} />À la une ★</label>
              <label style={checkboxLabel}><input type="checkbox" checked={form.isPublished} onChange={(e) => setForm({ ...form, isPublished: e.target.checked })} style={{ width: 18, height: 18, accentColor: th.accent }} />Publiée</label>
            </div>
            {formError && <div role="alert" style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: '#ff7a4d' }}>{formError}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <Btn onClick={submit} icon={editId ? 'check' : 'plus'} disabled={saving}>{saving ? '…' : editId ? 'Enregistrer' : 'Publier'}</Btn>
              <Btn variant="ghost" onClick={onClose} disabled={saving}>Annuler</Btn>
            </div>
          </div>

          {/* colonne aperçu en direct */}
          <div>
            <div style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, color: th.textMute, marginBottom: 8 }}>Aperçu</div>
            <div data-testid="studio-preview" style={{ background: HERO_GRADIENT, color: HERO_INK, borderRadius: 14, overflow: 'hidden' }}>
              {shownImage
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={shownImage} alt="" style={{ width: '100%', maxHeight: 150, objectFit: 'cover', display: 'block' }} />
                : <div style={{ height: 84 }} />}
              <div style={{ padding: 12 }}>
                <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, background: 'rgba(24,21,14,0.12)', padding: '2px 8px', borderRadius: 20 }}>{KIND_LABEL[form.kind]}{form.pinned ? ' · ★' : ''}</span>
                <div style={{ fontFamily: th.fontDisplay, fontSize: 17, fontWeight: 600, marginTop: 8 }}>{form.title || 'Titre de l’annonce'}</div>
                <div style={{ fontFamily: th.fontUI, fontSize: 13, color: HERO_INK_MUTED, marginTop: 4, lineHeight: 1.4 }}>{form.body || 'Le contenu s’affiche ici…'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

⚠️ Vérifier au préalable que `AgendaHero` exporte bien `HERO_INK_MUTED` (constaté ligne 15 de `components/agenda/AgendaHero.tsx`). `Btn` accepte `variant="ghost"` et `icon` (usage identique à la page actuelle).

- [ ] **Step 4 : Lancer → succès**

Run: `node node_modules/jest/bin/jest.js __tests__/AnnouncementStudio.test.tsx`
Expected : PASS.

- [ ] **Step 5 : tsc**

Run: `node node_modules/typescript/bin/tsc --noEmit` (frontend)
Expected : PASS.

- [ ] **Step 6 : Commit**

```bash
git add frontend/components/admin/AnnouncementStudio.tsx frontend/__tests__/AnnouncementStudio.test.tsx
git commit -m "feat(annonces): composant AnnouncementStudio (fenetre + apercu direct)"
```

## Task A6 : Réécriture de la page Annonces (liste déplaçable + studio)

**Files:**
- Modify: `frontend/app/admin/announcements/page.tsx` (réécriture complète)
- Test: `frontend/__tests__/AdminAnnouncements.test.tsx`

- [ ] **Step 1 : Écrire/adapter les tests (échouants)**

Remplacer le contenu de `frontend/__tests__/AdminAnnouncements.test.tsx` par (garder les mocks existants du fichier s'ils diffèrent ; l'essentiel : mocker `api` avec `adminGetAnnouncements`, `adminReorderAnnouncements`, `adminDeleteAnnouncement`, `assetUrl`, et `AnnouncementStudio`) :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminAnnouncementsPage from '@/app/admin/announcements/page';
import { api } from '@/lib/api';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: new Proxy({}, { get: (_t, p) => (p === 'mode' ? 'daylight' : `--${String(p)}`) }) }) }));
jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1' } }) }));
jest.mock('@/components/admin/AnnouncementStudio', () => ({
  AnnouncementStudio: ({ onClose }: { onClose: () => void }) => <div data-testid="studio"><button onClick={onClose}>close</button></div>,
}));
jest.mock('@/lib/api', () => ({
  assetUrl: (u: string | null) => u,
  api: {
    adminGetAnnouncements: jest.fn().mockResolvedValue([
      { id: 'a1', title: 'Un', body: 'x', linkUrl: null, imageUrl: null, isPublished: true, pinned: true, kind: 'TOURNAMENT', validUntil: null, sortOrder: 0, createdAt: '2026-01-01', updatedAt: '' },
      { id: 'a2', title: 'Deux', body: 'y', linkUrl: null, imageUrl: null, isPublished: true, pinned: false, kind: 'INFO', validUntil: null, sortOrder: 1, createdAt: '2026-01-02', updatedAt: '' },
    ]),
    adminReorderAnnouncements: jest.fn().mockResolvedValue([]),
    adminDeleteAnnouncement: jest.fn().mockResolvedValue({ ok: true }),
  },
}));

describe('AdminAnnouncementsPage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('affiche la liste, badge ★ sur épinglée', async () => {
    render(<AdminAnnouncementsPage />);
    expect(await screen.findByText('Un')).toBeInTheDocument();
    expect(screen.getByText('Deux')).toBeInTheDocument();
  });

  it('« + Nouvelle annonce » ouvre le studio', async () => {
    render(<AdminAnnouncementsPage />);
    await screen.findByText('Un');
    fireEvent.click(screen.getByRole('button', { name: /Nouvelle annonce/i }));
    expect(screen.getByTestId('studio')).toBeInTheDocument();
  });

  it('flèche ↓ sur la 1re ligne réordonne → adminReorderAnnouncements(["a2","a1"])', async () => {
    render(<AdminAnnouncementsPage />);
    await screen.findByText('Un');
    fireEvent.click(screen.getByRole('button', { name: 'Descendre Un' }));
    await waitFor(() => expect(api.adminReorderAnnouncements).toHaveBeenCalledWith('club-1', ['a2', 'a1'], 'tok'));
  });
});
```

- [ ] **Step 2 : Lancer → échec**

Run: `node node_modules/jest/bin/jest.js __tests__/AdminAnnouncements.test.tsx`
Expected : FAIL (page pas encore réécrite).

- [ ] **Step 3 : Réécrire la page**

Remplacer intégralement `frontend/app/admin/announcements/page.tsx` :

```tsx
'use client';
import { useState, useEffect, useCallback, CSSProperties } from 'react';
import { api, Announcement, AnnouncementKind, assetUrl } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn, Chip } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { AnnouncementStudio } from '@/components/admin/AnnouncementStudio';

const KIND_LABEL: Record<AnnouncementKind, string> = { INFO: 'Info', OFFER: 'Offre', TOURNAMENT: 'Tournoi', EVENT: 'Event' };

export default function AdminAnnouncementsPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [studio, setStudio] = useState<{ editing: Announcement | null } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try { setError(null); setItems(await api.adminGetAnnouncements(clubId, token)); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, clubId]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  // Réordonnancement optimiste : maj locale immédiate + reorder en tâche de fond, recharge si échec.
  const persistOrder = async (next: Announcement[]) => {
    if (!token || !clubId) return;
    setItems(next);
    try { setError(null); await api.adminReorderAnnouncements(clubId, next.map((a) => a.id), token); }
    catch (e) { setError((e as Error).message); await load(); }
  };
  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[idx], next[target]] = [next[target], next[idx]];
    persistOrder(next);
  };
  const onDropRow = (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const next = [...items];
    const from = next.findIndex((a) => a.id === dragId);
    const to = next.findIndex((a) => a.id === targetId);
    setDragId(null);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    persistOrder(next);
  };

  const remove = async (a: Announcement) => {
    if (!token || !clubId) return;
    try { setError(null); await api.adminDeleteAnnouncement(clubId, a.id, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  const rowBtn: CSSProperties = { border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '6px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text };
  const arrow = (disabled: boolean): CSSProperties => ({ ...rowBtn, padding: '4px 9px', cursor: disabled ? 'default' : 'pointer', color: disabled ? th.textFaint : th.text });

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: '0 0 8px', color: th.text }}>Annonces</h1>
          <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: '0 0 22px' }}>Glissez pour réordonner. L'ordre choisi s'applique au Club-house.</p>
        </div>
        <Btn onClick={() => setStudio({ editing: null })} icon="plus">Nouvelle annonce</Btn>
      </div>

      {error && <div style={{ marginBottom: 16, background: th.accent, color: th.onAccent, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

      {loading ? (
        <div style={{ padding: '32px 0', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
      ) : items.length === 0 ? (
        <div style={{ borderRadius: 18, background: th.surface, boxShadow: th.shadow, padding: '28px 16px', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Aucune annonce pour l'instant.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((a, idx) => (
            <div key={a.id} onDragOver={(e) => e.preventDefault()} onDrop={() => onDropRow(a.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', borderRadius: 14, background: th.surface, boxShadow: th.shadow, borderLeft: a.pinned ? `4px solid ${th.accentWarm}` : '4px solid transparent', opacity: dragId === a.id ? 0.4 : 1 }}>
              <span draggable onDragStart={() => setDragId(a.id)} onDragEnd={() => setDragId(null)} title="Glisser pour réordonner" style={{ cursor: 'grab', display: 'flex', flexShrink: 0 }}>
                <Icon name="grip" size={18} color={th.textFaint} />
              </span>
              {a.imageUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={assetUrl(a.imageUrl) ?? ''} alt="" style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 10, flexShrink: 0 }} />
                : <div style={{ width: 46, height: 46, borderRadius: 10, background: th.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: th.textFaint, fontSize: 18 }}>i</div>}
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <div style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                  <Chip tone="mute">{KIND_LABEL[a.kind ?? 'INFO']}</Chip>
                  {a.pinned && <Chip tone="accent" icon="pin">À la une</Chip>}
                  {!a.isPublished && <Chip tone="line">Brouillon</Chip>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button onClick={() => move(idx, -1)} disabled={idx === 0} aria-label={`Monter ${a.title}`} style={arrow(idx === 0)}>↑</button>
                <button onClick={() => move(idx, 1)} disabled={idx === items.length - 1} aria-label={`Descendre ${a.title}`} style={arrow(idx === items.length - 1)}>↓</button>
                <button onClick={() => setStudio({ editing: a })} style={rowBtn}>Modifier</button>
                <button onClick={() => remove(a)} style={{ ...rowBtn, color: '#ff7a4d' }}>Suppr.</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {studio && clubId && token && (
        <AnnouncementStudio clubId={clubId} token={token} editing={studio.editing}
          onClose={() => setStudio(null)} onSaved={load} />
      )}
    </div>
  );
}
```

⚠️ Vérifier que `Chip` accepte `tone="mute"|"accent"|"line"` et `icon` (usage repris de la version actuelle). `Icon` a le nom `grip` (utilisé par `ClubHouseSectionsCard`).

- [ ] **Step 4 : Lancer → succès**

Run: `node node_modules/jest/bin/jest.js __tests__/AdminAnnouncements.test.tsx`
Expected : PASS.

- [ ] **Step 5 : tsc**

Run: `node node_modules/typescript/bin/tsc --noEmit` (frontend)
Expected : PASS.

- [ ] **Step 6 : Vérif visuelle (facultatif mais recommandé)**

Utiliser la skill `verify` sur `/admin/announcements` (clair + sombre, mobile 390 + desktop 1280) : liste déplaçable, badge ★, studio qui s'ouvre, aperçu direct, aucun débordement horizontal.

- [ ] **Step 7 : Commit**

```bash
git add frontend/app/admin/announcements/page.tsx frontend/__tests__/AdminAnnouncements.test.tsx
git commit -m "feat(annonces): page reecrite (liste deplacable + studio), pinned = badge"
```

---

# PARTIE B — Kiosque « À la une » repositionnable (page club)

## Task B1 : Backend — clé `kiosk` + normalizer (préfixe en tête)

**Files:**
- Modify: `backend/src/services/club.service.ts` (~ligne 58-78)
- Test: `backend/src/services/__tests__/club.service.test.ts` (~ligne 826)

- [ ] **Step 1 : Écrire/mettre à jour les tests (échouants)**

Dans `club.service.test.ts`, `describe('normalizeClubHouseSections', …)` :
- Le test « complète les clés manquantes en fin » attend actuellement 6 clés se terminant par `sponsors`. **Le mettre à jour** : la sortie doit contenir **7** entrées, et `kiosk` doit être **en tête** quand il manque de l'entrée fournie. Remplacer ce test par :

```typescript
  it('complète les clés manquantes ; kiosk absent → ajouté EN TÊTE, les autres en fin', () => {
    const out = normalizeClubHouseSections([
      { key: 'top', visible: false },
      { key: 'matches', visible: true },
    ]) as { key: string; visible: boolean }[];
    expect(out[0]).toEqual({ key: 'kiosk', visible: true });   // préfixé
    expect(out).toHaveLength(7);
    expect(out.map((e) => e.key)).toEqual(['kiosk', 'top', 'matches', 'agenda', 'offers', 'clubCard', 'sponsors']);
  });

  it('kiosk fourni explicitement n\'est pas dupliqué et garde sa position', () => {
    const out = normalizeClubHouseSections([
      { key: 'matches', visible: true },
      { key: 'kiosk', visible: false },
    ]) as { key: string; visible: boolean }[];
    expect(out.filter((e) => e.key === 'kiosk')).toHaveLength(1);
    expect(out.find((e) => e.key === 'kiosk')).toEqual({ key: 'kiosk', visible: false });
    expect(out).toHaveLength(7);
  });
```
- Le test « rejette les clés inconnues … `toHaveLength(6)` » → passer à **7**.
- Le test `updateClub` « `toHaveLength(6)` » (dans `describe('ClubService — sections du Club-house')`) → passer à **7**, et son `clubHouseSections[0]` attendu devient `{ key: 'kiosk', visible: true }` (car `top` fourni n'est plus en tête — le kiosk est préfixé).

- [ ] **Step 2 : Lancer → échec**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/club.service.test.ts --runInBand -t "sections"`
Expected : FAIL.

- [ ] **Step 3 : Implémenter**

Dans `club.service.ts`, ajouter `kiosk` en tête des clés :

```typescript
const CLUB_HOUSE_SECTION_KEYS = ['kiosk', 'matches', 'agenda', 'top', 'offers', 'clubCard', 'sponsors'] as const;
```

Modifier la boucle de complétion de `normalizeClubHouseSections` pour **préfixer `kiosk`** quand il manque (les autres restent en fin) :

```typescript
  if (out.length === 0) return Prisma.DbNull;
  if (!seen.has('kiosk')) out.unshift({ key: 'kiosk', visible: true }); // kiosque en tête si absent (rétro-compat)
  for (const key of CLUB_HOUSE_SECTION_KEYS) if (!seen.has(key)) out.push({ key, visible: true });
  return out as unknown as Prisma.InputJsonValue;
```

⚠️ La boucle `for … push` ré-ajouterait `kiosk` (car `seen` ne le contient toujours pas) → **ajouter `seen.add('kiosk')` juste après le `unshift`** :

```typescript
  if (!seen.has('kiosk')) { out.unshift({ key: 'kiosk', visible: true }); seen.add('kiosk'); }
  for (const key of CLUB_HOUSE_SECTION_KEYS) if (!seen.has(key)) out.push({ key, visible: true });
```

- [ ] **Step 4 : Lancer → succès**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/club.service.test.ts --runInBand -t "sections"`
Expected : PASS (dont `normalizeClubHouseSections` et `ClubService — sections`).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat(kiosque): cle de section 'kiosk' (prefixee en tete si absente)"
```

## Task B2 : Frontend `lib/clubhouse.ts` + type

**Files:**
- Modify: `frontend/lib/api.ts` (`ClubHouseSectionKey`, ~ligne 1294)
- Modify: `frontend/lib/clubhouse.ts` (SECTION_KEYS/DEFS/orders/resolveSections/fullSectionSettings)
- Test: `frontend/__tests__/clubhouse.test.ts`

- [ ] **Step 1 : Type**

Dans `frontend/lib/api.ts` :

```typescript
export type ClubHouseSectionKey = 'kiosk' | 'matches' | 'agenda' | 'top' | 'offers' | 'clubCard' | 'sponsors';
```

- [ ] **Step 2 : Écrire/mettre à jour les tests (échouants)**

Dans `clubhouse.test.ts` :
- `resolveSections(null, true).order` attendu devient `['kiosk', 'matches', 'agenda', 'top', 'offers', 'clubCard', 'sponsors']`.
- `resolveSections(null, false).order` devient `['kiosk', 'matches', 'clubCard', 'agenda', 'offers', 'top', 'sponsors']`.
- Le test « config custom » : les configs à 6 clés (sans kiosk) → `order` a **7** entrées avec `kiosk` en tête ; ajuster `member.order[0]` (ce n'est plus `top` mais `kiosk`) → tester plutôt `member.order.indexOf('top') === 1` et `expect(member.order[0]).toBe('kiosk')`.
- Le test « clé connue absente … `toHaveLength(6)` » → 7, et ajouter l'assertion `expect(order[0]).toBe('kiosk')`.
- `fullSectionSettings(null)` : `toHaveLength(7)`, `full[0]` = `{ key: 'kiosk', visible: true }`, `full[6].key === 'sponsors'`.
- `fullSectionSettings` config partielle : `toHaveLength(7)`, kiosk préfixé si absent.
- `SECTION_DEFS couvre SECTION_KEYS` : inchangé (auto-cohérent).

Ajouter un test dédié :

```typescript
it('kiosk absent d\'une config → inséré en tête (rétro-compat clubs déjà personnalisés)', () => {
  const { order } = resolveSections([
    { key: 'matches', visible: true }, { key: 'agenda', visible: true }, { key: 'top', visible: true },
    { key: 'offers', visible: true }, { key: 'clubCard', visible: true }, { key: 'sponsors', visible: true },
  ], true);
  expect(order[0]).toBe('kiosk');
  expect(order).toHaveLength(7);
});
it('kiosk masqué explicitement → exclu de order', () => {
  const { order } = resolveSections([{ key: 'kiosk', visible: false }, { key: 'matches', visible: true }], true);
  expect(order).not.toContain('kiosk');
});
```

- [ ] **Step 3 : Lancer → échec**

Run: `node node_modules/jest/bin/jest.js __tests__/clubhouse.test.ts`
Expected : FAIL.

- [ ] **Step 4 : Implémenter dans `lib/clubhouse.ts`**

```typescript
export const SECTION_KEYS: ClubHouseSectionKey[] = ['kiosk', 'matches', 'agenda', 'top', 'offers', 'clubCard', 'sponsors'];

export const SECTION_DEFS: { key: ClubHouseSectionKey; label: string; hint?: string }[] = [
  { key: 'kiosk', label: 'À la une', hint: 'Vos annonces (kiosque) · défilement réglable' },
  { key: 'matches', label: 'Ça joue bientôt', hint: 'Parties ouvertes qui cherchent des joueurs' },
  { key: 'agenda', label: 'Prochains events & vos réservations' },
  { key: 'top', label: 'Top du mois', hint: 'Podium des victoires du mois' },
  { key: 'offers', label: 'Offres du club', hint: 'Dépend aussi de « Vendre les offres en ligne » (Réglages)' },
  { key: 'clubCard', label: 'Le club', hint: 'Présentation et photos' },
  { key: 'sponsors', label: 'Partenaires', hint: 'Rivière de logos' },
];

const MEMBER_ORDER: ClubHouseSectionKey[] = ['kiosk', 'matches', 'agenda', 'top', 'offers', 'clubCard', 'sponsors'];
const VISITOR_ORDER: ClubHouseSectionKey[] = ['kiosk', 'matches', 'clubCard', 'agenda', 'offers', 'top', 'sponsors'];
```

Dans `resolveSections`, après la boucle qui lit `config` et avant la complétion en fin, **préfixer `kiosk`** s'il manque :

```typescript
  const seen = new Set<string>();
  const order: ClubHouseSectionKey[] = [];
  for (const e of config) {
    const key = e?.key as ClubHouseSectionKey | undefined;
    if (!key || seen.has(key) || !SECTION_KEYS.includes(key)) continue;
    seen.add(key);
    if (e.visible !== false) order.push(key);
  }
  if (!seen.has('kiosk')) { seen.add('kiosk'); order.unshift('kiosk'); } // kiosque en tête si absent (visible)
  for (const key of SECTION_KEYS) {
    if (!seen.has(key)) order.push(key);
  }
  return { order };
```

⚠️ Subtilité : une config qui contient `{ key: 'kiosk', visible: false }` met `seen.has('kiosk') === true` et n'ajoute pas au `order` → kiosque masqué. Correct. Le `unshift` ne s'applique que si `kiosk` **absent** de la config.

Dans `fullSectionSettings`, préfixer aussi `kiosk` s'il manque :

```typescript
  const seen = new Set<string>();
  const out: ClubHouseSectionSetting[] = [];
  for (const e of config) {
    const key = e?.key as ClubHouseSectionKey | undefined;
    if (!key || seen.has(key) || !SECTION_KEYS.includes(key)) continue;
    seen.add(key);
    out.push({ key, visible: e.visible !== false });
  }
  if (!seen.has('kiosk')) { seen.add('kiosk'); out.unshift({ key: 'kiosk', visible: true }); }
  for (const key of SECTION_KEYS) if (!seen.has(key)) out.push({ key, visible: true });
  return out;
```

Mettre à jour le commentaire de `kiosqueSlides` (« ordre manuel de l'admin » au lieu de « épinglées d'abord »).

- [ ] **Step 5 : Lancer → succès**

Run: `node node_modules/jest/bin/jest.js __tests__/clubhouse.test.ts`
Expected : PASS.

- [ ] **Step 6 : tsc**

Run: `node node_modules/typescript/bin/tsc --noEmit` (frontend)
Expected : PASS.

- [ ] **Step 7 : Commit**

```bash
git add frontend/lib/api.ts frontend/lib/clubhouse.ts frontend/__tests__/clubhouse.test.ts
git commit -m "feat(kiosque): cle 'kiosk' cote front (prefixee en tete si absente)"
```

## Task B3 : `ClubHouse.tsx` — kiosque rendu à sa position

**Files:**
- Modify: `frontend/components/ClubHouse.tsx` (~ligne 126-181)
- Test: `frontend/__tests__/ClubHouse.test.tsx`

- [ ] **Step 1 : Écrire les tests (échouants)**

Le vrai `AnnouncementKiosk` rend `data-testid="clubhouse-kiosk"` (constaté dans les tests existants, lignes 91/102) — **ne pas le mocker**. Les helpers `clubWith(sections)` et `wrapWith(c)` existent déjà en tête du fichier ; `fullSections()` peuple toutes les sections `sec-*`. Ajouter ces tests dans `describe('ClubHouse', …)` :

```tsx
it('kiosque masqué quand la section kiosk est désactivée', async () => {
  mocked.getClubAnnouncements.mockResolvedValue([regular] as never);
  wrapWith(clubWith([
    { key: 'kiosk', visible: false },
    { key: 'matches', visible: true },
  ]));
  await waitFor(() => expect(mocked.getClubAnnouncements).toHaveBeenCalled());
  expect(screen.queryByTestId('clubhouse-kiosk')).not.toBeInTheDocument();
});

it('kiosque rendu à sa position quand déplacé (après « Ça joue bientôt »)', async () => {
  fullSections();
  wrapWith(clubWith([
    { key: 'matches', visible: true }, { key: 'kiosk', visible: true }, { key: 'agenda', visible: true },
    { key: 'top', visible: true }, { key: 'offers', visible: true }, { key: 'clubCard', visible: true }, { key: 'sponsors', visible: true },
  ]));
  await waitFor(() => expect(screen.getByTestId('sec-matches')).toBeInTheDocument());
  const matches = screen.getByTestId('sec-matches');
  const kiosk = screen.getByTestId('clubhouse-kiosk');
  // matches AVANT kiosk dans le DOM
  expect(matches.compareDocumentPosition(kiosk) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('par défaut (config null) le kiosque est en tête', async () => {
  fullSections();
  wrapWith(clubWith(null));
  await waitFor(() => expect(screen.getByTestId('sec-matches')).toBeInTheDocument());
  const kiosk = screen.getByTestId('clubhouse-kiosk');
  const matches = screen.getByTestId('sec-matches');
  // kiosk AVANT matches
  expect(kiosk.compareDocumentPosition(matches) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
```

Note : les tests d'ordre existants (`visiteur`/`membre`, lignes 138-159) ne regardent que les testids `sec-*` (le kiosque est `clubhouse-kiosk`) → **ils restent verts** sans modification.

- [ ] **Step 2 : Lancer → échec**

Run: `node node_modules/jest/bin/jest.js __tests__/ClubHouse.test.tsx`
Expected : FAIL (kiosque toujours rendu, jamais masqué).

- [ ] **Step 3 : Implémenter**

Dans `ClubHouse.tsx` :

1. Ajouter `kiosk` à l'objet `sections` (toujours truthy → se rend même sans annonce via son repli) :

```typescript
  const sections: Record<string, React.ReactNode> = {
    kiosk: <AnnouncementKiosk clubName={club.name} slides={slides} now={clock} intervalSeconds={club.clubHouseKioskSeconds} />,
    clubCard: showClubCard && presentation && (
      // … inchangé …
    ),
    // … reste inchangé …
  };
```

2. Supprimer le `<AnnouncementKiosk … />` codé en dur du `return` (l'ancienne ligne ~168).

3. Exclure `kiosk` de `wrap()` (comme `sponsors`) dans la boucle :

```tsx
      {order.map((k) => (k === 'sponsors' || k === 'kiosk' ? sections[k] : wrap(k, sections[k])))}
```

Le `return` devient (ordre : `ResultsToRecord` reste au-dessus des sections ; il n'apparaît que s'il y a des résultats à saisir — bannière fine, impact négligeable si le kiosque n'est plus tout en haut) :

```tsx
  return (
    <>
      {club.levelSystemEnabled !== false && (
        <ResultsToRecord token={token} clubSlug={club.slug} />
      )}

      {order.map((k) => (k === 'sponsors' || k === 'kiosk' ? sections[k] : wrap(k, sections[k])))}

      {empty && (
        <div style={{ padding: '40px 20px', textAlign: 'center', fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>
          Pas d&apos;informations pour le moment.
        </div>
      )}
      {/* … reste du JSX (dialogs, auth prompt) inchangé … */}
```

⚠️ Ne pas toucher au fetch des annonces (`slides`) : il reste **inconditionnel** (sert au repli du kiosque et à `empty`).

- [ ] **Step 4 : Lancer → succès**

Run: `node node_modules/jest/bin/jest.js __tests__/ClubHouse.test.tsx`
Expected : PASS.

- [ ] **Step 5 : tsc**

Run: `node node_modules/typescript/bin/tsc --noEmit` (frontend)
Expected : PASS.

- [ ] **Step 6 : Commit**

```bash
git add frontend/components/ClubHouse.tsx frontend/__tests__/ClubHouse.test.tsx
git commit -m "feat(kiosque): rendu a sa position dans l'ordre des sections (masquable)"
```

## Task B4 : `ClubHouseSectionsCard` — refonte + rangée kiosque (défilement replié)

**Files:**
- Modify: `frontend/components/admin/ClubHouseSectionsCard.tsx` (réécriture partielle)
- Test: `frontend/__tests__/AdminClub.test.tsx`

Objectif Direction A : le gros bloc « Défilement des annonces » séparé disparaît ; le réglage de défilement se **replie sous la rangée kiosque** (visible seulement quand cette rangée est développée). Les rangées gardent poignée ⠿ + ↑↓ + case « Afficher ». Le kiosque est identifié par un marqueur ★.

- [ ] **Step 1 : Mettre à jour les tests existants + en ajouter un (échouants)**

⚠️ Le changement casse plusieurs tests de `AdminClub.test.tsx` (kiosque ajouté en tête → **7** clés ; bloc « Défilement » déplacé sous la rangée kiosque). Le helper `wrap()` rend `<AdminClubPage />`, `api.adminGetClub` renvoie `{ clubHouseSections: null }`. Mises à jour :

- Test « masquer une section → PATCH liste complète » : `expect(body.clubHouseSections).toHaveLength(6)` → **7** (l'assertion `find(s.key==='top')` reste valable).
- Test « ↓ sur la première ligne → ordre permuté » : la 1re ligne est désormais « À la une ». « Descendre Ça joue bientôt » agit sur `matches` (index 1) → ordre `[kiosk, agenda, matches, …]`. Remplacer les assertions par :
```tsx
expect(body.clubHouseSections[0].key).toBe('kiosk');
expect(body.clubHouseSections[1].key).toBe('agenda');
expect(body.clubHouseSections[2].key).toBe('matches');
```
- Test « Partenaires réordonnable (↑) » : `toHaveLength(6)` → **7** ; après « Monter Partenaires » l'ordre devient `[kiosk, matches, agenda, top, offers, sponsors, clubCard]` → remplacer les 2 assertions d'index par `expect(body.clubHouseSections[5].key).toBe('sponsors')` et `expect(body.clubHouseSections[6].key).toBe('clubCard')` (les assertions « Descendre Partenaires » désactivé / « Monter Partenaires » actif restent vraies).
- Tests « curseur de vitesse » et « Pas de défilement automatique » : le bloc n'est plus visible d'emblée (plus de libellé `Défilement des annonces`). Remplacer le début de chaque test par un dépliage préalable, puis garder l'interaction (aria-labels inchangés) :
```tsx
await waitFor(() => expect(screen.getByText('Sections du Club-house')).toBeInTheDocument());
fireEvent.click(screen.getByRole('button', { name: /Défilement/i })); // déplie le panneau du kiosque
```

Ajouter le test de la rangée kiosque + panneau replié :
```tsx
it('carte Sections : rangée « À la une » avec réglage de défilement replié', async () => {
  wrap();
  expect(await screen.findByText(/À la une/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Temps de pause entre deux annonces (secondes)')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Défilement/i }));
  expect(screen.getByLabelText('Temps de pause entre deux annonces (secondes)')).toBeInTheDocument();
});
```

- [ ] **Step 2 : Lancer → échec**

Run: `node node_modules/jest/bin/jest.js __tests__/AdminClub.test.tsx`
Expected : FAIL.

- [ ] **Step 3 : Implémenter**

Dans `ClubHouseSectionsCard.tsx` :
1. Supprimer le bloc « Défilement des annonces » **séparé** en tête (le `div` `rowStyle` avec le `range`, ~lignes 118-134).
2. Ajouter un état `const [kioskOpen, setKioskOpen] = useState(false);`.
3. Dans la boucle `items.map`, pour la rangée dont `s.key === 'kiosk'`, afficher un marqueur ★ à côté du label et, **sous** la rangée, un panneau repliable contenant le curseur `speed` + case `manual` (logique `onSpeed`/`onManual`/`persistKiosk` **inchangée**). Exemple de rendu de rangée kiosque :

```tsx
{items.map((s, idx) => {
  const def = defs.get(s.key);
  const isKiosk = s.key === 'kiosk';
  return (
    <div key={s.key}>
      <div onDragOver={(e) => e.preventDefault()} onDrop={() => onDropRow(s.key)}
        style={{ ...rowStyle, opacity: dragKey === s.key ? 0.4 : (s.visible ? 1 : 0.55), borderColor: isKiosk ? th.accentWarm : th.line }}>
        <span draggable onDragStart={() => setDragKey(s.key)} onDragEnd={() => setDragKey(null)} title="Glisser pour réordonner" style={{ cursor: 'grab', display: 'flex' }}>
          <Icon name="grip" size={18} color={th.textFaint} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 600, color: th.text }}>
            {def?.label}{isKiosk && <span style={{ marginLeft: 6, color: th.accentWarm, fontWeight: 700 }}>★</span>}
          </div>
          {isKiosk
            ? <button onClick={() => setKioskOpen((v) => !v)} style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12, color: th.accent, fontWeight: 600 }}>
                Défilement : {manual ? 'manuel' : `${speed} s`} {kioskOpen ? '▴' : '▾'}
              </button>
            : def?.hint && <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>{def.hint}</div>}
        </div>
        <button onClick={() => move(idx, -1)} disabled={idx === 0} aria-label={`Monter ${def?.label}`} style={arrowStyle(idx === 0)}>↑</button>
        <button onClick={() => move(idx, 1)} disabled={idx === items.length - 1} aria-label={`Descendre ${def?.label}`} style={arrowStyle(idx === items.length - 1)}>↓</button>
        <label style={toggleLabel}>
          <input type="checkbox" checked={s.visible} onChange={() => toggle(s.key)} aria-label={`Afficher ${def?.label}`} />
          Afficher
        </label>
      </div>
      {isKiosk && kioskOpen && (
        <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 10, marginTop: 6 }}>
          <input type="range" min={3} max={20} step={1} value={speed} disabled={manual}
            aria-label="Temps de pause entre deux annonces (secondes)"
            onChange={(e) => onSpeed(Number(e.target.value))}
            style={{ width: '100%', accentColor: th.accent, cursor: manual ? 'default' : 'pointer', opacity: manual ? 0.4 : 1 }} />
          <label style={{ ...toggleLabel, whiteSpace: 'normal' }}>
            <input type="checkbox" checked={manual} onChange={(e) => onManual(e.target.checked)} aria-label="Pas de défilement automatique" />
            Pas de défilement automatique (le visiteur navigue à la main)
          </label>
        </div>
      )}
    </div>
  );
})}
```

Le reste du composant (chargement, `persist`, `reset`, `ConfirmDialog`) est inchangé. `fullSectionSettings` renvoyant désormais 7 entrées, la rangée kiosque apparaît automatiquement.

- [ ] **Step 4 : Lancer → succès**

Run: `node node_modules/jest/bin/jest.js __tests__/AdminClub.test.tsx`
Expected : PASS.

- [ ] **Step 5 : tsc**

Run: `node node_modules/typescript/bin/tsc --noEmit` (frontend)
Expected : PASS.

- [ ] **Step 6 : Vérif visuelle**

Skill `verify` sur `/admin/club` (clair + sombre, 390 + 1280) : rangée « À la une ★ » déplaçable, réglage de défilement replié qui s'ouvre, plus de bloc séparé, aucun débordement. Vérifier aussi `/` (club-house) : kiosque toujours en tête par défaut, et déplaçable si on change l'ordre.

- [ ] **Step 7 : Commit**

```bash
git add frontend/components/admin/ClubHouseSectionsCard.tsx frontend/__tests__/AdminClub.test.tsx
git commit -m "feat(kiosque): carte Sections - rangee kiosque + defilement replie (Direction A)"
```

---

## Vérification finale (les deux parties)

- [ ] **tsc global** : `node node_modules/typescript/bin/tsc --noEmit` (frontend **et** backend) → PASS.
- [ ] **Suites touchées** (backend) : `node node_modules/jest/bin/jest.js src/services/__tests__/announcement.service.test.ts src/services/__tests__/club.service.test.ts --runInBand` → PASS.
- [ ] **Suites touchées** (frontend) : `node node_modules/jest/bin/jest.js __tests__/AnnouncementStudio.test.tsx __tests__/AdminAnnouncements.test.tsx __tests__/clubhouse.test.ts __tests__/ClubHouse.test.tsx __tests__/AdminClub.test.tsx` → PASS.
- [ ] **Fumée E2E** : créer une annonce (apparaît en tête), la glisser plus bas, vérifier l'ordre sur le club-house ; déplacer le kiosque après « Ça joue bientôt » dans les Sections, vérifier sur `/` ; masquer le kiosque, vérifier qu'il disparaît.
- [ ] **Rappel** : appliquer la migration en prod via `prisma migrate deploy` (la colonne `sort_order` est additive, `DEFAULT 0`).

## Notes / pièges (mémoires projet)
- Shims `.bin` cassés → lancer jest/tsc via `node node_modules/...` (jamais `npx jest`).
- Frontend jest **ne type-check pas** (`isolatedModules`) → toujours faire tourner `tsc --noEmit` séparément.
- Dérive de base dev → migration appliquée via `prisma db execute` (jamais `migrate dev`/`db push`).
- WIP parallèle possible sur `main` → committer **fichier par fichier** (les `git add` ci-dessus ciblent des chemins précis), ne jamais `git add -A`.
- OneDrive : si `.prisma`/node_modules se dé-synchronisent, `npm install` + `npx prisma generate`.
```
