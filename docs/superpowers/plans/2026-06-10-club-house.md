# Club-house Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformer la page « Infos » en page « Club-house » : hero « À la une », créneaux libres du jour, prochains tournois avec urgence des places, offres partenaires avec code copiable.

**Architecture:** Aucune nouvelle route publique — la page agrège 5 appels existants. Un seul changement backend : 2 champs optionnels sur `Sponsor`. Frontend : orchestrateur `ClubHouse.tsx` + petits composants présentationnels (props-driven, testables sans mock API) dans `components/clubhouse/`, helpers purs dans `lib/clubhouse.ts`.

**Tech Stack:** Express 5 + Prisma 7 (PostgreSQL), Next.js 16 + React 19, Jest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-10-club-house-design.md`

**⚠️ Contexte git :** le working tree contient des modifications non commitées de la branche `fix/tournoi-partner-search` (chantier tournois). **Ne jamais faire `git add -A`** — chaque commit de ce plan liste explicitement ses fichiers. Créer la branche de travail avant la Tâche 1 : `git checkout -b feat/club-house`.

**Chemin projet :** `C:/Users/e.nougayrede/OneDrive - BAYARD PRESSE/IA/05_PERSO/RESERVE/palova` (abrégé `<ROOT>` ci-dessous — remplacer dans les commandes).

---

## Carte des fichiers

| Fichier | Action | Responsabilité |
|---|---|---|
| `backend/prisma/schema.prisma` | Modifier | + `offerText`/`offerCode` sur `Sponsor` |
| `backend/src/services/sponsor.service.ts` | Modifier | accepter/normaliser les 2 champs |
| `backend/src/services/__tests__/sponsor.service.test.ts` | Créer | tests service sponsor |
| `frontend/lib/api.ts` | Modifier | types `Sponsor`/`SponsorBody` |
| `frontend/app/admin/sponsors/page.tsx` | Modifier | formulaire + tableau avec offre |
| `frontend/lib/clubhouse.ts` | Créer | helpers purs (créneaux, tournois, libellés) |
| `frontend/__tests__/clubhouse.test.ts` | Créer | tests helpers |
| `frontend/components/clubhouse/PartnerOffers.tsx` | Créer | offres + code copiable |
| `frontend/components/clubhouse/HeroAnnouncement.tsx` | Créer | bandeau « À la une » |
| `frontend/components/clubhouse/SlotsAlaUne.tsx` | Créer | bloc créneaux du jour |
| `frontend/components/clubhouse/TournamentsAlaUne.tsx` | Créer | bloc prochains tournois |
| `frontend/__tests__/PartnerOffers.test.tsx` etc. | Créer | tests RTL par composant |
| `frontend/components/ClubHouse.tsx` | Créer | orchestrateur (remplace `ClubInfo.tsx`) |
| `frontend/components/ClubInfo.tsx` | Supprimer | remplacé par `ClubHouse.tsx` |
| `frontend/app/club-house/page.tsx` | Créer | nouvelle route |
| `frontend/app/infos/page.tsx` | Remplacer | simple redirection |
| `frontend/components/ui/Icon.tsx` | Modifier | + icône `home` |
| `frontend/components/ClubNav.tsx` | Modifier | onglet « Club-house » |
| `frontend/__tests__/ClubNav.test.tsx` | Modifier | libellés à jour |
| `frontend/components/ClubReserve.tsx` | Modifier | lien profond `?resource=&start=` |
| `frontend/__tests__/ClubReserve.deeplink.test.tsx` | Créer | test lien profond |
| `CLAUDE.md` | Modifier | documenter la feature |

---

### Task 1: Backend — champs `offerText`/`offerCode` sur Sponsor

**Files:**
- Modify: `backend/prisma/schema.prisma` (modèle `Sponsor`, ~ligne 302)
- Modify: `backend/src/services/sponsor.service.ts`
- Test: `backend/src/services/__tests__/sponsor.service.test.ts` (créer)

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `backend/src/services/__tests__/sponsor.service.test.ts` (même pattern que `announcement.service.test.ts` : le mock Prisma est dans `../../__mocks__/prisma`) :

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { SponsorService } from '../sponsor.service';

describe('SponsorService', () => {
  let service: SponsorService;
  beforeEach(() => { service = new SponsorService(); });

  it('create normalise offerText/offerCode (trim, vide → null)', async () => {
    prismaMock.sponsor.create.mockResolvedValue({ id: 's1' } as any);
    await service.create('club-demo', {
      name: 'Babolat', logoUrl: 'https://x/logo.png',
      offerText: '  -10 % raquettes  ', offerCode: '   ',
    });
    expect(prismaMock.sponsor.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ offerText: '-10 % raquettes', offerCode: null }),
    }));
  });

  it('create sans offre → offerText/offerCode null', async () => {
    prismaMock.sponsor.create.mockResolvedValue({ id: 's1' } as any);
    await service.create('club-demo', { name: 'Decathlon', logoUrl: 'https://x/l.png' });
    expect(prismaMock.sponsor.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ offerText: null, offerCode: null }),
    }));
  });

  it('update accepte offerText/offerCode et permet de les effacer', async () => {
    prismaMock.sponsor.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
    prismaMock.sponsor.update.mockResolvedValue({ id: 's1' } as any);
    await service.update('s1', 'club-demo', { offerText: ' Balles offertes ', offerCode: '' });
    expect(prismaMock.sponsor.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { offerText: 'Balles offertes', offerCode: null },
    }));
  });

  it('update ignore les champs non fournis (pas d écrasement)', async () => {
    prismaMock.sponsor.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
    prismaMock.sponsor.update.mockResolvedValue({ id: 's1' } as any);
    await service.update('s1', 'club-demo', { name: 'Babolat Pro' });
    expect(prismaMock.sponsor.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { name: 'Babolat Pro' },
    }));
  });

  it('update rejette SPONSOR_NOT_FOUND si le sponsor est d un autre club', async () => {
    prismaMock.sponsor.findUnique.mockResolvedValue({ clubId: 'autre' } as any);
    await expect(service.update('s1', 'club-demo', { offerText: 'x' })).rejects.toThrow('SPONSOR_NOT_FOUND');
  });
});
```

- [ ] **Step 2: Vérifier que les tests échouent**

```bash
cd "<ROOT>/backend" && npx jest src/services/__tests__/sponsor.service.test.ts
```
Attendu : FAIL (les assertions `offerText`/`offerCode` ne matchent pas — champs inexistants).

- [ ] **Step 3: Schéma Prisma + migration**

Dans `backend/prisma/schema.prisma`, modèle `Sponsor`, ajouter après `linkUrl` :

```prisma
  offerText String?  @map("offer_text")  // ex. « −10 % sur les raquettes en boutique »
  offerCode String?  @map("offer_code")  // code promo affiché copiable côté joueur
```

Puis générer la migration (PostgreSQL Docker doit tourner) :

```bash
cd "<ROOT>/backend" && npx prisma migrate dev --name add_sponsor_offer
```
Attendu : migration `…_add_sponsor_offer` créée et appliquée, client régénéré.

- [ ] **Step 4: Implémenter dans le service**

Dans `backend/src/services/sponsor.service.ts` :

```typescript
interface SponsorInput {
  name?: string; logoUrl?: string; linkUrl?: string | null;
  sortOrder?: number; isActive?: boolean;
  offerText?: string | null; offerCode?: string | null;
}
```

