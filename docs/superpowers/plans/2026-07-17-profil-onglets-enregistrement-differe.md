# Mon profil — onglets + enregistrement différé — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Porter `/me/profile` sur la mécanique de `/admin/settings` — 5 onglets (`PillTabs` + `?tab=`) et une seule `SaveBar` sticky couvrant profil **et** licence, en supprimant les trois régimes d'enregistrement actuels.

**Architecture:** Double état `server` (baseline) + `draft` (édité) dans la page orchestratrice. `buildProfileBody(draft)` est l'unique source de vérité des champs enregistrés et sert aussi au calcul `isDirty`. La licence est une **seconde ressource** (endpoint distinct) avec sa propre paire baseline/brouillon, couverte par la même barre — exactement le précédent Club/ClubSport du 16/07. Les onglets sont des composants contrôlés ; la page seule fetch.

**Tech Stack:** Next.js 16 (App Router, client component), React 19, TypeScript, Jest + React Testing Library. Aucune migration, aucun endpoint nouveau.

**Spec:** `docs/superpowers/specs/2026-07-17-profil-onglets-enregistrement-differe-design.md`

---

## Contexte indispensable avant de commencer

Lis ces trois fichiers en entier — ce plan est un portage, ils sont la référence :

| Fichier | Pourquoi |
|---|---|
| `frontend/app/admin/settings/page.tsx` | **Le modèle.** Double état, `set`, `dirty`, `save`, `cancel`, `beforeunload`, `syncImage`, deux canaux d'erreur. On le copie. |
| `frontend/lib/adminSettings.ts` | Le modèle des helpers purs (`SETTINGS_TABS`, `parseTab`, `buildUpdateBody`, `isDirty`). |
| `frontend/app/me/profile/page.tsx` | La cible, telle qu'elle est aujourd'hui (621 lignes, 11 sections empilées). |

**Trois pièges déjà payés côté Réglages — ne pas les repayer :**

1. **Tout champ éditable DOIT figurer dans `buildProfileBody`.** Sinon il est silencieusement non-dirty et non-sauvé. C'est le bug `showOtherClubsReservations` côté Réglages.
2. **Ne JAMAIS reposer le brouillon au succès d'un enregistrement.** Seul `server` est mis à jour. Reposer `draft` depuis la réponse écraserait une édition faite pendant que la requête était en vol. Idem pour l'avatar : on patche **un seul champ** (`avatarUrl`), jamais l'objet entier.
3. **Jest ne type-check pas** (`ts-jest` + `isolatedModules`). `tsc --noEmit` est un gate séparé, obligatoire (Task 8).

**Environnement :** les shims `node_modules/.bin` sont cassés sur ce poste. Lance jest via `node node_modules/jest/bin/jest.js` et tsc via `node node_modules/typescript/bin/tsc`, depuis `frontend/`.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| **Create** `frontend/lib/meProfile.ts` | Helpers purs : onglets, `parseProfileTab`, `buildProfileBody`, `isDirty`, `licenceDirty`. Aucune horloge, aucun fetch, aucun JSX. |
| **Create** `frontend/__tests__/meProfile.test.ts` | Tests des helpers purs. |
| **Create** `frontend/components/ui/SaveBar.tsx` | La barre sticky, **déplacée** depuis `components/admin/settings/`. Une page joueur ne doit pas importer un composant d'admin. |
| **Delete** `frontend/components/admin/settings/SaveBar.tsx` | Déplacé ci-dessus. |
| **Modify** `frontend/app/admin/settings/page.tsx:15` | Import de `SaveBar` mis à jour. |
| **Create** `frontend/components/profile/shared.ts` | `SetProfileField`, `ProfileTabProps`, `useProfileStyles()` — miroir de `components/admin/settings/shared.ts`. |
| **Create** `frontend/components/profile/tabs/ProfileIdentity.tsx` | Onglet Identité : photo, lecture seule, tél/naissance/sexe, sport préféré, licence. |
| **Create** `frontend/components/profile/tabs/ProfileLevel.tsx` | Onglet Niveau : badge, courbe, bilan V/D, calibrage. |
| **Create** `frontend/components/profile/tabs/ProfilePreferences.tsx` | Onglet Préférences : langue, classements, propositions, amis, DM. **Sans thème.** |
| **Create** `frontend/components/profile/tabs/ProfileWallet.tsx` | Onglet Portefeuille : soldes, carte, historique. |
| **Create** `frontend/components/profile/tabs/ProfileSecurity.tsx` | Onglet Sécurité : mot de passe (état local propre), suppression de compte. |
| **Rewrite** `frontend/app/me/profile/page.tsx` | Orchestrateur : fetch, brouillons, onglets, `save`/`cancel`, `SaveBar`. |
| **Delete** `frontend/components/profile/ProfileSectionNav.tsx` | Code mort une fois les onglets en place. |
| **Delete** `frontend/__tests__/ProfileSectionNav.test.tsx` | Idem. |
| **Rewrite** `frontend/__tests__/MeProfile.test.tsx` | 24 cas existants à adapter (les sections ne sont plus rendues simultanément). |
| **Modify** `backend/src/email/registry.ts:86` | `manageUrl` → `/me/profile?tab=preferences`. |

---

## Task 1 : Helpers purs

**Files:**
- Create: `frontend/lib/meProfile.ts`
- Test: `frontend/__tests__/meProfile.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Crée `frontend/__tests__/meProfile.test.ts` :

```ts
import { PROFILE_TABS, parseProfileTab, buildProfileBody, isDirty, licenceDirty } from '../lib/meProfile';
import type { MyProfile } from '../lib/api';

const base: MyProfile = {
  id: 'u1', email: 'eric@palova.fr', firstName: 'Eric', lastName: 'Nougayrede',
  phone: '0609032635', sex: 'MALE', birthDate: '1973-07-08T00:00:00.000Z',
  avatarUrl: null, locale: 'fr', isSuperAdmin: false,
  showInLeaderboard: false, autoMatchProposals: false,
  acceptsFriendRequests: true, acceptsDirectMessages: true,
  preferredSport: { id: 'sport-padel', key: 'padel', name: 'Padel' },
};