Dans `create`, ajouter au `data` :
```typescript
        offerText: data.offerText?.trim() || null,
        offerCode: data.offerCode?.trim() || null,
```

Dans `update`, ajouter au `data` :
```typescript
        ...(data.offerText !== undefined ? { offerText: data.offerText?.trim() || null } : {}),
        ...(data.offerCode !== undefined ? { offerCode: data.offerCode?.trim() || null } : {}),
```

(Rien à faire dans les routes : `admin.ts` passe `req.body` tel quel, `listPublic` renvoie le modèle complet.)

- [ ] **Step 5: Vérifier que les tests passent**

```bash
cd "<ROOT>/backend" && npx jest src/services/__tests__/sponsor.service.test.ts
```
Attendu : PASS (5 tests).

- [ ] **Step 6: Suite backend complète puis commit**

```bash
cd "<ROOT>/backend" && npm test
```
Attendu : tous les tests passent (117 existants + 5 nouveaux).

```bash
cd "<ROOT>" && git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/services/sponsor.service.ts backend/src/services/__tests__/sponsor.service.test.ts && git commit -m "feat(sponsors): champs offerText/offerCode (offre partenaire + code promo)"
```

---

### Task 2: Frontend — types API Sponsor

**Files:**
- Modify: `frontend/lib/api.ts:544-555`

- [ ] **Step 1: Mettre à jour les types**

Dans `frontend/lib/api.ts`, interface `Sponsor`, ajouter après `linkUrl: string | null;` :

```typescript
  offerText: string | null;
  offerCode: string | null;
```

Et dans `SponsorBody` :

```typescript
export type SponsorBody = Partial<{ name: string; logoUrl: string; linkUrl: string; sortOrder: number; isActive: boolean; offerText: string; offerCode: string; }>;
```

- [ ] **Step 2: Vérifier la compilation et commit**

```bash
cd "<ROOT>/frontend" && npx tsc --noEmit
```
Attendu : aucune erreur.

```bash
cd "<ROOT>" && git add frontend/lib/api.ts && git commit -m "feat(sponsors): types front offerText/offerCode"
```

---

### Task 3: Admin — formulaire sponsor avec offre

**Files:**
- Modify: `frontend/app/admin/sponsors/page.tsx`

- [ ] **Step 1: Étendre le formulaire**

Dans `frontend/app/admin/sponsors/page.tsx` :

1. La constante `EMPTY` devient :
```typescript
const EMPTY = { name: '', logoUrl: '', linkUrl: '', sortOrder: '0', isActive: true, offerText: '', offerCode: '' };
```

2. Dans `submit`, le `body` envoie toujours les deux champs (chaîne vide = effacement, le service la transforme en `null`) :
```typescript
    const body: SponsorBody = {
      name: form.name.trim(),
      logoUrl: form.logoUrl.trim(),
      linkUrl: form.linkUrl.trim() || undefined,
      sortOrder: Number.parseInt(form.sortOrder, 10) || 0,
      isActive: form.isActive,
      offerText: form.offerText.trim(),
      offerCode: form.offerCode.trim(),
    };
```

3. Dans `startEdit`, compléter le `setForm` :
```typescript
      offerText: s.offerText ?? '', offerCode: s.offerCode ?? '',
```

4. Dans le JSX, après la rangée `Lien (optionnel)` / `Ordre d'affichage`, ajouter une rangée :
```tsx
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ ...labelStyle, flex: 1, minWidth: 220 }}>
              Offre (optionnel)
              <input value={form.offerText} onChange={(e) => setForm({ ...form, offerText: e.target.value })} placeholder="−10 % sur les raquettes en boutique" style={inputStyle} />
            </label>
            <label style={{ ...labelStyle, width: 160 }}>
              Code promo
              <input value={form.offerCode} onChange={(e) => setForm({ ...form, offerCode: e.target.value })} placeholder="TPC10" style={inputStyle} />
            </label>
          </div>
```

5. Dans le tableau : l'en-tête devient `['Logo', 'Partenaire', 'Offre', 'Ordre', 'Statut', '']`, le `colSpan` de la ligne vide passe de `5` à `6`, et ajouter entre la cellule « Partenaire » et « Ordre » :
```tsx
                  <td style={{ ...cell, color: th.textMute, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.offerText ?? '—'}{s.offerCode ? ` · ${s.offerCode}` : ''}
                  </td>
```

- [ ] **Step 2: Vérifier compilation + suite frontend, commit**

```bash
cd "<ROOT>/frontend" && npx tsc --noEmit && npm test
```
Attendu : compilation OK, tests existants verts.

```bash
cd "<ROOT>" && git add frontend/app/admin/sponsors/page.tsx && git commit -m "feat(admin): saisie offre + code promo sur les partenaires"
```

---

### Task 4: Helpers purs `lib/clubhouse.ts`

**Files:**
- Create: `frontend/lib/clubhouse.ts`
- Test: `frontend/__tests__/clubhouse.test.ts` (créer)

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `frontend/__tests__/clubhouse.test.ts` :

```typescript
import { pickUpcomingSlots, pickUpcomingTournaments, tournamentPlacesLabel } from '../lib/clubhouse';
import { ClubAvailability, Tournament } from '../lib/api';

const slot = (startTime: string, available = true) =>
  ({ startTime, endTime: startTime, available, pricePerHour: '25', offPeak: false });
const court = (id: string, name: string, slots: ReturnType<typeof slot>[]) =>
  ({ resource: { id, name }, slots }) as unknown as ClubAvailability;
const NOW = new Date('2026-06-10T12:00:00Z');

describe('pickUpcomingSlots', () => {
  it('garde les créneaux libres postérieurs à maintenant, triés, max 3, tous terrains', () => {
    const avail = [
      court('c1', 'Terrain 1', [slot('2026-06-10T10:00:00Z'), slot('2026-06-10T15:00:00Z'), slot('2026-06-10T18:00:00Z')]),
      court('c2', 'Terrain 2', [slot('2026-06-10T13:00:00Z'), slot('2026-06-10T14:00:00Z', false), slot('2026-06-10T19:00:00Z')]),
    ];
    const out = pickUpcomingSlots(avail, NOW);
    expect(out.map((s) => [s.resourceName, s.slot.startTime])).toEqual([
      ['Terrain 2', '2026-06-10T13:00:00Z'],
      ['Terrain 1', '2026-06-10T15:00:00Z'],
      ['Terrain 1', '2026-06-10T18:00:00Z'],
    ]);
  });

  it('renvoie [] quand plus rien de libre', () => {
    expect(pickUpcomingSlots([court('c1', 'T1', [slot('2026-06-10T10:00:00Z')])], NOW)).toEqual([]);
  });
});

describe('pickUpcomingTournaments', () => {
  const t = (id: string, startTime: string, status = 'PUBLISHED') => ({ id, startTime, status }) as Tournament;
  it('garde les 2 prochains tournois publiés à venir', () => {
    const out = pickUpcomingTournaments([
      t('t-passe', '2026-06-01T09:00:00Z'),
      t('t3', '2026-08-01T09:00:00Z'),
      t('t1', '2026-06-20T09:00:00Z'),
      t('t2', '2026-07-01T09:00:00Z'),
      t('t-draft', '2026-06-15T09:00:00Z', 'DRAFT'),
    ], NOW);
    expect(out.map((x) => x.id)).toEqual(['t1', 't2']);
  });
});

describe('tournamentPlacesLabel', () => {
  const t = (maxTeams: number | null, confirmedCount: number) => ({ maxTeams, confirmedCount }) as Tournament;
  it('urgence quand ≤ 5 places restantes', () => {
    expect(tournamentPlacesLabel(t(16, 13))).toEqual({ text: 'Plus que 3 places', urgent: true });
    expect(tournamentPlacesLabel(t(16, 15))).toEqual({ text: 'Plus que 1 place', urgent: true });
  });
  it('complet → liste d attente', () => {
    expect(tournamentPlacesLabel(t(16, 16))).toEqual({ text: "Complet · liste d'attente possible", urgent: false });
  });
  it('pas d urgence sinon', () => {
    expect(tournamentPlacesLabel(t(16, 4))).toEqual({ text: '12 places restantes', urgent: false });
    expect(tournamentPlacesLabel(t(null, 7))).toEqual({ text: '7 binômes inscrits', urgent: false });
    expect(tournamentPlacesLabel(t(null, 1))).toEqual({ text: '1 binôme inscrit', urgent: false });
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

```bash
cd "<ROOT>/frontend" && npx jest __tests__/clubhouse.test.ts
```
Attendu : FAIL (« Cannot find module '../lib/clubhouse' »).

- [ ] **Step 3: Implémenter**

Créer `frontend/lib/clubhouse.ts` :

```typescript
import { ClubAvailability, TimeSlot, Tournament } from '@/lib/api';

export interface UpcomingSlot { resourceId: string; resourceName: string; slot: TimeSlot; }

/** Date du jour (clé YYYY-MM-DD) — même convention que ClubReserve. */
export function todayISO(): string { return new Date().toISOString().slice(0, 10); }

/** Les `max` prochains créneaux libres (tous terrains confondus), postérieurs à `now`, triés par heure. */
export function pickUpcomingSlots(avail: ClubAvailability[], now: Date, max = 3): UpcomingSlot[] {
  return avail
    .flatMap((a) => a.slots
      .filter((s) => s.available && new Date(s.startTime) > now)
      .map((slot) => ({ resourceId: a.resource.id, resourceName: a.resource.name, slot })))
    .sort((x, y) => x.slot.startTime.localeCompare(y.slot.startTime))
    .slice(0, max);
}

/** Les `max` prochains tournois publiés à venir, triés par date de début. */
export function pickUpcomingTournaments(tournaments: Tournament[], now: Date, max = 2): Tournament[] {
  return tournaments
    .filter((t) => t.status === 'PUBLISHED' && new Date(t.startTime) > now)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .slice(0, max);
}

/** Libellé des places d'un tournoi — urgent (rouge) quand il reste ≤ 5 places. */
export function tournamentPlacesLabel(t: Tournament): { text: string; urgent: boolean } {
  if (t.maxTeams != null) {
    const left = t.maxTeams - t.confirmedCount;
    if (left <= 0) return { text: "Complet · liste d'attente possible", urgent: false };
    if (left <= 5) return { text: `Plus que ${left} place${left > 1 ? 's' : ''}`, urgent: true };
    return { text: `${left} places restantes`, urgent: false };
  }
  const n = t.confirmedCount;
  return { text: `${n} binôme${n > 1 ? 's' : ''} inscrit${n > 1 ? 's' : ''}`, urgent: false };
}
```

- [ ] **Step 4: Vérifier que les tests passent, commit**

```bash
cd "<ROOT>/frontend" && npx jest __tests__/clubhouse.test.ts
```
Attendu : PASS.

```bash
cd "<ROOT>" && git add frontend/lib/clubhouse.ts frontend/__tests__/clubhouse.test.ts && git commit -m "feat(club-house): helpers creneaux du jour, prochains tournois, libelle places"
```

---

### Task 5: Composant `PartnerOffers` (code copiable)

**Files:**
- Create: `frontend/components/clubhouse/PartnerOffers.tsx`
- Test: `frontend/__tests__/PartnerOffers.test.tsx` (créer)

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `frontend/__tests__/PartnerOffers.test.tsx` :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { PartnerOffers } from '../components/clubhouse/PartnerOffers';
import { ThemeProvider } from '../lib/ThemeProvider';
import { Sponsor } from '../lib/api';

const sponsor = (over: Partial<Sponsor>): Sponsor => ({
  id: 's1', name: 'Babolat', logoUrl: 'https://x/logo.png', linkUrl: null,
  sortOrder: 0, isActive: true, createdAt: '', offerText: null, offerCode: null, ...over,
});
const wrap = (sponsors: Sponsor[]) =>
  render(<ThemeProvider><PartnerOffers sponsors={sponsors} /></ThemeProvider>);

describe('PartnerOffers', () => {
  it('ne rend rien sans sponsors', () => {
    wrap([]);
    expect(screen.queryByText('Offres partenaires')).not.toBeInTheDocument();
  });

  it('affiche le texte d offre et copie le code dans le presse-papier', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    wrap([sponsor({ offerText: '−10 % raquettes', offerCode: 'TPC10' })]);
    expect(screen.getByText('−10 % raquettes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /TPC10/ }));
    expect(writeText).toHaveBeenCalledWith('TPC10');
    expect(await screen.findByText('Copié !')).toBeInTheDocument();
  });

  it('sponsor sans offre → logo seul (pas de code)', () => {
    wrap([sponsor({})]);
    const img = screen.getByAltText('Babolat');
    expect(img).toBeInTheDocument();
    expect(screen.queryByText('Copié !')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

```bash
cd "<ROOT>/frontend" && npx jest __tests__/PartnerOffers.test.tsx
```
Attendu : FAIL (« Cannot find module …/PartnerOffers »).

- [ ] **Step 3: Implémenter**

Créer `frontend/components/clubhouse/PartnerOffers.tsx` :

```tsx
'use client';
import { useState } from 'react';
import { Sponsor } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';