describe('meProfile helpers', () => {
  it('expose 5 onglets dans l’ordre', () => {
    expect(PROFILE_TABS.map((t) => t.key)).toEqual(['identite', 'niveau', 'preferences', 'portefeuille', 'securite']);
  });

  it('parseProfileTab lit ?tab= et retombe sur identite', () => {
    expect(parseProfileTab('?tab=preferences')).toBe('preferences');
    expect(parseProfileTab('?tab=securite')).toBe('securite');
    expect(parseProfileTab('')).toBe('identite');
    expect(parseProfileTab('?tab=nimportequoi')).toBe('identite');
  });

  it('buildProfileBody expose les 9 champs enregistrés', () => {
    expect(Object.keys(buildProfileBody(base)).sort()).toEqual([
      'acceptsDirectMessages', 'acceptsFriendRequests', 'autoMatchProposals',
      'birthDate', 'locale', 'phone', 'preferredSportId', 'sex', 'showInLeaderboard',
    ]);
  });

  it('buildProfileBody dérive preferredSportId de l’objet preferredSport', () => {
    expect(buildProfileBody(base).preferredSportId).toBe('sport-padel');
    expect(buildProfileBody({ ...base, preferredSport: null }).preferredSportId).toBeNull();
  });

  it('buildProfileBody normalise birthDate ISO en YYYY-MM-DD et vide → null', () => {
    expect(buildProfileBody(base).birthDate).toBe('1973-07-08');
    expect(buildProfileBody({ ...base, birthDate: null }).birthDate).toBeNull();
  });

  it('buildProfileBody trim le téléphone, vide → null', () => {
    expect(buildProfileBody({ ...base, phone: '  06 09  ' }).phone).toBe('06 09');
    expect(buildProfileBody({ ...base, phone: '   ' }).phone).toBeNull();
  });

  it('isDirty est faux à l’identique et vrai après chaque champ enregistré', () => {
    expect(isDirty(base, { ...base })).toBe(false);
    expect(isDirty(base, { ...base, phone: '0700000000' })).toBe(true);
    expect(isDirty(base, { ...base, sex: 'FEMALE' })).toBe(true);
    expect(isDirty(base, { ...base, locale: 'es' })).toBe(true);
    expect(isDirty(base, { ...base, showInLeaderboard: true })).toBe(true);
    expect(isDirty(base, { ...base, autoMatchProposals: true })).toBe(true);
    expect(isDirty(base, { ...base, acceptsFriendRequests: false })).toBe(true);
    expect(isDirty(base, { ...base, acceptsDirectMessages: false })).toBe(true);
    expect(isDirty(base, { ...base, preferredSport: null })).toBe(true);
    expect(isDirty(base, { ...base, birthDate: '1980-01-01' })).toBe(true);
  });

  it('isDirty ignore les champs NON enregistrés (avatar)', () => {
    expect(isDirty(base, { ...base, avatarUrl: '/uploads/avatars/u1-2.png' })).toBe(false);
  });

  it('isDirty est insensible à un retour serveur en ISO complet (régression normalisation)', () => {
    // Le serveur renvoie l'ISO complet, le formulaire manipule YYYY-MM-DD :
    // sans normalisation dans buildProfileBody, la page serait dirty au chargement.
    expect(isDirty(base, { ...base, birthDate: '1973-07-08' })).toBe(false);
  });

  it('licenceDirty compare en ignorant les espaces de bord', () => {
    expect(licenceDirty('LIC42', 'LIC42')).toBe(false);
    expect(licenceDirty('LIC42', '  LIC42  ')).toBe(false);
    expect(licenceDirty('LIC42', 'LIC99')).toBe(true);
    expect(licenceDirty('', 'LIC1')).toBe(true);
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

```bash
cd frontend && node node_modules/jest/bin/jest.js __tests__/meProfile.test.ts
```

Attendu : FAIL — `Cannot find module '../lib/meProfile'`.

- [ ] **Step 3 : Écrire l'implémentation minimale**

Crée `frontend/lib/meProfile.ts` :

```ts
// Helpers PURS de la page Mon profil. Aucune horloge, aucun fetch, aucun JSX.
// Miroir de lib/adminSettings.ts (Réglages du club) — même mécanique baseline/brouillon.
import type { MyProfile, Sex } from '@/lib/api';

export type ProfileTabKey = 'identite' | 'niveau' | 'preferences' | 'portefeuille' | 'securite';

export const PROFILE_TABS: { key: ProfileTabKey; label: string }[] = [
  { key: 'identite',     label: 'Identité' },
  { key: 'niveau',       label: 'Niveau' },
  { key: 'preferences',  label: 'Préférences' },
  { key: 'portefeuille', label: 'Portefeuille' },
  { key: 'securite',     label: 'Sécurité' },
];

/** Lit `?tab=` d'une query string ; défaut et valeur inconnue → 'identite'. */
export function parseProfileTab(search: string): ProfileTabKey {
  const raw = new URLSearchParams(search).get('tab');
  return PROFILE_TABS.some((t) => t.key === raw) ? (raw as ProfileTabKey) : 'identite';
}

/** Corps du PATCH /api/me. Assignable au paramètre de `api.updateMyProfile` (champs optionnels). */
export interface UpdateProfileBody {
  phone: string | null;
  sex: Sex | null;
  birthDate: string | null;
  preferredSportId: string | null;
  locale: string | null;
  showInLeaderboard: boolean;
  autoMatchProposals: boolean;
  acceptsFriendRequests: boolean;
  acceptsDirectMessages: boolean;
}

/**
 * UNIQUE source de vérité des champs enregistrés — sert aussi au calcul isDirty.
 * ⚠️ Tout champ éditable d'un onglet DOIT figurer ici, sinon il est silencieusement
 * non-dirty et non-sauvé (piège documenté côté Réglages : showOtherClubsReservations).
 *
 * Deux normalisations, parce que la forme de LECTURE diffère de la forme d'ÉCRITURE :
 *  - preferredSport est un objet en lecture, un id en écriture ;
 *  - birthDate est un ISO complet en lecture, un YYYY-MM-DD dans le formulaire.
 * Les deux côtés passant par ce builder, un retour serveur en ISO ne rend jamais dirty.
 */
export function buildProfileBody(p: MyProfile): UpdateProfileBody {
  return {
    phone: p.phone?.trim() || null,
    sex: p.sex,
    birthDate: p.birthDate ? p.birthDate.slice(0, 10) : null,
    preferredSportId: p.preferredSport?.id ?? null,
    locale: p.locale ?? 'fr',
    showInLeaderboard: p.showInLeaderboard,
    autoMatchProposals: p.autoMatchProposals,
    acceptsFriendRequests: p.acceptsFriendRequests,
    acceptsDirectMessages: p.acceptsDirectMessages,
  };
}

/** Vrai si le brouillon diffère de la baseline sur un champ enregistré. */
export function isDirty(server: MyProfile, draft: MyProfile): boolean {
  return JSON.stringify(buildProfileBody(server)) !== JSON.stringify(buildProfileBody(draft));
}

/** Licence = seconde ressource (endpoint distinct). Comparaison trim, comme l'envoi. */
export function licenceDirty(server: string, draft: string): boolean {
  return server.trim() !== draft.trim();
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

```bash
cd frontend && node node_modules/jest/bin/jest.js __tests__/meProfile.test.ts
```

Attendu : PASS, 10 tests.

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/meProfile.ts frontend/__tests__/meProfile.test.ts
git commit -m "feat(profil): helpers purs onglets + brouillon (buildProfileBody, isDirty)"
```

---

## Task 2 : Déplacer la SaveBar dans components/ui

Purement mécanique, **aucun changement de comportement**. La suite `AdminSettings` verte est la preuve.

**Files:**
- Create: `frontend/components/ui/SaveBar.tsx`
- Delete: `frontend/components/admin/settings/SaveBar.tsx`
- Modify: `frontend/app/admin/settings/page.tsx:15`

- [ ] **Step 1 : Déplacer le fichier**

```bash
cd frontend && git mv components/admin/settings/SaveBar.tsx components/ui/SaveBar.tsx
```

Le contenu ne change pas d'une ligne (le composant n'importe que `useTheme`, pas de dépendance admin).

- [ ] **Step 2 : Mettre à jour l'import côté Réglages**

Dans `frontend/app/admin/settings/page.tsx`, remplace la ligne 15 :

```tsx
import { SaveBar } from '@/components/admin/settings/SaveBar';
```

par :

```tsx
import { SaveBar } from '@/components/ui/SaveBar';
```

- [ ] **Step 3 : Vérifier qu'aucun autre import ne pointe vers l'ancien chemin**

```bash
cd frontend && grep -rn "admin/settings/SaveBar" --include=*.tsx --include=*.ts .
```

Attendu : aucune sortie.

- [ ] **Step 4 : Lancer la suite Réglages (preuve de non-régression)**

```bash
cd frontend && node node_modules/jest/bin/jest.js __tests__/AdminSettings
```

Attendu : PASS — `AdminSettings.test.tsx` (16 cas) et `AdminSettings.refresh.test.tsx` verts.

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/ui/SaveBar.tsx frontend/app/admin/settings/page.tsx
git commit -m "refactor(ui): SaveBar partagee (admin/settings -> ui), aucun changement de comportement"
```

---

## Task 3 : Styles partagés du profil

**Files:**
- Create: `frontend/components/profile/shared.ts`

Pas de test dédié : ce fichier n'est que des styles et un type, couverts par les suites d'onglets en Task 5.

- [ ] **Step 1 : Créer le fichier**

Les styles sont repris **verbatim** de `app/me/profile/page.tsx:264-286` (bloc `card` / `cardTitle` / `label` / `input` / `primaryBtn`), avec `marginBottom: 14` ajouté à `card` (la page posait l'espacement via un `gap: 14` de conteneur flex qui disparaît avec les onglets).

Crée `frontend/components/profile/shared.ts` :

```ts
// Styles et types partagés des onglets du profil. Miroir de components/admin/settings/shared.ts.
import { CSSProperties } from 'react';
import type { MyProfile } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';

/** Setter typé d'un champ du brouillon (fourni par la page orchestratrice). */
export type SetProfileField = <K extends keyof MyProfile>(k: K, v: MyProfile[K]) => void;

/** Props communes aux onglets porteurs du brouillon. */
export interface ProfileTabProps {
  profile: MyProfile;
  set: SetProfileField;
}

/** Styles partagés (carte, titre, label, champ, bouton). Hook car dépend du thème. */
export function useProfileStyles() {
  const { th } = useTheme();
  const card: CSSProperties = {
    background: th.surface, borderRadius: 20, boxShadow: `inset 0 0 0 1px ${th.line}`,
    padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14,
  };
  const cardTitle: CSSProperties = {
    fontFamily: th.fontUI, fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
    textTransform: 'uppercase', color: th.textFaint,
  };
  const label: CSSProperties = { fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute };
  const input: CSSProperties = {
    width: '100%', boxSizing: 'border-box', background: th.surface2, border: `1px solid ${th.line}`,
    borderRadius: 11, padding: '10px 12px', fontFamily: th.fontUI, fontSize: 14, color: th.text,
  };
  const primaryBtn = (busy: boolean): CSSProperties => ({
    cursor: 'pointer', border: 'none', background: th.accent, color: th.onAccent, borderRadius: 11,
    padding: '10px 18px', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5,
    opacity: busy ? 0.6 : 1, alignSelf: 'flex-start',
  });
  return { th, card, cardTitle, label, input, primaryBtn };
}
```

- [ ] **Step 2 : Commit**

```bash
git add frontend/components/profile/shared.ts
git commit -m "feat(profil): styles et types partages des onglets"
```

---

## Task 4 : Les 5 composants d'onglet

Extraction du JSX existant. **Règle absolue : aucun composant d'onglet ne fetch** — la page passe les données. Seule exception héritée : `PaymentMethodSection`, qui se fetch déjà lui-même (hors périmètre, on le laisse tel quel).

Les numéros de ligne ci-dessous renvoient à `app/me/profile/page.tsx` **tel qu'il est au début de cette task** (621 lignes, avant réécriture en Task 5).

**Files:**
- Create: `frontend/components/profile/tabs/ProfileIdentity.tsx`
- Create: `frontend/components/profile/tabs/ProfileLevel.tsx`
- Create: `frontend/components/profile/tabs/ProfilePreferences.tsx`
- Create: `frontend/components/profile/tabs/ProfileWallet.tsx`
- Create: `frontend/components/profile/tabs/ProfileSecurity.tsx`

- [ ] **Step 1 : ProfilePreferences (le seul dont la sémantique change)**

Le thème disparaît, et chaque contrôle écrit désormais dans le brouillon via `set` au lieu d'appeler l'API.

Crée `frontend/components/profile/tabs/ProfilePreferences.tsx` :

```tsx
'use client';
import { Segmented } from '@/components/ui/atoms';
import { ProfileTabProps, useProfileStyles } from '@/components/profile/shared';

const LOCALE_OPTIONS = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
];

const YES_NO = [{ value: 'oui' as const, label: 'Oui' }, { value: 'non' as const, label: 'Non' }];

// ⚠️ Pas de sélecteur de thème ici : il n'a aucun état serveur, il ne peut donc pas passer
// par la SaveBar — et par la règle de la page (« un contrôle hors barre n'a pas le droit
// d'être habillé en champ »), il ne peut pas rester dans cette carte. Le ThemeToggle de
// l'en-tête (ClubNav, ou en-tête plateforme de la page) le couvre déjà.
export function ProfilePreferences({ profile, set }: ProfileTabProps) {
  const { th, card, cardTitle, label, input } = useProfileStyles();
  const hint = { fontFamily: th.fontUI, fontSize: 12, color: th.textFaint };

  const toggle = (
    name: string,
    value: boolean,
    onChange: (v: boolean) => void,
    note?: string,
  ) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={label}>{name}</span>
      <div role="group" aria-label={name}>
        <Segmented<'oui' | 'non'> value={value ? 'oui' : 'non'} onChange={(v) => onChange(v === 'oui')} options={YES_NO} />
      </div>
      {note && <span style={hint}>{note}</span>}
    </div>
  );

  return (
    <section style={card} aria-label="Préférences">
      <div style={cardTitle}>Préférences</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={label}>Langue</span>
        <select value={profile.locale ?? 'fr'} onChange={(e) => set('locale', e.target.value)}
          aria-label="Langue" style={{ ...input, cursor: 'pointer' }}>
          {LOCALE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span style={hint}>L’interface reste en français pour l’instant.</span>
      </div>

      {toggle('Apparaître dans les classements', profile.showInLeaderboard, (v) => set('showInLeaderboard', v))}

      {toggle('Propose-moi les parties à mon niveau', profile.autoMatchProposals, (v) => set('autoMatchProposals', v),
        'Reçois une notification quand une partie ouverte à ton niveau est créée dans ton club. Tu rejoins en un tap — jamais d’inscription automatique.')}

      {toggle('Autoriser les demandes d\'ami', profile.acceptsFriendRequests, (v) => set('acceptsFriendRequests', v),
        'Ce réglage ne concerne que les amitiés — la messagerie privée se règle séparément ci-dessous.')}

      {toggle('Recevoir des messages privés', profile.acceptsDirectMessages, (v) => set('acceptsDirectMessages', v),
        'Vos amis confirmés peuvent toujours vous écrire, même désactivé.')}
    </section>
  );
}
```

- [ ] **Step 2 : ProfileIdentity**

Reprend le JSX des sections `identite` (349-376), `sport` (379-392), `infos` (448-473) et `licence` (594-606), **en retirant** de la section Infos son bouton « Enregistrer » et son témoin « Enregistré ✓ » (lignes 469-472) et de la section Licence les siens (601-604) — la `SaveBar` les remplace.

Crée `frontend/components/profile/tabs/ProfileIdentity.tsx` :

```tsx
'use client';
import { RefObject } from 'react';
import type { Sport } from '@/lib/api';
import { PillTabs } from '@/components/ui/atoms';
import { DateField } from '@/components/ui/DateField';
import { ProfileTabProps, useProfileStyles } from '@/components/profile/shared';

interface Props extends ProfileTabProps {
  sports: Sport[];
  avatarSrc: string | null;
  initials: string;
  uploading: boolean;
  fileRef: RefObject<HTMLInputElement | null>;
  onPickAvatar: (file: File | undefined) => void;
  /** Licence : seconde ressource, rendue seulement si membre d'un club. */
  licence: string | null;
  clubName: string | null;
  onLicence: (v: string) => void;
}

export function ProfileIdentity({
  profile, set, sports, avatarSrc, initials, uploading, fileRef, onPickAvatar,
  licence, clubName, onLicence,
}: Props) {
  const { th, card, cardTitle, label, input, primaryBtn } = useProfileStyles();
  const hint = { fontFamily: th.fontUI, fontSize: 12, color: th.textFaint };

  const readonlyRow = (l: string, v: string) => (
    <div style={{ display: 'flex', gap: 12, fontFamily: th.fontUI, fontSize: 14 }}>
      <span style={{ color: th.textMute, width: 92, flexShrink: 0 }}>{l}</span>
      <span style={{ color: th.text, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</span>
    </div>
  );

  return (
    <>
      <section style={card} aria-label="Identité">
        <div style={cardTitle}>Identité</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {avatarSrc ? (
            <img src={avatarSrc} alt="Photo de profil" style={{ width: 84, height: 84, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, opacity: uploading ? 0.5 : 1 }} />
          ) : (
            <span aria-hidden="true" style={{
              width: 84, height: 84, borderRadius: '50%', flexShrink: 0, background: th.accent, color: th.onAccent,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, fontWeight: 700, fontSize: 28,
            }}>{initials}</span>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
              aria-label="Choisir une photo de profil"
              onChange={(e) => { onPickAvatar(e.target.files?.[0]); e.target.value = ''; }} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading} style={primaryBtn(uploading)}>
              {uploading ? 'Envoi…' : 'Changer la photo'}
            </button>
            <span style={hint}>JPEG, PNG ou WebP · 2 Mo max</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
          {readonlyRow('Prénom', profile.firstName)}
          {readonlyRow('Nom', profile.lastName)}
          {readonlyRow('Email', profile.email)}
          <span style={hint}>L’email ne peut pas être modifié.</span>
        </div>
      </section>

      {sports.length > 0 && (
        <section style={card} aria-label="Sport préféré">
          <div style={cardTitle}>Sport préféré</div>
          <div role="group" aria-label="Sport préféré">
            <PillTabs
              options={[{ value: '', label: 'Aucun' }, ...sports.map((s) => ({ value: s.id, label: s.name }))]}
              value={profile.preferredSport?.id ?? ''}
              onChange={(id) => set('preferredSport', id ? (sports.find((s) => s.id === id) ?? null) : null)}
              size="sm"
            />
          </div>
          <span style={hint}>Met en avant ce sport dans l&apos;app.</span>
        </section>
      )}

      <section style={card} aria-label="Informations">
        <div style={cardTitle}>Informations</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label}>Téléphone</span>
          <input value={profile.phone ?? ''} onChange={(e) => set('phone', e.target.value)}
            placeholder="06 09 03 26 35" aria-label="Téléphone" style={input} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label}>Date de naissance</span>
          <DateField value={profile.birthDate ? profile.birthDate.slice(0, 10) : ''}
            onChange={(d) => set('birthDate', d || null)} width="100%" ariaLabel="Date de naissance" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label}>Sexe</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['MALE', 'FEMALE'] as const).map((s) => (
              <button key={s} onClick={() => set('sex', s)}
                style={{ flex: 1, cursor: 'pointer', borderRadius: 11, padding: '10px', fontFamily: th.fontUI, fontSize: 13.5, border: `1px solid ${profile.sex === s ? th.accent : th.line}`, background: profile.sex === s ? th.surface2 : 'transparent', color: th.text }}>
                {s === 'MALE' ? 'Homme' : 'Femme'}
              </button>
            ))}
          </div>
        </div>
      </section>

      {licence !== null && (
        <section style={card} aria-label="Licence">
          <div style={cardTitle}>Licence{clubName ? ` · ${clubName}` : ''}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={label}>N° de licence / adhérent</span>
            <input value={licence} onChange={(e) => onLicence(e.target.value)}
              placeholder="N° de licence / adhérent" aria-label="N° de licence / adhérent" style={input} />
          </div>
        </section>
      )}
    </>
  );
}
```

> **Note sur `preferredSport`** : le brouillon stocke l'**objet** (c'est ce dont `PillTabs` a besoin pour surligner la pastille) ; `buildProfileBody` en dérive `preferredSportId`. `sports.find(...)` renvoie un `Sport`, structurellement compatible avec `{ id, key, name }`.

- [ ] **Step 3 : ProfileLevel**

Reprend le JSX de la section `niveau` (396-444) verbatim, sans son `<section>` conditionnel externe (la page décide de l'onglet).

Crée `frontend/components/profile/tabs/ProfileLevel.tsx` :

```tsx
'use client';
import type { ClubMatchStats, MyRating, RatingPoint, Sport } from '@/lib/api';
import { PillTabs } from '@/components/ui/atoms';
import { LevelBadge } from '@/components/player/LevelBadge';
import { ReliabilityMeter } from '@/components/player/ReliabilityMeter';
import { LevelCalibration } from '@/components/player/LevelCalibration';
import { LevelSourceNote } from '@/components/player/LevelSourceNote';
import { LevelHistoryChart } from '@/components/player/LevelHistoryChart';
import { ResultStats } from '@/components/player/ResultStats';
import { useProfileStyles } from '@/components/profile/shared';