// Offres partenaires : logo + texte d'offre + code promo copiable.
// Sponsor sans offre → logo seul (comportement historique).
export function PartnerOffers({ sponsors }: { sponsors: Sponsor[] }) {
  const { th } = useTheme();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  if (sponsors.length === 0) return null;

  const copy = async (s: Sponsor) => {
    try {
      await navigator.clipboard.writeText(s.offerCode!);
      setCopiedId(s.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { /* repli silencieux : le code reste lisible dans le bouton */ }
  };

  const logo = (s: Sponsor) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={s.logoUrl} alt={s.name} style={{ height: 38, width: 'auto', maxWidth: 110, borderRadius: 8, background: th.surface2, padding: 5, objectFit: 'contain', flexShrink: 0 }} />
  );

  return (
    <div style={{ padding: '26px 20px 0' }}>
      <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 12 }}>Offres partenaires</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sponsors.map((s) => s.offerText ? (
          <div key={s.id} style={{ background: th.surface, borderRadius: 14, padding: '11px 14px', boxShadow: `inset 0 0 0 1px ${th.line}`, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {s.linkUrl ? <a href={s.linkUrl} target="_blank" rel="noreferrer">{logo(s)}</a> : logo(s)}
            <span style={{ flex: 1, minWidth: 140, fontFamily: th.fontUI, fontSize: 14, color: th.text }}>{s.offerText}</span>
            {s.offerCode && (
              <button onClick={() => copy(s)} title="Copier le code"
                style={{ cursor: 'pointer', border: `1px dashed ${th.lineStrong}`, background: th.surface2, color: th.text, borderRadius: 9, padding: '7px 12px', fontFamily: th.fontMono, fontSize: 13, fontWeight: 600, letterSpacing: 0.8 }}>
                {copiedId === s.id ? 'Copié !' : s.offerCode}
              </button>
            )}
          </div>
        ) : (
          <div key={s.id} style={{ display: 'inline-flex' }}>
            {s.linkUrl ? <a href={s.linkUrl} target="_blank" rel="noreferrer" title={s.name}>{logo(s)}</a> : logo(s)}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Vérifier que les tests passent, commit**

```bash
cd "<ROOT>/frontend" && npx jest __tests__/PartnerOffers.test.tsx
```
Attendu : PASS (3 tests).

```bash
cd "<ROOT>" && git add frontend/components/clubhouse/PartnerOffers.tsx frontend/__tests__/PartnerOffers.test.tsx && git commit -m "feat(club-house): offres partenaires avec code promo copiable"
```

---

### Task 6: Composant `HeroAnnouncement`

**Files:**
- Create: `frontend/components/clubhouse/HeroAnnouncement.tsx`
- Test: `frontend/__tests__/HeroAnnouncement.test.tsx` (créer)

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `frontend/__tests__/HeroAnnouncement.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import { HeroAnnouncement } from '../components/clubhouse/HeroAnnouncement';
import { ThemeProvider } from '../lib/ThemeProvider';
import { Announcement } from '../lib/api';

const ann = (over: Partial<Announcement>): Announcement => ({
  id: 'a1', title: 'Tournoi interne samedi', body: 'Lots à gagner !', linkUrl: null,
  imageUrl: null, isPublished: true, pinned: true, createdAt: '', updatedAt: '', ...over,
});
const wrap = (a: Announcement) =>
  render(<ThemeProvider><HeroAnnouncement announcement={a} /></ThemeProvider>);

describe('HeroAnnouncement', () => {
  it('affiche le kicker « À la une », le titre et le corps', () => {
    wrap(ann({}));
    expect(screen.getByText('À la une')).toBeInTheDocument();
    expect(screen.getByText('Tournoi interne samedi')).toBeInTheDocument();
    expect(screen.getByText('Lots à gagner !')).toBeInTheDocument();
  });

  it('affiche le CTA seulement si linkUrl est présent', () => {
    const { unmount } = wrap(ann({ linkUrl: 'https://club.fr/tournoi' }));
    expect(screen.getByRole('link', { name: /En savoir plus/ })).toHaveAttribute('href', 'https://club.fr/tournoi');
    unmount();
    wrap(ann({}));
    expect(screen.queryByRole('link', { name: /En savoir plus/ })).not.toBeInTheDocument();
  });

  it('utilise imageUrl en fond quand présent', () => {
    wrap(ann({ imageUrl: 'https://x/photo.jpg' }));
    const hero = screen.getByTestId('hero-announcement');
    expect(hero.style.background).toContain('photo.jpg');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

```bash
cd "<ROOT>/frontend" && npx jest __tests__/HeroAnnouncement.test.tsx
```
Attendu : FAIL (module introuvable).

- [ ] **Step 3: Implémenter**

Créer `frontend/components/clubhouse/HeroAnnouncement.tsx` :

```tsx
'use client';
import { Announcement } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';

// Bandeau « À la une » : l'annonce épinglée mise en scène.
// Fond = imageUrl (voile sombre pour la lisibilité) sinon dégradé du thème.
export function HeroAnnouncement({ announcement }: { announcement: Announcement }) {
  const { th } = useTheme();
  const background = announcement.imageUrl
    ? `linear-gradient(rgba(18, 22, 30, 0.55), rgba(18, 22, 30, 0.55)), url(${announcement.imageUrl}) center / cover no-repeat`
    : `linear-gradient(115deg, ${th.accent}, ${th.accentWarm})`;

  return (
    <div style={{ padding: '16px 20px 0' }}>
      <div data-testid="hero-announcement" style={{ background, borderRadius: 18, padding: '26px 22px', color: '#fff' }}>
        <div style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', opacity: 0.8 }}>À la une</div>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, letterSpacing: -0.4, marginTop: 6 }}>{announcement.title}</div>
        <p style={{ fontFamily: th.fontUI, fontSize: 14.5, opacity: 0.92, lineHeight: 1.5, margin: '8px 0 0', maxWidth: 480, whiteSpace: 'pre-wrap' }}>{announcement.body}</p>
        {announcement.linkUrl && (
          <a href={announcement.linkUrl} target="_blank" rel="noreferrer"
            style={{ display: 'inline-block', marginTop: 14, background: '#fff', color: '#1d2733', borderRadius: 10, padding: '9px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, textDecoration: 'none' }}>
            En savoir plus →
          </a>
        )}
      </div>
    </div>
  );
}
```

Note : si `th.accentWarm` n'existe pas dans le thème (vérifier `frontend/lib/ThemeProvider.tsx`), remplacer le dégradé par `linear-gradient(115deg, ${th.accent}, ${th.accent})`.

- [ ] **Step 4: Vérifier que les tests passent, commit**

```bash
cd "<ROOT>/frontend" && npx jest __tests__/HeroAnnouncement.test.tsx
```
Attendu : PASS (3 tests).

```bash
cd "<ROOT>" && git add frontend/components/clubhouse/HeroAnnouncement.tsx frontend/__tests__/HeroAnnouncement.test.tsx && git commit -m "feat(club-house): bandeau A la une (annonce epinglee, image en fond)"
```

---

### Task 7: Composants `SlotsAlaUne` et `TournamentsAlaUne`

**Files:**
- Create: `frontend/components/clubhouse/SlotsAlaUne.tsx`
- Create: `frontend/components/clubhouse/TournamentsAlaUne.tsx`
- Test: `frontend/__tests__/SlotsAlaUne.test.tsx`, `frontend/__tests__/TournamentsAlaUne.test.tsx` (créer)

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `frontend/__tests__/SlotsAlaUne.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import { SlotsAlaUne } from '../components/clubhouse/SlotsAlaUne';
import { ThemeProvider } from '../lib/ThemeProvider';
import { UpcomingSlot } from '../lib/clubhouse';

const s: UpcomingSlot = {
  resourceId: 'court-1', resourceName: 'Terrain 1',
  slot: { startTime: '2026-06-10T17:00:00.000Z', endTime: '2026-06-10T18:00:00.000Z', available: true, pricePerHour: '25', offPeak: false },
};
const wrap = (slots: UpcomingSlot[]) =>
  render(<ThemeProvider><SlotsAlaUne slots={slots} timezone="Europe/Paris" /></ThemeProvider>);

describe('SlotsAlaUne', () => {
  it('ne rend rien sans créneaux', () => {
    wrap([]);
    expect(screen.queryByText(/À saisir/)).not.toBeInTheDocument();
  });

  it('affiche terrain, heure (fuseau club), prix et lien profond de réservation', () => {
    wrap([s]);
    expect(screen.getByText(/À saisir aujourd/)).toBeInTheDocument();
    expect(screen.getByText('Terrain 1')).toBeInTheDocument();
    expect(screen.getByText(/19h00/)).toBeInTheDocument(); // 17h UTC = 19h Paris
    expect(screen.getAllByText(/25/).length).toBeGreaterThan(0); // prix affiche (span imbrique : getAllByText)
    const link = screen.getByRole('link', { name: 'Réserver' });
    expect(link.getAttribute('href')).toBe('/reserver?resource=court-1&start=2026-06-10T17%3A00%3A00.000Z');
  });
});
```

Créer `frontend/__tests__/TournamentsAlaUne.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import { TournamentsAlaUne } from '../components/clubhouse/TournamentsAlaUne';
import { ThemeProvider } from '../lib/ThemeProvider';
import { Tournament } from '../lib/api';

const t = (over: Partial<Tournament>): Tournament => ({
  id: 't1', clubId: 'c1', clubSportId: 'cs1', name: 'P100 Messieurs', category: 'P100',
  gender: 'MEN', description: null, startTime: '2026-06-21T08:00:00.000Z', endTime: null,
  registrationDeadline: '2026-06-19T22:00:00.000Z', maxTeams: 16, entryFee: '30',
  status: 'PUBLISHED', confirmedCount: 13, waitlistCount: 0, ...over,
} as Tournament);
const wrap = (ts: Tournament[]) =>
  render(<ThemeProvider><TournamentsAlaUne tournaments={ts} timezone="Europe/Paris" /></ThemeProvider>);

describe('TournamentsAlaUne', () => {
  it('ne rend rien sans tournois', () => {
    wrap([]);
    expect(screen.queryByText('Prochains tournois')).not.toBeInTheDocument();
  });

  it('affiche nom, urgence des places et lien vers la page du tournoi', () => {
    wrap([t({})]);
    expect(screen.getByText('Prochains tournois')).toBeInTheDocument();
    expect(screen.getByText('P100 Messieurs')).toBeInTheDocument();
    expect(screen.getByText('Plus que 3 places')).toBeInTheDocument();
    expect(screen.getByText('P100 Messieurs').closest('a')).toHaveAttribute('href', '/tournois/t1');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

```bash
cd "<ROOT>/frontend" && npx jest __tests__/SlotsAlaUne.test.tsx __tests__/TournamentsAlaUne.test.tsx
```
Attendu : FAIL (modules introuvables).

- [ ] **Step 3: Implémenter `SlotsAlaUne`**

Créer `frontend/components/clubhouse/SlotsAlaUne.tsx` :

```tsx
'use client';
import Link from 'next/link';
import { UpcomingSlot } from '@/lib/clubhouse';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';

function formatHour(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}

// « À saisir aujourd'hui » : les prochains créneaux libres du jour, lien profond vers la réservation.
export function SlotsAlaUne({ slots, timezone }: { slots: UpcomingSlot[]; timezone: string }) {
  const { th } = useTheme();
  if (slots.length === 0) return null;
  return (
    <div style={{ background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 12.5, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="bolt" size={14} color={th.accentWarm} />À saisir aujourd&apos;hui
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {slots.map((s) => (
          <div key={`${s.resourceId}-${s.slot.startTime}`} style={{ background: th.surface2, borderRadius: 10, padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
              <strong>{s.resourceName}</strong> · {formatHour(s.slot.startTime, timezone)}
              <span style={{ color: th.textMute, fontSize: 12.5 }}> · {Number(s.slot.pricePerHour)} €/h</span>
            </span>
            <Link href={`/reserver?resource=${s.resourceId}&start=${encodeURIComponent(s.slot.startTime)}`}
              style={{ background: th.accent, color: th.onAccent, borderRadius: 9, padding: '6px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
              Réserver
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implémenter `TournamentsAlaUne`**

Créer `frontend/components/clubhouse/TournamentsAlaUne.tsx` :

```tsx
'use client';
import Link from 'next/link';
import { Tournament } from '@/lib/api';
import { tournamentPlacesLabel } from '@/lib/clubhouse';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';

function formatDay(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
}

// « Prochains tournois » : nom, date, urgence des places, lien vers l'inscription.
export function TournamentsAlaUne({ tournaments, timezone }: { tournaments: Tournament[]; timezone: string }) {
  const { th } = useTheme();
  if (tournaments.length === 0) return null;
  return (
    <div style={{ background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 12.5, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="trophy" size={14} color={th.textMute} />Prochains tournois
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {tournaments.map((t) => {
          const places = tournamentPlacesLabel(t);
          return (
            <Link key={t.id} href={`/tournois/${t.id}`} style={{ textDecoration: 'none', background: th.surface2, borderRadius: 10, padding: '9px 12px', display: 'block' }}>
              <span style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, color: th.text }}>{t.name}</span>
              <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 2 }}>
                {formatDay(t.startTime, timezone)}
                {' · '}
                <span style={{ color: places.urgent ? '#d96a3f' : th.textMute, fontWeight: places.urgent ? 700 : 400 }}>{places.text}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Vérifier que les tests passent, commit**

```bash
cd "<ROOT>/frontend" && npx jest __tests__/SlotsAlaUne.test.tsx __tests__/TournamentsAlaUne.test.tsx
```
Attendu : PASS (4 tests).

```bash
cd "<ROOT>" && git add frontend/components/clubhouse/SlotsAlaUne.tsx frontend/components/clubhouse/TournamentsAlaUne.tsx frontend/__tests__/SlotsAlaUne.test.tsx frontend/__tests__/TournamentsAlaUne.test.tsx && git commit -m "feat(club-house): blocs creneaux a saisir + prochains tournois"
```

---

### Task 8: Orchestrateur `ClubHouse` + routes

**Files:**
- Create: `frontend/components/ClubHouse.tsx`
- Create: `frontend/app/club-house/page.tsx`
- Modify: `frontend/app/infos/page.tsx` (remplacer par une redirection)
- Delete: `frontend/components/ClubInfo.tsx`
- Test: `frontend/__tests__/ClubHouse.test.tsx`, `frontend/__tests__/InfosRedirect.test.tsx` (créer)

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `frontend/__tests__/ClubHouse.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import { ClubHouse } from '../components/ClubHouse';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/api', () => ({
  api: {
    getClubAnnouncements: jest.fn().mockResolvedValue([]),
    getClubSponsors: jest.fn().mockResolvedValue([]),
    getClubTournaments: jest.fn().mockResolvedValue([]),
    getClubAvailability: jest.fn().mockResolvedValue([]),
    getMyReservations: jest.fn().mockResolvedValue([]),
    cancelReservation: jest.fn(),
  },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const club = {
  id: 'c1', slug: 'demo', name: 'Club Démo', timezone: 'Europe/Paris',
  clubSports: [{ id: 'cs1', durationsMin: [90], sport: { defaultDurationsMin: [90] }, resources: [] }],
} as never;
const wrap = () => render(<ThemeProvider><ClubHouse club={club} /></ThemeProvider>);

const pinned = { id: 'a1', title: 'Tournoi interne', body: 'Lots !', linkUrl: null, imageUrl: null, isPublished: true, pinned: true, createdAt: '2026-06-09', updatedAt: '' };
const regular = { id: 'a2', title: 'Créneaux du matin', body: 'Dès 8h.', linkUrl: null, imageUrl: null, isPublished: true, pinned: false, createdAt: '2026-06-08', updatedAt: '' };

describe('ClubHouse', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.getClubAnnouncements.mockResolvedValue([]);
    mocked.getClubSponsors.mockResolvedValue([]);
    mocked.getClubTournaments.mockResolvedValue([]);
    mocked.getClubAvailability.mockResolvedValue([]);
  });

  it('annonce épinglée → hero « À la une », sans doublon dans la liste', async () => {
    mocked.getClubAnnouncements.mockResolvedValue([pinned, regular] as never);
    wrap();
    expect(await screen.findByText('À la une')).toBeInTheDocument();
    expect(screen.getAllByText('Tournoi interne')).toHaveLength(1);
    expect(screen.getByText('Créneaux du matin')).toBeInTheDocument();
  });

  it('pas d annonce épinglée → pas de hero, annonces en liste', async () => {
    mocked.getClubAnnouncements.mockResolvedValue([regular] as never);
    wrap();
    expect(await screen.findByText('Créneaux du matin')).toBeInTheDocument();
    expect(screen.queryByText('À la une')).not.toBeInTheDocument();
  });

  it('créneau libre à venir → bloc « À saisir » avec lien profond', async () => {
    const future = new Date(Date.now() + 2 * 3600e3).toISOString();
    mocked.getClubAvailability.mockResolvedValue([{
      resource: { id: 'court-1', name: 'Terrain 1' },
      slots: [{ startTime: future, endTime: future, available: true, pricePerHour: '25', offPeak: false }],
    }] as never);
    wrap();
    expect(await screen.findByText(/À saisir aujourd/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Réserver' }).getAttribute('href')).toContain('resource=court-1');
  });

  it('aucune dispo → bloc « À saisir » masqué', async () => {
    mocked.getClubAnnouncements.mockResolvedValue([regular] as never);
    wrap();
    await screen.findByText('Créneaux du matin');
    expect(screen.queryByText(/À saisir aujourd/)).not.toBeInTheDocument();
  });

  it('tournoi publié à venir → bloc « Prochains tournois »', async () => {
    mocked.getClubTournaments.mockResolvedValue([{
      id: 't1', name: 'P100 Messieurs', category: 'P100', startTime: new Date(Date.now() + 7 * 86400e3).toISOString(),
      status: 'PUBLISHED', maxTeams: 16, confirmedCount: 14, waitlistCount: 0,
    }] as never);
    wrap();
    expect(await screen.findByText('P100 Messieurs')).toBeInTheDocument();
    expect(screen.getByText('Plus que 2 places')).toBeInTheDocument();
  });
});
```

Créer `frontend/__tests__/InfosRedirect.test.tsx` :

```tsx
import { render } from '@testing-library/react';
import InfosPage from '../app/infos/page';

const replace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

it('/infos redirige vers /club-house', () => {
  render(<InfosPage />);
  expect(replace).toHaveBeenCalledWith('/club-house');
});
```

- [ ] **Step 2: Vérifier l'échec**

```bash
cd "<ROOT>/frontend" && npx jest __tests__/ClubHouse.test.tsx __tests__/InfosRedirect.test.tsx
```
Attendu : FAIL (`ClubHouse` introuvable ; `/infos` ne redirige pas).

- [ ] **Step 3: Implémenter `ClubHouse.tsx`**

Créer `frontend/components/ClubHouse.tsx`. Il reprend de `ClubInfo.tsx` (avant suppression) : les sections « Vos prochaines réservations » (avec `ConfirmDialog` d'annulation) et « Annonces », à l'identique. Structure complète :

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ClubDetail, Announcement, Sponsor, MyReservation, Tournament, ClubAvailability } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { effectiveDurations, defaultDuration } from '@/lib/duration';
import { pickUpcomingSlots, pickUpcomingTournaments, todayISO } from '@/lib/clubhouse';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Chip } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { HeroAnnouncement } from '@/components/clubhouse/HeroAnnouncement';
import { SlotsAlaUne } from '@/components/clubhouse/SlotsAlaUne';
import { TournamentsAlaUne } from '@/components/clubhouse/TournamentsAlaUne';
import { PartnerOffers } from '@/components/clubhouse/PartnerOffers';

function formatDateTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}

// Page « Club-house » : hero À la une, créneaux à saisir, prochains tournois,
// vos réservations, annonces, offres partenaires. Chaque bloc charge en
// indépendance et se masque en silence si vide ou en erreur.
export function ClubHouse({ club }: { club: ClubDetail }) {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const [ann, setAnn] = useState<Announcement[]>([]);
  const [spons, setSpons] = useState<Sponsor[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [avail, setAvail] = useState<ClubAvailability[]>([]);
  const [next, setNext] = useState<MyReservation[]>([]);
  const [confirmCancel, setConfirmCancel] = useState<MyReservation | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const duration = defaultDuration(Array.from(new Set(
    club.clubSports.flatMap((cs) => effectiveDurations(cs.durationsMin, cs.sport.defaultDurationsMin)),
  )).sort((a, b) => a - b));

  const loadNext = useCallback(async () => {
    if (!token) return;
    try {
      const rs = await api.getMyReservations(token);
      setNext(rs.filter((r) => r.resource.club.slug === club.slug && r.status !== 'CANCELLED' && new Date(r.startTime) > new Date()).slice(0, 3));
    } catch { /* silencieux */ }
  }, [token, club.slug]);

  useEffect(() => { api.getClubAnnouncements(club.slug).then(setAnn).catch(() => setAnn([])); }, [club.slug]);
  useEffect(() => { api.getClubSponsors(club.slug).then(setSpons).catch(() => setSpons([])); }, [club.slug]);
  useEffect(() => { api.getClubTournaments(club.slug).then(setTournaments).catch(() => setTournaments([])); }, [club.slug]);
  useEffect(() => { api.getClubAvailability(club.slug, todayISO(), duration).then(setAvail).catch(() => setAvail([])); }, [club.slug, duration]);
  useEffect(() => { if (ready && token) loadNext(); }, [ready, token, loadNext]);

  const cancel = async (r: MyReservation) => {
    if (!token) return;
    setCancelling(true);
    try { await api.cancelReservation(r.id, token); setConfirmCancel(null); await loadNext(); }
    catch { /* l'erreur reste affichée dans le dialog via busy off */ }
    finally { setCancelling(false); }
  };

  const sectionTitle = (t: string) => (
    <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 12 }}>{t}</div>
  );

  // Hero : l'annonce épinglée la plus récente (l'API renvoie épinglées d'abord) ; pas répétée dans la liste.
  const hero = ann.length > 0 && ann[0].pinned ? ann[0] : null;
  const restAnn = hero ? ann.slice(1) : ann;
  const now = new Date();
  const slots = pickUpcomingSlots(avail, now);
  const nextTournaments = pickUpcomingTournaments(tournaments, now);

  const empty = !hero && slots.length === 0 && nextTournaments.length === 0 && restAnn.length === 0 && spons.length === 0 && next.length === 0;

  return (
    <>
      {hero && <HeroAnnouncement announcement={hero} />}

      {/* Grille action : créneaux + tournois, côte à côte ≥ 600px */}
      {(slots.length > 0 || nextTournaments.length > 0) && (
        <div style={{ padding: '16px 20px 0' }}>
          <style>{`.ch-grid{display:grid;grid-template-columns:1fr;gap:12px}@media(min-width:600px){.ch-grid{grid-template-columns:1fr 1fr}}`}</style>
          <div className="ch-grid">
            <SlotsAlaUne slots={slots} timezone={club.timezone} />
            <TournamentsAlaUne tournaments={nextTournaments} timezone={club.timezone} />
          </div>
        </div>
      )}

      {/* Vos prochaines réservations (repris de ClubInfo) */}
      {next.length > 0 && (
        <div style={{ padding: '22px 20px 0' }}>
          {sectionTitle('Vos prochaines réservations')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {next.map((r) => (
              <button key={r.id} onClick={() => setConfirmCancel(r)} style={{ border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%', background: th.surface, borderRadius: 14, padding: '12px 14px', boxShadow: `inset 0 0 0 1px ${th.line}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name="ticket" size={18} color={th.accent} />
                <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14, color: th.text }}>{r.resource.name} · {formatDateTime(r.startTime, r.resource.club.timezone)}</span>
                <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute }}>Gérer</span>
                <Icon name="arrowR" size={15} color={th.textMute} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Annonces (repris de ClubInfo, sans celle du hero) */}
      {restAnn.length > 0 && (
        <div style={{ padding: '26px 20px 0' }}>
          {sectionTitle('Annonces')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {restAnn.map((a) => (
              <div key={a.id} style={{ background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {a.pinned && <Chip tone="accent">Épinglé</Chip>}
                  <span style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, color: th.text }}>{a.title}</span>
                </div>
                <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, marginTop: 8, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{a.body}</p>
                {a.linkUrl && <a href={a.linkUrl} target="_blank" rel="noreferrer" style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, color: th.accent }}>En savoir plus →</a>}
              </div>
            ))}
          </div>
        </div>
      )}

      <PartnerOffers sponsors={spons} />

      {empty && (
        <div style={{ padding: '40px 20px', textAlign: 'center', fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>
          Pas d&apos;informations pour le moment.
        </div>
      )}

      {confirmCancel && (
        <ConfirmDialog
          title="Annuler la réservation ?"
          detail={<>{confirmCancel.resource.name} · {formatDateTime(confirmCancel.startTime, confirmCancel.resource.club.timezone)}</>}
          message="Cette action est définitive : le créneau sera remis à disposition des autres joueurs."
          confirmLabel="Annuler la réservation"
          cancelLabel="Retour"
          busy={cancelling}
          onConfirm={() => cancel(confirmCancel)}
          onCancel={() => setConfirmCancel(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 4: Créer la route `/club-house` et la redirection `/infos`**

Créer `frontend/app/club-house/page.tsx` (même garde que l'ancien `/infos`) :

```tsx
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Screen } from '@/components/ui/Screen';
import { ClubNav } from '@/components/ClubNav';
import { ClubHouse } from '@/components/ClubHouse';

// Page « Club-house » (à la une, créneaux à saisir, tournois, annonces, offres partenaires).
// Réservée au contexte club : sur l'hôte plateforme (pas de slug) → retour à l'annuaire.
export default function ClubHousePage() {
  const { slug, club, loading } = useClub();
  const { th } = useTheme();
  const router = useRouter();

  useEffect(() => { if (!slug) router.replace('/clubs'); }, [slug, router]);

  if (!slug || loading) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>;
  if (!club) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textMute }}>Club introuvable.</div>;

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        <ClubNav club={club} />
        <ClubHouse club={club} />
      </div>
    </Screen>
  );
}
```

Remplacer **tout le contenu** de `frontend/app/infos/page.tsx` par :

```tsx
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// « Infos » est devenu « Club-house » — redirection pour les liens existants.
export default function InfosRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/club-house'); }, [router]);
  return null;
}
```

Supprimer `frontend/components/ClubInfo.tsx` :

```bash
cd "<ROOT>" && git rm frontend/components/ClubInfo.tsx
```

(Vérifier qu'aucun autre fichier ne l'importe : `grep -rn "ClubInfo" frontend/ --include="*.tsx" --include="*.ts"` — seul l'ancien `/infos` l'utilisait.)

- [ ] **Step 5: Vérifier que les tests passent**

```bash
cd "<ROOT>/frontend" && npx jest __tests__/ClubHouse.test.tsx __tests__/InfosRedirect.test.tsx && npx tsc --noEmit
```
Attendu : PASS (6 tests), compilation OK.

- [ ] **Step 6: Commit**

```bash
cd "<ROOT>" && git add frontend/components/ClubHouse.tsx frontend/app/club-house/page.tsx frontend/app/infos/page.tsx frontend/__tests__/ClubHouse.test.tsx frontend/__tests__/InfosRedirect.test.tsx && git commit -m "feat(club-house): page Club-house (hero, grille action, offres) + redirection /infos"
```

---

### Task 9: ClubNav — onglet « Club-house » + icône maison

**Files:**
- Modify: `frontend/components/ui/Icon.tsx` (type `IconName` + dictionnaire `paths`)
- Modify: `frontend/components/ClubNav.tsx:38`
- Modify: `frontend/__tests__/ClubNav.test.tsx`

- [ ] **Step 1: Mettre à jour le test existant**

Dans `frontend/__tests__/ClubNav.test.tsx`, remplacer le premier test :

```tsx
  it('affiche les onglets Réserver, Tournois et Club-house', () => {
    wrap();
    expect(screen.getByText('Réserver')).toBeInTheDocument();
    expect(screen.getByText('Tournois')).toBeInTheDocument();
    expect(screen.getByText('Club-house')).toBeInTheDocument();
    expect(screen.queryByText('Infos')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Vérifier l'échec**

```bash
cd "<ROOT>/frontend" && npx jest __tests__/ClubNav.test.tsx
```
Attendu : FAIL (« Club-house » introuvable).

- [ ] **Step 3: Implémenter**

Dans `frontend/components/ui/Icon.tsx` :
1. Ajouter `| 'home'` à la fin de l'union `IconName`.
2. Ajouter dans le dictionnaire `paths` (même style que les autres) :
```tsx
    home: <><path d="M3.5 10.5L12 3.5l8.5 7" {...p} /><path d="M5.5 9.5V20.5h13V9.5" {...p} /><path d="M9.5 20.5v-6h5v6" {...p} /></>,
```

Dans `frontend/components/ClubNav.tsx`, remplacer la ligne de l'onglet Infos :
```tsx
    { label: 'Club-house', href: '/club-house', icon: 'home', match: (p) => p.startsWith('/club-house') || p.startsWith('/infos'), show: true },
```

- [ ] **Step 4: Vérifier que les tests passent, commit**

```bash
cd "<ROOT>/frontend" && npx jest __tests__/ClubNav.test.tsx
```
Attendu : PASS.

```bash
cd "<ROOT>" && git add frontend/components/ui/Icon.tsx frontend/components/ClubNav.tsx frontend/__tests__/ClubNav.test.tsx && git commit -m "feat(club-house): onglet Club-house dans la nav (icone maison)"
```

⚠️ Si `ClubNav.tsx` / `ClubNav.test.tsx` contiennent encore des modifications non commitées du chantier tournois, ne commiter que les hunks Club-house (`git add -p`) ou terminer d'abord la branche tournois.

---

### Task 10: ClubReserve — lien profond `?resource=&start=`

**Files:**
- Modify: `frontend/components/ClubReserve.tsx:58-60` (effet des query params) + nouvel effet
- Test: `frontend/__tests__/ClubReserve.deeplink.test.tsx` (créer)

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/__tests__/ClubReserve.deeplink.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import { ClubReserve } from '../components/ClubReserve';
import { ThemeProvider } from '../lib/ThemeProvider';

// Lendemain midi UTC : déterministe (pas de chevauchement de minuit) et dans la fenêtre de résa.
const start = (() => { const d = new Date(Date.now() + 24 * 3600e3); d.setUTCHours(12, 0, 0, 0); return d.toISOString(); })();

jest.mock('next/navigation', () => ({
  usePathname: () => '/reserver',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('../components/BookingModal', () => ({
  __esModule: true,
  default: ({ resourceId }: { resourceId: string }) => <div data-testid="booking-modal">{resourceId}</div>,
}));
jest.mock('../lib/api', () => ({
  api: {
    getMyMemberships: jest.fn().mockResolvedValue([]),
    getClubAvailability: jest.fn(),
  },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const club = {
  id: 'c1', slug: 'demo', name: 'Club Démo', timezone: 'Europe/Paris', description: null,
  memberBookingDays: 7, publicBookingDays: 7,
  clubSports: [{ id: 'cs1', durationsMin: [90], sport: { defaultDurationsMin: [90], name: 'Padel', icon: null }, resources: [] }],
} as never;

const availability = [{
  resource: { id: 'court-1', name: 'Terrain 1', attributes: {}, pricePerHour: '25', offPeakPricePerHour: null, sport: { key: 'padel', name: 'Padel' }, clubSportId: 'cs1' },
  slots: [{ startTime: start, endTime: start, available: true, pricePerHour: '25', offPeak: false }],
}];

describe('ClubReserve — lien profond', () => {
  beforeEach(() => {
    document.cookie = 'token=abc; path=/';
    mocked.getClubAvailability.mockResolvedValue(availability as never);
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  it('?resource=&start= pré-ouvre la confirmation quand le créneau est libre', async () => {
    window.history.pushState({}, '', `/reserver?resource=court-1&start=${encodeURIComponent(start)}`);
    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);
    expect(await screen.findByTestId('booking-modal')).toHaveTextContent('court-1');
  });

  it('créneau pris entre-temps → page normale, sans modale ni erreur', async () => {
    mocked.getClubAvailability.mockResolvedValue([{
      ...availability[0],
      slots: [{ startTime: start, endTime: start, available: false, pricePerHour: '25', offPeak: false }],
    }] as never);
    window.history.pushState({}, '', `/reserver?resource=court-1&start=${encodeURIComponent(start)}`);
    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);
    expect(await screen.findByText('Terrain 1')).toBeInTheDocument();
    expect(screen.queryByTestId('booking-modal')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

```bash
cd "<ROOT>/frontend" && npx jest __tests__/ClubReserve.deeplink.test.tsx
```
Attendu : FAIL (pas de modale pré-ouverte).

- [ ] **Step 3: Implémenter dans `ClubReserve.tsx`**

Ajouter un état sous `const [isSub, setIsSub] = useState(false);` :

```typescript
  // Lien profond depuis le Club-house : ?resource=<id>&start=<ISO> pré-ouvre la confirmation.
  const [deepSlot, setDeepSlot] = useState<{ resourceId: string; start: string } | null>(null);
```

Remplacer l'effet existant des query params (lignes 58-60) par :

```typescript
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('tab') === 'courts') setTab('courts');
    const resource = p.get('resource'); const start = p.get('start');
    if (resource && start && !isNaN(new Date(start).getTime())) {
      setDeepSlot({ resourceId: resource, start });
      setDate(start.slice(0, 10));
    }
  }, []);
```

Ajouter un effet après `useEffect(() => { if (tab === 'book') loadAvail(); }, …)` :

```typescript
  // Consomme le lien profond une fois les dispos chargées : créneau encore libre → pré-ouvre,
  // sinon (pris entre-temps) la page normale s'affiche, sans erreur.
  useEffect(() => {
    if (!deepSlot || loadingA || !token) return;
    const res = avail.find((a) => a.resource.id === deepSlot.resourceId);
    const slot = res?.slots.find((s) => s.startTime === deepSlot.start && s.available);
    if (res && slot) setBooking({ resourceId: res.resource.id, price: slot.pricePerHour, slot });
    setDeepSlot(null);
  }, [deepSlot, loadingA, avail, token]);
```

- [ ] **Step 4: Vérifier que les tests passent, commit**

```bash
cd "<ROOT>/frontend" && npx jest __tests__/ClubReserve.deeplink.test.tsx
```
Attendu : PASS (2 tests).

```bash
cd "<ROOT>" && git add frontend/components/ClubReserve.tsx frontend/__tests__/ClubReserve.deeplink.test.tsx && git commit -m "feat(reservation): lien profond ?resource=&start= pre-ouvre la confirmation"
```

---

### Task 11: Vérification finale + documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Suites complètes**

```bash
cd "<ROOT>/backend" && npm test
cd "<ROOT>/frontend" && npm test && npx tsc --noEmit
```
Attendu : tout vert, zéro erreur TypeScript.

- [ ] **Step 2: Vérification visuelle**

Démarrer backend + frontend (`npm run dev` dans chaque dossier, Docker déjà lancé), ouvrir `http://localhost:3000/club-house` (contexte club) et vérifier : hero si annonce épinglée, créneaux du jour cliquables (la confirmation se pré-ouvre), tournois avec compteur, code promo copiable, `/infos` redirige.

- [ ] **Step 3: Documenter dans CLAUDE.md**

Dans `CLAUDE.md`, après la section « Inscription par email + code (v1) », ajouter :

```markdown
## Club-house (v1) ✅ implémenté

La page « Infos » est devenue **« Club-house »** (`/club-house`, redirection depuis `/infos`) : hero « À la une » (annonce épinglée, `imageUrl` en fond), grille action — créneaux libres du jour (lien profond `/reserver?resource=&start=` qui pré-ouvre la confirmation) + prochains tournois (« Plus que X places ») —, vos réservations, annonces, **offres partenaires** (`Sponsor.offerText`/`offerCode`, migration `add_sponsor_offer`, code promo copiable, saisie dans `/admin/sponsors`). Composants : `ClubHouse.tsx` + `components/clubhouse/*`, helpers purs `lib/clubhouse.ts`. Spec & plan : `docs/superpowers/{specs,plans}/2026-06-10-club-house*`.
```

Et dans la section « À implémenter », ajouter aux évolutions tournois/club :
```markdown
- Club-house — évolutions : cherche-partenaire, pouls du club (SSE), identité visuelle par club (photo de couverture, couleur d'accent)
```

- [ ] **Step 4: Commit final**

```bash
cd "<ROOT>" && git add CLAUDE.md && git commit -m "docs: maj CLAUDE.md (Club-house v1)"
```

---

## Self-review (fait à l'écriture du plan)

- **Couverture spec :** renommage (T9), hero (T6+T8), créneaux (T4+T7+T8), tournois (T4+T7+T8), offres (T1-T3+T5), lien profond (T10), redirection (T8), tests backend+frontend (T1, T4-T10), doc (T11). ✅
- **Types cohérents :** `UpcomingSlot` défini en T4 et consommé en T7/T8 ; `SponsorInput` étendu en T1 cohérent avec `SponsorBody` T2 ; `tournamentPlacesLabel` retourne `{text, urgent}` partout. ✅
- **Point d'attention exécutant :** ne jamais `git add -A` (modifications tournois non commitées dans le working tree) ; `th.accentWarm` à vérifier dans le thème (note en T6).