interface Props {
  sports: Sport[];
  ratingSport: string;
  onRatingSport: (key: string) => void;
  rating: MyRating | null;
  history: RatingPoint[];
  matchStats: ClubMatchStats | null;
  clubName: string | null;
  calibrating: boolean;
  ratingBusy: boolean;
  onStartCalibrate: () => void;
  onCalibrate: (level: number | null) => void;
}

// Niveau : padel uniquement aujourd'hui. Le sélecteur de sport réapparaîtra quand
// l'utilisateur aura un niveau sur 2+ sports (drapeau à repasser true à ce moment-là).
const showLevelSportPicker = false;

export function ProfileLevel({
  sports, ratingSport, onRatingSport, rating, history, matchStats, clubName,
  calibrating, ratingBusy, onStartCalibrate, onCalibrate,
}: Props) {
  const { th, card, cardTitle, label } = useProfileStyles();
  const levelSportName = sports.find((s) => s.key === ratingSport)?.name ?? 'Padel';
  const linkBtn = {
    fontFamily: th.fontUI, fontSize: 13, textDecoration: 'underline', opacity: 0.7,
    background: 'none', border: 'none', cursor: 'pointer', color: th.text,
  };

  return (
    <section style={card} aria-label="Mon niveau">
      <div style={cardTitle}>Mon niveau · {levelSportName}</div>
      {showLevelSportPicker && sports.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={label}>Sport du niveau</span>
          <div role="group" aria-label="Sport du niveau">
            <PillTabs options={sports.map((s) => ({ value: s.key, label: s.name }))} value={ratingSport} onChange={onRatingSport} size="sm" />
          </div>
        </div>
      )}
      {calibrating ? (
        <LevelCalibration onSelect={(l) => onCalibrate(l)} onSkip={() => onCalibrate(null)} busy={ratingBusy} />
      ) : rating && rating.level != null ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <LevelBadge rating={rating} />
            <button type="button" onClick={onStartCalibrate} style={linkBtn}>Réévaluer</button>
          </div>
          {matchStats && matchStats.wins + matchStats.losses > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint, marginBottom: 4 }}>Résultats · {clubName}</div>
              <ResultStats tone="onSurface" wins={matchStats.wins} losses={matchStats.losses} streak={matchStats.streak} />
            </div>
          )}
          {rating.calibrated && <div style={{ marginTop: 10 }}><LevelHistoryChart points={history} /></div>}
          <LevelSourceNote style={{ marginTop: 10 }} />
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.text, margin: 0 }}>
            Niveau en cours de calibrage — joue tes premiers matchs et ton niveau s’affinera tout seul.
          </p>
          {rating && <ReliabilityMeter pct={rating.reliability} />}
          <button type="button" onClick={onStartCalibrate} style={{ ...linkBtn, alignSelf: 'flex-start' }}>
            Affiner mon niveau (optionnel)
          </button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4 : ProfileWallet**

Reprend les sections `portefeuille` / `paiement` / `paiements` (544-557).

Crée `frontend/components/profile/tabs/ProfileWallet.tsx` :

```tsx
'use client';
import type { MemberPackage, MyPayment, Subscription } from '@/lib/api';
import { WalletSection } from '@/components/profile/WalletSection';
import { PaymentMethodSection } from '@/components/profile/PaymentMethodSection';
import { PaymentsHistory } from '@/components/profile/PaymentsHistory';
import { useProfileStyles } from '@/components/profile/shared';

interface Props {
  slug: string;
  token: string;
  packages: MemberPackage[];
  subscriptions: Subscription[];
  payments: MyPayment[];
}

export function ProfileWallet({ slug, token, packages, subscriptions, payments }: Props) {
  const { card, cardTitle } = useProfileStyles();
  return (
    <>
      <section style={card} aria-label="Portefeuille">
        <div style={cardTitle}>Portefeuille</div>
        <WalletSection packages={packages} subscriptions={subscriptions} />
      </section>

      <section style={card} aria-label="Méthodes de paiement">
        <div style={cardTitle}>Méthodes de paiement</div>
        <PaymentMethodSection slug={slug} token={token} />
      </section>

      <section style={card} aria-label="Mes paiements">
        <div style={cardTitle}>Mes paiements</div>
        <PaymentsHistory payments={payments} />
      </section>
    </>
  );
}
```

- [ ] **Step 5 : ProfileSecurity**

Reprend les sections `securite` (562-591) et `suppression` (610-613). L'état du formulaire de mot de passe **descend dans le composant** : c'est de l'état local d'action, sans lien avec le brouillon, et la page n'a aucune raison de le porter.

Crée `frontend/components/profile/tabs/ProfileSecurity.tsx` :

```tsx
'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { DeleteAccountSection } from '@/components/profile/DeleteAccountSection';
import { useProfileStyles } from '@/components/profile/shared';

const PASSWORD_ERR_FR: Record<string, string> = {
  INVALID_PASSWORD: 'Mot de passe actuel incorrect.',
  SAME_PASSWORD: 'Le nouveau mot de passe doit être différent de l’actuel.',
};

// Mot de passe et suppression sont des ACTIONS, pas des champs : elles gardent leur
// bouton et leur feedback propres, hors de la SaveBar (règle de la page).
export function ProfileSecurity({ token }: { token: string }) {
  const { th, card, cardTitle, label, input, primaryBtn } = useProfileStyles();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edit = (fn: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    fn(e.target.value); setSaved(false); setError(null);
  };

  const changePassword = async () => {
    setSaved(false); setError(null);
    if (newPassword.length < 8) { setError('Le mot de passe doit faire au moins 8 caractères.'); return; }
    if (newPassword !== confirmPassword) { setError('Les mots de passe ne correspondent pas.'); return; }
    setSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword, token);
      setSaved(true);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (e) {
      const msg = (e as Error).message;
      setError(PASSWORD_ERR_FR[msg] || msg || 'Une erreur est survenue.');
    } finally { setSaving(false); }
  };

  return (
    <>
      <section style={card} aria-label="Mot de passe">
        <div style={cardTitle}>Mot de passe</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label}>Mot de passe actuel</span>
          <input type="password" value={currentPassword} autoComplete="current-password"
            onChange={edit(setCurrentPassword)} aria-label="Mot de passe actuel" style={input} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label}>Nouveau mot de passe</span>
          <input type="password" value={newPassword} autoComplete="new-password"
            onChange={edit(setNewPassword)} aria-label="Nouveau mot de passe" placeholder="8 caractères minimum" style={input} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label}>Confirmer le nouveau mot de passe</span>
          <input type="password" value={confirmPassword} autoComplete="new-password"
            onChange={edit(setConfirmPassword)} aria-label="Confirmer le nouveau mot de passe" style={input} />
        </div>
        {error && (
          <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.onAccent, background: th.accent, borderRadius: 11, padding: '9px 12px' }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={changePassword} disabled={saving} style={primaryBtn(saving)}>Modifier le mot de passe</button>
          {saved && <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute }}>Modifié ✓</span>}
        </div>
      </section>

      <section style={card} aria-label="Supprimer mon compte">
        <div style={cardTitle}>Supprimer mon compte</div>
        <DeleteAccountSection token={token} />
      </section>
    </>
  );
}
```

- [ ] **Step 6 : Vérifier la compilation des nouveaux fichiers**

```bash
cd frontend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "components/profile/tabs" || echo "OK: aucune erreur sur les onglets"
```

Attendu : `OK: aucune erreur sur les onglets`. (D'autres erreurs peuvent exister ailleurs — travail parallèle en cours sur le repo. On ne filtre que nos fichiers.)

- [ ] **Step 7 : Commit**

```bash
git add frontend/components/profile/tabs/
git commit -m "feat(profil): 5 composants d'onglet (Identite, Niveau, Preferences, Portefeuille, Securite)"
```

---

## Task 5 : Page orchestratrice — onglets, brouillon, SaveBar

Le cœur. La page passe de 621 lignes à ~230.

**Files:**
- Rewrite: `frontend/app/me/profile/page.tsx`
- Rewrite: `frontend/__tests__/MeProfile.test.tsx`

- [ ] **Step 1 : Réécrire la suite de tests (elle doit échouer)**

Les 24 cas existants supposent que les 11 sections sont rendues **simultanément** — ce n'est plus vrai. Remplace intégralement `frontend/__tests__/MeProfile.test.tsx` par :

```tsx
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import MyProfilePage from '../app/me/profile/page';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

let clubCtx: { slug: string | null; club: { id: string; slug: string; name: string; levelSystemEnabled?: boolean } | null; loading: boolean } =
  { slug: null, club: null, loading: false };
jest.mock('../lib/ClubProvider', () => ({ useClub: () => clubCtx }));

jest.mock('../components/ClubNav', () => ({ ClubNav: () => <nav /> }));

jest.mock('../lib/api', () => ({
  api: {
    getMyProfile: jest.fn(), getMyClubs: jest.fn(), getMyClubMembership: jest.fn(),
    getMyClubPackages: jest.fn(), getMyClubSubscriptions: jest.fn(), getMyPayments: jest.fn(),
    getMyPaymentMethod: jest.fn(), removeMyPaymentMethod: jest.fn(),
    getAccountDeletionSummary: jest.fn(), deleteMyAccount: jest.fn(),
    updateMyProfile: jest.fn(), updateMyClubMembership: jest.fn(), uploadMyAvatar: jest.fn(),
    getMyRating: jest.fn().mockResolvedValue(null), getRatingHistory: jest.fn().mockResolvedValue([]),
    getMyClubMatchStats: jest.fn(), calibrateRating: jest.fn(), changePassword: jest.fn(),
    getSports: jest.fn().mockResolvedValue([]),
  },
  assetUrl: (p: string | null) => (p ? `http://localhost:3001${p}` : null),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { api } = require('../lib/api') as { api: Record<string, jest.Mock> };

const profile = {
  id: 'u1', email: 'eric@palova.fr', firstName: 'Eric', lastName: 'Nougayrede', phone: '0609032635', sex: 'MALE',
  birthDate: '1973-07-08T00:00:00.000Z', avatarUrl: null, locale: 'fr', isSuperAdmin: false, showInLeaderboard: false,
  autoMatchProposals: false, acceptsFriendRequests: false, acceptsDirectMessages: true, preferredSport: null,
};

const PADEL = { id: 'sport-padel', key: 'padel', name: 'Padel', icon: '🎾', published: true };

const wrap = () => render(<ThemeProvider><MyProfilePage /></ThemeProvider>);
const onClub = () => { clubCtx = { slug: 'demo', club: { id: 'c1', slug: 'demo', name: 'Club Démo' }, loading: false }; };
const goTab = (label: string) => fireEvent.click(screen.getByRole('button', { name: label }));

describe('Page Mon profil — onglets + SaveBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    window.history.replaceState(null, '', '/me/profile');
    document.cookie = 'token=abc; path=/';
    clubCtx = { slug: null, club: null, loading: false };
    api.getMyProfile.mockResolvedValue(profile);
    api.getMyClubs.mockResolvedValue([]);
    api.getMyClubMembership.mockResolvedValue(null);
    api.getMyClubPackages.mockResolvedValue([]);
    api.getMyClubSubscriptions.mockResolvedValue([]);
    api.getMyPayments.mockResolvedValue([]);
    api.getMyPaymentMethod.mockResolvedValue(null);
    api.getAccountDeletionSummary.mockResolvedValue({ blockingClubs: [], futureReservations: 0, activeSubscriptions: 0, balances: [] });
    api.updateMyProfile.mockResolvedValue(profile);
    api.uploadMyAvatar.mockResolvedValue({ ...profile, avatarUrl: '/uploads/avatars/u1-2.png' });
    api.changePassword.mockResolvedValue({ ok: true });
    api.getMyClubMatchStats.mockResolvedValue({ wins: 0, losses: 0, streak: 0 });
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  // --- Onglets ---

  it('ouvre sur Identité, sans barre d’enregistrement au repos', async () => {
    wrap();
    expect(await screen.findByRole('region', { name: 'Identité' })).toBeInTheDocument();
    expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument();
  });

  it('change d’onglet et reflète l’onglet actif dans l’URL', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Identité' });
    goTab('Préférences');
    expect(await screen.findByRole('region', { name: 'Préférences' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Identité' })).not.toBeInTheDocument();
    expect(window.location.search).toContain('tab=preferences');
  });

  it('ouvre sur l’onglet nommé dans ?tab= au montage', async () => {
    window.history.replaceState(null, '', '/me/profile?tab=securite');
    wrap();
    expect(await screen.findByRole('region', { name: 'Mot de passe' })).toBeInTheDocument();
  });

  it('hôte plateforme : pas d’onglet Portefeuille', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Identité' });
    expect(screen.queryByRole('button', { name: 'Portefeuille' })).not.toBeInTheDocument();
  });

  it('?tab=portefeuille sur un hôte sans portefeuille retombe sur Identité (pas d’onglet mort)', async () => {
    window.history.replaceState(null, '', '/me/profile?tab=portefeuille');
    wrap();
    expect(await screen.findByRole('region', { name: 'Identité' })).toBeInTheDocument();
  });

  it('club OFF : pas d’onglet Niveau', async () => {
    clubCtx = { slug: 'demo', club: { id: 'c1', slug: 'demo', name: 'Club Démo', levelSystemEnabled: false }, loading: false };
    wrap();
    await screen.findByRole('region', { name: 'Identité' });
    expect(screen.queryByRole('button', { name: 'Niveau' })).not.toBeInTheDocument();
  });

  // --- Brouillon & SaveBar ---

  it('éditer un champ révèle la barre et Enregistrer envoie le PATCH complet', async () => {
    wrap();
    fireEvent.change(await screen.findByLabelText('Téléphone'), { target: { value: '0700000000' } });
    expect(screen.getByText('Modifications non enregistrées')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '0700000000', sex: 'MALE', birthDate: '1973-07-08' }), 'abc',
    ));
    expect(await screen.findByText('Enregistré ✓')).toBeInTheDocument();
  });

  it('les préférences sont différées : aucun appel réseau avant Enregistrer', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Identité' });
    goTab('Préférences');
    const group = await screen.findByRole('group', { name: 'Propose-moi les parties à mon niveau' });
    fireEvent.click(within(group).getByText('Oui'));
    expect(api.updateMyProfile).not.toHaveBeenCalled();
    expect(screen.getByText('Modifications non enregistrées')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith(
      expect.objectContaining({ autoMatchProposals: true }), 'abc',
    ));
  });

  it('la langue est différée et part dans le même PATCH', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Identité' });
    goTab('Préférences');
    fireEvent.change(await screen.findByLabelText('Langue'), { target: { value: 'es' } });
    expect(api.updateMyProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith(expect.objectContaining({ locale: 'es' }), 'abc'));
  });

  it('le sport préféré est différé et part en preferredSportId', async () => {
    api.getSports.mockResolvedValue([PADEL]);
    wrap();
    const region = await screen.findByRole('region', { name: 'Sport préféré' });
    fireEvent.click(within(region).getByText('Padel'));
    expect(api.updateMyProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith(
      expect.objectContaining({ preferredSportId: 'sport-padel' }), 'abc',
    ));
  });

  it('Annuler restaure le brouillon et cache la barre, sans appel réseau', async () => {
    wrap();
    const phone = await screen.findByLabelText('Téléphone');
    fireEvent.change(phone, { target: { value: '0700000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(phone).toHaveValue('0609032635');
    expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument();
    expect(api.updateMyProfile).not.toHaveBeenCalled();
  });

  it('un échec d’enregistrement s’affiche dans la barre, sans flash de succès', async () => {
    api.updateMyProfile.mockRejectedValue(new Error('Boom'));
    wrap();
    fireEvent.change(await screen.findByLabelText('Téléphone'), { target: { value: '0700000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
    expect(screen.queryByText('Enregistré ✓')).not.toBeInTheDocument();
  });

  it('une édition faite pendant un enregistrement en vol n’est pas écrasée (régression)', async () => {
    let resolve!: (v: unknown) => void;
    api.updateMyProfile.mockReturnValue(new Promise((r) => { resolve = r; }));
    wrap();
    const phone = await screen.findByLabelText('Téléphone');
    fireEvent.change(phone, { target: { value: '0700000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    // L'utilisateur continue d'éditer pendant que la requête est en vol.
    fireEvent.change(phone, { target: { value: '0788888888' } });
    resolve(profile);
    await waitFor(() => expect(phone).toHaveValue('0788888888'));
    // …et la page reste dirty : la seconde édition n'a pas été enregistrée.
    expect(screen.getByText('Modifications non enregistrées')).toBeInTheDocument();
  });

  // --- Hors brouillon ---

  it('l’onglet Préférences ne rend AUCUN sélecteur de thème (il vit dans l’en-tête)', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Identité' });
    goTab('Préférences');
    await screen.findByRole('region', { name: 'Préférences' });
    expect(screen.queryByText('Thème')).not.toBeInTheDocument();
    expect(screen.queryByText('Sombre')).not.toBeInTheDocument();
    // Le ThemeToggle de l'en-tête plateforme, lui, est bien là.
    expect(screen.getByLabelText('Changer de thème')).toBeInTheDocument();
  });

  it('l’upload d’avatar ne rend jamais la page dirty', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Identité' });
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Choisir une photo de profil'), { target: { files: [file] } });
    await waitFor(() => expect(api.uploadMyAvatar).toHaveBeenCalled());
    expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument();
  });

  it('l’upload d’avatar pendant une édition ne détruit pas le brouillon (régression)', async () => {
    wrap();
    const phone = await screen.findByLabelText('Téléphone');
    fireEvent.change(phone, { target: { value: '0700000000' } });
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Choisir une photo de profil'), { target: { files: [file] } });
    await waitFor(() => expect(api.uploadMyAvatar).toHaveBeenCalled());
    expect(phone).toHaveValue('0700000000');
  });

  it('refuse un format de fichier non supporté sans appeler l’API', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Identité' });
    const file = new File(['x'], 'a.gif', { type: 'image/gif' });
    fireEvent.change(screen.getByLabelText('Choisir une photo de profil'), { target: { files: [file] } });
    expect(api.uploadMyAvatar).not.toHaveBeenCalled();
    expect(await screen.findByText(/Format d’image non supporté/)).toBeInTheDocument();
  });

  it('le mot de passe garde son bouton propre, hors de la barre', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Identité' });
    goTab('Sécurité');
    fireEvent.change(await screen.findByLabelText('Mot de passe actuel'), { target: { value: 'old' } });
    fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirmer le nouveau mot de passe'), { target: { value: 'password123' } });
    // Éditer le formulaire de mot de passe ne rend PAS la page dirty.
    expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Modifier le mot de passe' }));
    await waitFor(() => expect(api.changePassword).toHaveBeenCalledWith('old', 'password123', 'abc'));
    expect(await screen.findByText('Modifié ✓')).toBeInTheDocument();
  });

  it('refuse une confirmation qui ne correspond pas, sans appeler l’API', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Identité' });
    goTab('Sécurité');
    fireEvent.change(await screen.findByLabelText('Nouveau mot de passe'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirmer le nouveau mot de passe'), { target: { value: 'autre1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Modifier le mot de passe' }));
    expect(await screen.findByText('Les mots de passe ne correspondent pas.')).toBeInTheDocument();
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it('refuse un nouveau mot de passe trop court, sans appeler l’API', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Identité' });
    goTab('Sécurité');
    fireEvent.change(await screen.findByLabelText('Nouveau mot de passe'), { target: { value: 'court' } });
    fireEvent.change(screen.getByLabelText('Confirmer le nouveau mot de passe'), { target: { value: 'court' } });
    fireEvent.click(screen.getByRole('button', { name: 'Modifier le mot de passe' }));
    expect(await screen.findByText('Le mot de passe doit faire au moins 8 caractères.')).toBeInTheDocument();
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  // --- Identité / Niveau ---

  it('affiche l’identité et l’email non modifiable', async () => {
    wrap();
    const region = await screen.findByRole('region', { name: 'Identité' });
    expect(within(region).getByText('Eric')).toBeInTheDocument();
    expect(within(region).getByText('eric@palova.fr')).toBeInTheDocument();
    expect(within(region).getByText('L’email ne peut pas être modifié.')).toBeInTheDocument();
    expect(screen.getByLabelText('Téléphone')).toHaveValue('0609032635');
  });

  it('l’onglet Niveau affiche le bilan V/D du club', async () => {
    onClub();
    api.getMyRating.mockResolvedValue({ calibrated: true, level: 5.2, tier: 'Intermédiaire', isProvisional: false, reliability: 80 });
    api.getMyClubMatchStats.mockResolvedValue({ wins: 3, losses: 1, streak: 2 });
    wrap();
    await screen.findByRole('region', { name: 'Identité' });
    goTab('Niveau');
    expect(await screen.findByText(/Résultats · Club Démo/)).toBeInTheDocument();
  });

  it('niveau non calibré : état neutre, « Affiner » révèle le calibrage', async () => {
    api.getMyRating.mockResolvedValue({ calibrated: false, level: null, tier: '—', isProvisional: true, reliability: 10 });
    wrap();
    await screen.findByRole('region', { name: 'Identité' });
    goTab('Niveau');
    expect(await screen.findByText(/Niveau en cours de calibrage/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Affiner mon niveau/ }));
    // LevelCalibration est monté : son texte d'accroche et son curseur apparaissent.
    // (Ne PAS asserter sur api.getMyRating : il est appelé au montage de toute façon,
    // l'assertion serait verte même si le bouton ne faisait rien.)
    expect(await screen.findByText(/Place le curseur sur le niveau/)).toBeInTheDocument();
  });

  it('calibrer envoie le niveau choisi et referme le calibrage', async () => {
    api.getMyRating.mockResolvedValue({ calibrated: false, level: null, tier: '—', isProvisional: true, reliability: 10 });
    api.calibrateRating.mockResolvedValue({ calibrated: true, level: 4, tier: 'Intermédiaire', isProvisional: true, reliability: 40 });
    wrap();
    await screen.findByRole('region', { name: 'Identité' });
    goTab('Niveau');
    fireEvent.click(await screen.findByRole('button', { name: /Affiner mon niveau/ }));
    // Le curseur vaut 4 par défaut (DEFAULT dans LevelCalibration).
    fireEvent.click(await screen.findByRole('button', { name: 'Valider mon niveau' }));
    await waitFor(() => expect(api.calibrateRating).toHaveBeenCalledWith(4, 'abc', 'padel'));
  });
});

describe('Page Mon profil — licence (seconde ressource)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState(null, '', '/me/profile');
    document.cookie = 'token=abc; path=/';
    onClub();
    api.getMyProfile.mockResolvedValue(profile);
    api.getMyClubs.mockResolvedValue([]);
    api.getMyClubMembership.mockResolvedValue({ membershipNo: 'LIC42', status: 'ACTIVE', isSubscriber: true });
    api.getMyClubPackages.mockResolvedValue([]);
    api.getMyClubSubscriptions.mockResolvedValue([]);
    api.getMyPayments.mockResolvedValue([]);
    api.getMyPaymentMethod.mockResolvedValue(null);
    api.getMyClubMatchStats.mockResolvedValue({ wins: 0, losses: 0, streak: 0 });
    api.getSports.mockResolvedValue([]);
    api.updateMyProfile.mockResolvedValue(profile);
    api.updateMyClubMembership.mockResolvedValue({ membershipNo: 'LIC99', status: 'ACTIVE', isSubscriber: true });
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  it('la licence passe par la barre, pas par un bouton propre', async () => {
    wrap();
    const input = await screen.findByLabelText('N° de licence / adhérent');
    expect(input).toHaveValue('LIC42');
    fireEvent.change(input, { target: { value: 'LIC99' } });
    expect(screen.getByText('Modifications non enregistrées')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.updateMyClubMembership).toHaveBeenCalledWith('demo', 'LIC99', 'abc'));
    // Profil non touché → pas de PATCH profil inutile.
    expect(api.updateMyProfile).not.toHaveBeenCalled();
  });

  it('profil ET licence dirty : les deux ressources partent sur un seul Enregistrer', async () => {
    wrap();
    fireEvent.change(await screen.findByLabelText('Téléphone'), { target: { value: '0700000000' } });
    fireEvent.change(screen.getByLabelText('N° de licence / adhérent'), { target: { value: 'LIC99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalled());
    expect(api.updateMyClubMembership).toHaveBeenCalledWith('demo', 'LIC99', 'abc');
  });

  it('échec partiel : le profil se rebaseline même si la licence échoue', async () => {
    api.updateMyClubMembership.mockRejectedValue(new Error('Licence refusée'));
    wrap();
    fireEvent.change(await screen.findByLabelText('Téléphone'), { target: { value: '0700000000' } });
    fireEvent.change(screen.getByLabelText('N° de licence / adhérent'), { target: { value: 'LIC99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Licence refusée');
    // Le profil a bien été enregistré : la barre reste (licence encore dirty) mais pas de flash de succès.
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalled());
    expect(screen.queryByText('Enregistré ✓')).not.toBeInTheDocument();
  });

  it('Annuler restaure aussi la licence', async () => {
    wrap();
    const input = await screen.findByLabelText('N° de licence / adhérent');
    fireEvent.change(input, { target: { value: 'LIC99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(input).toHaveValue('LIC42');
    expect(api.updateMyClubMembership).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

```bash
cd frontend && node node_modules/jest/bin/jest.js __tests__/MeProfile.test.tsx
```

Attendu : FAIL en masse — la page rend encore la `ProfileSectionNav` et les sections empilées, il n'y a ni onglet ni `SaveBar`.

- [ ] **Step 3 : Réécrire la page**

Remplace intégralement `frontend/app/me/profile/page.tsx` par :

```tsx
'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api, assetUrl, ClubMatchStats, MyProfile, MyRating, RatingPoint, MemberPackage, Subscription, MyPayment, Sport } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { Screen } from '@/components/ui/Screen';
import { BackButton, PillTabs, ThemeToggle } from '@/components/ui/atoms';
import { SaveBar } from '@/components/ui/SaveBar';
import { ProfileMenu } from '@/components/ProfileMenu';
import { ClubNav } from '@/components/ClubNav';
import { PROFILE_TABS, ProfileTabKey, parseProfileTab, buildProfileBody, isDirty, licenceDirty } from '@/lib/meProfile';
import { SetProfileField } from '@/components/profile/shared';
import { ProfileIdentity } from '@/components/profile/tabs/ProfileIdentity';
import { ProfileLevel } from '@/components/profile/tabs/ProfileLevel';
import { ProfilePreferences } from '@/components/profile/tabs/ProfilePreferences';
import { ProfileWallet } from '@/components/profile/tabs/ProfileWallet';
import { ProfileSecurity } from '@/components/profile/tabs/ProfileSecurity';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Page profil en 5 onglets, calquée sur /admin/settings : baseline serveur + brouillon,
// une seule SaveBar sticky couvrant DEUX ressources (profil et licence).
// Règle : tout ce qui est un champ passe par la barre ; ce qui n'est pas un champ
// (photo, mot de passe, suppression, thème) garde son propre chemin.
export default function MyProfilePage() {
  const router = useRouter();
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { slug, club } = useClub();

  // Ressource 1 : le profil.
  const [server, setServer] = useState<MyProfile | null>(null);
  const [draft, setDraft] = useState<MyProfile | null>(null);
  // Ressource 2 : la licence du club courant (endpoint distinct). null = non membre.
  const [licenceServer, setLicenceServer] = useState<string | null>(null);
  const [licenceDraft, setLicenceDraft] = useState<string>('');

  const [saving, setSaving] = useState(false);
  // `error` = chargement/upload (bandeau haut) ; `saveError` = échec d'enregistrement (barre).
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ProfileTabKey>('identite');

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const [sports, setSports] = useState<Sport[]>([]);

  // Niveau (lecture + action de calibrage, hors brouillon).
  const [rating, setRating] = useState<MyRating | null>(null);
  const [history, setHistory] = useState<RatingPoint[]>([]);
  const [matchStats, setMatchStats] = useState<ClubMatchStats | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [ratingSport, setRatingSport] = useState('padel');

  // Portefeuille (lecture, hors brouillon).
  const [walletPackages, setWalletPackages] = useState<MemberPackage[]>([]);
  const [walletSubs, setWalletSubs] = useState<Subscription[]>([]);
  const [payments, setPayments] = useState<MyPayment[]>([]);

  useEffect(() => { if (ready && !token) router.replace('/login'); }, [ready, token, router]);
  useEffect(() => { api.getSports().then(setSports).catch(() => {}); }, []);
  useEffect(() => { setTab(parseProfileTab(window.location.search)); }, []);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setError(null);
      const p = await api.getMyProfile(token);
      setServer(p);
      setDraft(p);
      if (slug) {
        const m = await api.getMyClubMembership(slug, token).catch(() => null);
        const lic = m ? (m.membershipNo ?? '') : null;
        setLicenceServer(lic);
        setLicenceDraft(lic ?? '');
        if (m) {
          // Best-effort : ne bloquent jamais le profil.
          api.getMyClubPackages(slug, token).then(setWalletPackages).catch(() => {});
          api.getMyClubSubscriptions(slug, token).then(setWalletSubs).catch(() => {});
          api.getMyPayments(slug, token).then(setPayments).catch(() => {});
        }
      } else {
        setLicenceServer(null);
      }
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, slug]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!token) return;
    api.getMyRating(token, ratingSport).then(setRating).catch(() => {});
    api.getRatingHistory(token, ratingSport).then(setHistory).catch(() => {});
    setCalibrating(false);
  }, [token, ratingSport]);

  useEffect(() => {
    if (!token || !slug) { setMatchStats(null); return; }
    api.getMyClubMatchStats(slug, token, ratingSport).then(setMatchStats).catch(() => setMatchStats(null));
  }, [token, slug, ratingSport]);

  // Éditer efface un échec d'enregistrement et le flash de succès.
  const set: SetProfileField = (k, v) => {
    setSaveError(null); setJustSaved(false);
    setDraft((p) => (p ? { ...p, [k]: v } : p));
  };
  const setLicence = (v: string) => {
    setSaveError(null); setJustSaved(false);
    setLicenceDraft(v);
  };

  const isMember = licenceServer !== null;
  const profileDirty = !!server && !!draft && isDirty(server, draft);
  const licDirty = isMember && licenceDirty(licenceServer, licenceDraft);
  const dirty = profileDirty || licDirty;

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 2500);
    return () => clearTimeout(t);
  }, [justSaved]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const save = async () => {
    if (!token || !server || !draft) return;
    setSaving(true);
    try {
      setSaveError(null);
      const errors: string[] = [];
      const tasks: Promise<void>[] = [];

      if (profileDirty) {
        // ⚠️ Ne repose QUE la baseline : reposer `draft` écraserait une édition
        // faite pendant que la requête était en vol (régression vécue côté Sports).
        tasks.push(api.updateMyProfile(buildProfileBody(draft), token)
          .then(() => { setServer(draft); })
          .catch((e) => { errors.push((e as Error).message); }));
      }
      if (licDirty && slug) {
        const value = licenceDraft.trim();
        tasks.push(api.updateMyClubMembership(slug, value, token)
          .then(() => { setLicenceServer(value); })
          .catch((e) => { errors.push((e as Error).message); }));
      }

      await Promise.all(tasks);
      // Deux ressources indépendantes : chacune réussit/échoue seule. Le flash de
      // succès n'apparaît que si tout ce qui a été tenté a réussi.
      if (errors.length > 0) setSaveError(errors.join(' · '));
      else setJustSaved(true);
    } finally { setSaving(false); }
  };

  const cancel = () => {
    setDraft(server);
    setLicenceDraft(licenceServer ?? '');
    setSaveError(null);
    setJustSaved(false);
  };

  // Avatar : déjà persisté à l'upload → on patche UNIQUEMENT avatarUrl dans la baseline
  // ET le brouillon. Reposer l'objet entier renvoyé par l'API détruirait le brouillon.
  const pickAvatar = async (file: File | undefined) => {
    if (!file || !token) return;
    if (!AVATAR_TYPES.includes(file.type)) { setError('Format d’image non supporté (JPEG, PNG ou WebP)'); return; }
    if (file.size > MAX_AVATAR_BYTES) { setError('Image trop lourde (2 Mo max)'); return; }
    setError(null);
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const p = await api.uploadMyAvatar(file, token);
      setServer((c) => (c ? { ...c, avatarUrl: p.avatarUrl } : c));
      setDraft((c) => (c ? { ...c, avatarUrl: p.avatarUrl } : c));
    } catch (e) { setError((e as Error).message); setPreview(null); }
    finally { setUploading(false); }
  };

  const handleCalibrate = async (selfLevel: number | null) => {
    if (!token) return;
    setRatingBusy(true);
    try {
      setRating(await api.calibrateRating(selfLevel, token, ratingSport));
      setCalibrating(false);
    } finally { setRatingBusy(false); }
  };

  if (!ready || !token) return null;

  // Onglets réellement rendus — pas d'onglet mort.
  const tabs = PROFILE_TABS.filter((t) => {
    if (t.key === 'niveau') return club?.levelSystemEnabled !== false;
    if (t.key === 'portefeuille') return !!(slug && isMember);
    return true;
  });
  // Un ?tab= visant un onglet absent sur cet hôte retombe sur Identité.
  const activeTab: ProfileTabKey = tabs.some((t) => t.key === tab) ? tab : 'identite';

  const changeTab = (k: ProfileTabKey) => {
    setTab(k);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', k);
    window.history.replaceState(null, '', url.toString());
  };

  const avatarSrc = preview ?? assetUrl(draft?.avatarUrl ?? null);
  const initials = draft ? `${draft.firstName[0] ?? ''}${draft.lastName[0] ?? ''}`.toUpperCase() : '…';

  return (
    <Screen>
      <div style={{ paddingBottom: 48 }}>
        {slug && club ? (
          <ClubNav club={club} />
        ) : (
          <div style={{ padding: '28px 20px 6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <BackButton href="/clubs" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ThemeToggle />
                <ProfileMenu />
              </div>
            </div>
          </div>
        )}

        <div style={{ padding: '18px 20px 0', fontFamily: th.fontDisplay, fontWeight: 500, fontSize: 38, lineHeight: 1.05, color: th.text, letterSpacing: -0.5 }}>
          Mon profil
        </div>

        {error && (
          <div style={{ margin: '14px 20px 0', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.onAccent, background: th.accent, borderRadius: 12, padding: '10px 14px' }}>
            {error}
          </div>
        )}

        {loading || !draft ? (
          <div style={{ padding: '24px 20px', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
        ) : (
          <div style={{ padding: '18px 20px 0' }}>
            <div className="sp-scroll-x" style={{ marginBottom: 18 }}>
              <PillTabs options={tabs.map((t) => ({ value: t.key, label: t.label }))} value={activeTab} onChange={changeTab} />
            </div>

            {activeTab === 'identite' && (
              <ProfileIdentity
                profile={draft} set={set} sports={sports}
                avatarSrc={avatarSrc} initials={initials} uploading={uploading}
                fileRef={fileRef} onPickAvatar={pickAvatar}
                licence={isMember ? licenceDraft : null} clubName={club?.name ?? null} onLicence={setLicence}
              />
            )}
            {activeTab === 'niveau' && (
              <ProfileLevel
                sports={sports} ratingSport={ratingSport} onRatingSport={setRatingSport}
                rating={rating} history={history} matchStats={matchStats} clubName={club?.name ?? null}
                calibrating={calibrating} ratingBusy={ratingBusy}
                onStartCalibrate={() => setCalibrating(true)} onCalibrate={handleCalibrate}
              />
            )}
            {activeTab === 'preferences' && <ProfilePreferences profile={draft} set={set} />}
            {activeTab === 'portefeuille' && slug && (
              <ProfileWallet slug={slug} token={token} packages={walletPackages} subscriptions={walletSubs} payments={payments} />
            )}
            {activeTab === 'securite' && <ProfileSecurity token={token} />}

            <SaveBar dirty={dirty} saving={saving} error={saveError} saved={justSaved} onSave={save} onCancel={cancel} />
          </div>
        )}
      </div>
    </Screen>
  );
}
```

- [ ] **Step 4 : Lancer la suite pour vérifier qu'elle passe**

```bash
cd frontend && node node_modules/jest/bin/jest.js __tests__/MeProfile.test.tsx
```

Attendu : PASS, 28 tests (24 onglets/SaveBar + 4 licence).

- [ ] **Step 5 : Commit**

```bash
git add frontend/app/me/profile/page.tsx frontend/__tests__/MeProfile.test.tsx
git commit -m "feat(profil): 5 onglets + SaveBar unique (profil + licence), fin des 3 regimes d'enregistrement"
```

---

## Task 6 : Supprimer ProfileSectionNav (code mort)

**Files:**
- Delete: `frontend/components/profile/ProfileSectionNav.tsx`
- Delete: `frontend/__tests__/ProfileSectionNav.test.tsx`

- [ ] **Step 1 : Vérifier que plus personne ne l'importe**

```bash
cd frontend && grep -rn "ProfileSectionNav\|profile-anchor" --include=*.tsx --include=*.ts --include=*.css .
```

Attendu : uniquement `components/profile/ProfileSectionNav.tsx` et `__tests__/ProfileSectionNav.test.tsx`. Si `app/me/profile/page.tsx` apparaît encore, la Task 5 est incomplète — corrige-la avant de continuer.

- [ ] **Step 2 : Supprimer**

```bash
cd frontend && git rm components/profile/ProfileSectionNav.tsx __tests__/ProfileSectionNav.test.tsx
```

- [ ] **Step 3 : Vérifier qu'aucune suite ne casse**

```bash
cd frontend && node node_modules/jest/bin/jest.js __tests__/MeProfile.test.tsx
```

Attendu : PASS, 28 tests.

> Les stubs `IntersectionObserver` / `ResizeObserver` de `jest.setup.ts` **restent** — d'autres composants s'en servent. Ne les touche pas.

- [ ] **Step 4 : Commit**

```bash
git commit -m "chore(profil): retire ProfileSectionNav, remplacee par les onglets"
```

---

## Task 7 : Backend — le lien des emails vise l'onglet Préférences

**Files:**
- Modify: `backend/src/email/registry.ts:86`
- Test: `backend/src/email/__tests__/registry.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Dans `backend/src/email/__tests__/registry.test.ts`, dans le `describe('brandFromClub — coordonnées & manageUrl')`, ajoute après le cas existant qui vérifie `toContain('/me/profile')` :

```ts
  it('manageUrl vise l’onglet Préférences (le lien « Gérer mes notifications » y atterrit)', () => {
    const b = brandFromClub({ slug: 'arena', name: 'Arena', accentColor: '#123456', logoUrl: null } as never);
    expect(b.manageUrl).toContain('/me/profile?tab=preferences');
  });
```

> Adapte l'objet passé à `brandFromClub` sur celui du cas voisin (ligne ~223) — reprends-le à l'identique en ne changeant que l'assertion.

- [ ] **Step 2 : Lancer pour vérifier l'échec**

```bash
cd backend && node node_modules/jest/bin/jest.js src/email/__tests__/registry.test.ts -t "onglet Préférences"
```

Attendu : FAIL — reçu `.../me/profile`, attendu contenant `/me/profile?tab=preferences`.

- [ ] **Step 3 : Implémenter**

Dans `backend/src/email/registry.ts`, ligne 86 :

```ts
    manageUrl: club.slug ? clubAppUrl(club.slug, '/me/profile') : null,
```

devient :

```ts
    // Vise l'onglet Préférences : la page profil est en onglets, le défaut est Identité.
    manageUrl: club.slug ? clubAppUrl(club.slug, '/me/profile?tab=preferences') : null,
```

- [ ] **Step 4 : Lancer les tests email**

```bash
cd backend && node node_modules/jest/bin/jest.js src/email
```

Attendu : PASS — le nouveau cas, l'ancien (`toContain('/me/profile')`, toujours vrai) et `layout.test.ts` verts.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/email/registry.ts backend/src/email/__tests__/registry.test.ts
git commit -m "fix(emails): « Gerer mes notifications » vise l'onglet Preferences du profil"
```

---

## Task 8 : Filets de vérification

- [ ] **Step 1 : Type-check (gate séparé — jest ne type-check pas)**

```bash
cd frontend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -E "me/profile|components/profile|lib/meProfile|components/ui/SaveBar" || echo "OK: aucune erreur sur nos fichiers"
```

Attendu : `OK: aucune erreur sur nos fichiers`. On filtre sur nos chemins : du travail parallèle est en cours sur le repo et peut produire d'autres erreurs qui ne nous concernent pas.

- [ ] **Step 2 : Suites touchées**

```bash
cd frontend && node node_modules/jest/bin/jest.js __tests__/meProfile.test.ts __tests__/MeProfile.test.tsx __tests__/AdminSettings
cd ../backend && node node_modules/jest/bin/jest.js src/email
```

Attendu : tout vert. `AdminSettings` prouve que le déplacement de la `SaveBar` n'a rien cassé.

- [ ] **Step 3 : Vérification visuelle**

Lance la stack (`start.ps1` depuis la racine), puis via la skill `verify` :

- `/me/profile` sur l'hôte club (`padel-arena-paris.localhost:3000`) **et** sur l'hôte plateforme (`localhost:3000`) ;
- thème clair **et** sombre ;
- desktop 1280 **et** mobile 390 — ⚠️ en émulation, `mobile:true` ajuste automatiquement le viewport et **masque** un vrai débordement à 390 px : utilise `mobile:false` + largeur fixe 390.

À contrôler : les onglets passent à la ligne sans débordement horizontal ; la barre sticky est lisible dans les deux thèmes ; l'onglet Portefeuille est absent sur l'hôte plateforme ; aucun sélecteur de thème dans Préférences, mais le `ThemeToggle` est bien dans l'en-tête.

- [ ] **Step 4 : Mettre à jour CLAUDE.md**

Ajoute une entrée sous la section « Icône & menu profil », dans le style des évolutions existantes : périmètre, mécanique (baseline/brouillon, `buildProfileBody` source de vérité, deux ressources), retrait de `ProfileSectionNav` et du thème, la ligne backend `manageUrl`, les fichiers, les tests, et le lien vers spec + plan.

- [ ] **Step 5 : Commit**

```bash
git add CLAUDE.md
git commit -m "docs: profil en onglets + enregistrement differe"
```

---

## Self-review du plan

**Couverture de la spec :**

| Exigence | Task |
|---|---|
| Double état, `buildProfileBody` source de vérité, `isDirty` | 1, 5 |
| Deux normalisations (`preferredSport` → id, `birthDate` ISO → `YYYY-MM-DD`) | 1 (tests + impl) |
| Licence = 2ᵉ ressource, une seule barre, échecs indépendants | 1 (`licenceDirty`), 5 |
| Ne jamais reposer le brouillon au succès | 5 (impl + test de régression) |
| `cancel()` sans réseau | 5 |
| Garde `beforeunload` | 5 |
| Deux canaux d'erreur | 5 |
| Avatar hors brouillon (patch d'un seul champ) | 5 (impl + 2 tests) |
| Actions hors barre (mot de passe, suppression) | 4 (`ProfileSecurity`), 5 (test) |
| 5 onglets, `?tab=`, onglets dynamiques | 1, 5 |
| Thème retiré de la carte | 4 (`ProfilePreferences`), 5 (test) |
| `SaveBar` déplacée dans `components/ui` | 2 |
| `ProfileSectionNav` supprimée | 6 |
| `manageUrl` → `?tab=preferences` | 7 |
| `tsc --noEmit`, CDP clair/sombre 1280+390 | 8 |

**Cohérence des types :** `SetProfileField` (Task 3) est utilisé tel quel en Tasks 4 et 5. `ProfileTabKey` / `PROFILE_TABS` / `parseProfileTab` / `buildProfileBody` / `isDirty` / `licenceDirty` (Task 1) sont consommés en Task 5 avec les mêmes signatures. `ProfileTabProps` (`{ profile, set }`) est étendu par `ProfileIdentity`, utilisé nu par `ProfilePreferences`. `licence: string | null` côté `ProfileIdentity` correspond à `isMember ? licenceDraft : null` côté page.

**Écart assumé vs spec :** la spec nommait les états de licence `membershipServer` / `membershipDraft` ; le plan les nomme `licenceServer` / `licenceDraft` pour ne pas les confondre avec un objet `MyClubMembership`. Même mécanique.
