# Sidebar admin sans scrollbar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every link in the admin sidebar (`frontend/app/admin/layout.tsx`) visible without a vertical scrollbar, by making its vertical spacing shrink fluidly with window height instead of staying fixed.

**Architecture:** Single-file change. Every fixed vertical `padding`/`marginTop`/`gap` value inside the `<aside>` nav is replaced with a CSS `clamp(min, preferred, max)` expression driven by `vh` (viewport height), so density degrades continuously as the window gets shorter. On tall windows the clamp hits its max and looks byte-identical to today. `overflowY: 'auto'` on the `<nav>` stays as a last-resort fallback.

**Tech Stack:** Next.js 16 / React 19, inline styles (no CSS modules/Tailwind in this file), Jest + React Testing Library for the existing regression suite, Chrome DevTools Protocol (via the `verify` skill) for visual confirmation since jsdom does not compute `clamp()`.

---

## Context for the engineer

- File under change: `frontend/app/admin/layout.tsx`. It renders the admin back-office sidebar: a logo/identity row, a `<nav>` of grouped links (`visibleSections.map(...)`), and a footer with `ThemeToggle`/`ProfileMenu`.
- With the admin role fully expanded, the nav shows **21 links across 5 titled sections** (+ a top-level "Tableau de bord" link outside any section) plus a "Tout replier" toggle line. Today's fixed spacing makes this taller than ~1050px, so `overflowY: 'auto'` on `<nav>` kicks in on most screens.
- There is no dedicated CSS file for this component — everything is inline `style={{ ... }}` objects, which is the existing pattern in this file. Follow it; do not introduce a stylesheet or CSS module here.
- `1vh` = 1% of the browser viewport height. At a window height of 800px, `1vh = 8px`.
- CSS `clamp(MIN, PREFERRED, MAX)` accepts a bare arithmetic expression for the preferred value (mixing `vh` and `px` with `+`/`-`) without needing an explicit `calc()` wrapper — this is valid modern CSS and is what Chrome (used by the app and by CDP verification) implements.
- Existing regression test: `frontend/__tests__/AdminLayout.test.tsx`. It does **not** assert on style values (jsdom can't compute `clamp()`), so it only needs to still pass — it's a regression guard, not new coverage for this change.
- Known pitfall (see project memory `broken-node-modules-bin-shims`): `npx jest` / `npx tsc` can fail with "not recognized" on this machine. Always invoke Jest as `node node_modules/jest/bin/jest.js` from the `frontend/` directory. Also (memory `frontend-jest-no-typecheck`): Jest running a file path as a pattern can catch unintended files — use `--runTestsByPath` with the exact relative path to target one file precisely.
- Known pitfall (project memory `verify-mobile-overflow-emulation`): irrelevant here (desktop-only change), but when using the `verify` skill, request a **fixed viewport size**, not device emulation, so the two exact heights (800px, 950px) are actually what gets rendered.

---

### Task 1: Baseline check — confirm the existing suite is green before editing

**Files:**
- Test: `frontend/__tests__/AdminLayout.test.tsx` (read-only in this task)

- [ ] **Step 1: Run the AdminLayout test suite as-is**

Run (from `frontend/`):
```bash
cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AdminLayout.test.tsx
```
Expected: all tests in the file PASS. This is the baseline — if it's already red, stop and investigate before touching `layout.tsx` (a failure here is unrelated to this plan and must not be silently inherited).

- [ ] **Step 2: No commit for this task** (read-only verification, nothing to commit).

---

### Task 2: Apply fluid `clamp()` spacing to the sidebar

**Files:**
- Modify: `frontend/app/admin/layout.tsx`

Six edits, all inside the `AdminLayout` component. Apply them in order (line numbers below are from the pre-edit file and will shift after the first edit — locate each block by its unique surrounding code, not by line number).

- [ ] **Step 1: `sectionHeaderStyle` — shrink vertical padding of section titles**

Find (around line 221):
```tsx
  const sectionHeaderStyle = {
    fontFamily: th.fontUI, fontSize: 11, fontWeight: 600, letterSpacing: 0.6,
    textTransform: 'uppercase' as const, color: th.textFaint, padding: '6px 10px 6px',
  };
```

Replace with:
```tsx
  const sectionHeaderStyle = {
    fontFamily: th.fontUI, fontSize: 11, fontWeight: 600, letterSpacing: 0.6,
    textTransform: 'uppercase' as const, color: th.textFaint, padding: 'clamp(2px, 1vh - 4px, 6px) 10px',
  };
```

- [ ] **Step 2: `<aside>` — shrink its own vertical padding**

Find (around line 231):
```tsx
      <aside style={{
        position: 'sticky', top: 0, alignSelf: 'flex-start', height: '100vh',
        width: 244, flexShrink: 0, boxSizing: 'border-box',
        background: th.bgElev, borderRight: `1px solid ${th.line}`,
        display: 'flex', flexDirection: 'column', padding: '20px 14px',
      }}>
```

Replace with:
```tsx
      <aside style={{
        position: 'sticky', top: 0, alignSelf: 'flex-start', height: '100vh',
        width: 244, flexShrink: 0, boxSizing: 'border-box',
        background: th.bgElev, borderRight: `1px solid ${th.line}`,
        display: 'flex', flexDirection: 'column', padding: 'clamp(10px, 2vh - 4px, 20px) 14px',
      }}>
```

- [ ] **Step 3: `<nav>` — reduce fixed gap, shrink top margin**

Find (around line 272):
```tsx
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 3, overflowY: 'auto', marginTop: 10 }}>
```

Replace with:
```tsx
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', marginTop: 'clamp(4px, 1vh - 2px, 10px)' }}>
```

- [ ] **Step 4: Section title button — shrink the gap above non-first sections**

Find (around line 282-289, inside the `sec.title && (...)` block):
```tsx
                    style={{
                      ...sectionHeaderStyle, marginTop: i === 0 ? 0 : 12,
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                      background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
                    }}>
```

Replace with:
```tsx
                    style={{
                      ...sectionHeaderStyle, marginTop: i === 0 ? 0 : 'clamp(3px, 2vh - 13px, 12px)',
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                      background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
                    }}>
```

- [ ] **Step 5: Nav links — shrink vertical padding of each `<Link>`**

Find (around line 298-303):
```tsx
                    <Link key={l.href} href={l.href} style={{
                      display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderRadius: 11, textDecoration: 'none',
                      fontFamily: th.fontUI, fontSize: 14, fontWeight: active ? 700 : 500,
                      background: active ? th.surface2 : 'transparent',
                      color: active ? th.text : th.textMute,
                    }}>
```

Replace with:
```tsx
                    <Link key={l.href} href={l.href} style={{
                      display: 'flex', alignItems: 'center', gap: 11, padding: 'clamp(2px, 2vh - 15px, 9px) 12px', borderRadius: 11, textDecoration: 'none',
                      fontFamily: th.fontUI, fontSize: 14, fontWeight: active ? 700 : 500,
                      background: active ? th.surface2 : 'transparent',
                      color: active ? th.text : th.textMute,
                    }}>
```

- [ ] **Step 6: Footer row (ThemeToggle/ProfileMenu) — shrink top padding**

Find (around line 321):
```tsx
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingTop: 16, borderTop: `1px solid ${th.line}` }}>
```

Replace with:
```tsx
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingTop: 'clamp(8px, 2vh - 8px, 16px)', borderTop: `1px solid ${th.line}` }}>
```

- [ ] **Step 7: Sanity-check the file compiles**

Run (from `frontend/`):
```bash
cd frontend && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```
Expected: no new errors referencing `app/admin/layout.tsx` (pre-existing unrelated errors elsewhere in the repo, if any, are not this task's concern — only confirm nothing new appears for this file).

- [ ] **Step 8: Commit**

```bash
git add frontend/app/admin/layout.tsx
git commit -m "$(cat <<'EOF'
feat(admin): sidebar sans scrollbar (densite adaptative clamp/vh)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Regression check — confirm the existing suite still passes

**Files:**
- Test: `frontend/__tests__/AdminLayout.test.tsx` (read-only in this task)

- [ ] **Step 1: Run the AdminLayout test suite again**

Run (from `frontend/`):
```bash
cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AdminLayout.test.tsx
```
Expected: same PASS result as Task 1's baseline. If a test that was green in Task 1 is now red, the edit broke something — inspect the diff from Task 2 (a stray removed prop, an unbalanced `{{ }}`, etc.) before continuing.

- [ ] **Step 2: No commit for this task** (verification only, nothing new to commit).

---

### Task 4: Visual verification via CDP

**Purpose:** `clamp()` cannot be evaluated by jsdom, so this is the actual acceptance check for the spec's success criterion: *no vertical scrollbar in the admin nav at ~800px window height, with today's density preserved at normal window heights (~950px+).*

**Files:** none (verification only — do not edit files in this task unless a failure requires iterating on Task 2's constants, see Step 5 below)

- [ ] **Step 1: Ensure the dev stack is running**

Follow the startup steps in the project's root `CLAUDE.md` (`docker-compose-v1.exe up -d`, backend `npm run dev` on :3001, frontend `npm run dev` on :3000) if not already running. Log in as a full admin (e.g. `owner@palova.fr` / `password123`, per project memory `roles-audit-decisions` seed accounts) so all 21 links + 5 sections render — a STAFF or partial-ADMIN account will show fewer links and won't exercise the worst case.

- [ ] **Step 2: Invoke the `verify` skill for the tall case**

Use the `Skill` tool with `skill: "verify"`, targeting the admin dashboard (`/admin`) at a **fixed** (non-emulated) viewport of **1280×950**, light theme first, then dark theme. This should look visually identical to before the change (spacing at its `clamp()` max).

- [ ] **Step 3: Invoke the `verify` skill for the short case**

Same page, fixed viewport **1280×800**, light then dark. In the resulting screenshot/DOM inspection, confirm:
- Every section and every link is visible without needing to scroll the `<nav>` (i.e. all 21 links + 5 section titles + "Tableau de bord" + "Tout replier" fit between the identity row and the footer).
- No vertical scrollbar is rendered inside the `<nav>` element (check via CDP: `document.querySelector('nav').scrollHeight <= document.querySelector('nav').clientHeight`, or visually confirm no scrollbar track is drawn).
- Text remains legible (font sizes untouched — only whitespace shrank).

- [ ] **Step 4: Confirm nothing else regressed**

While the CDP session is open, also check: the "Tout replier"/"Tout déplier" toggle line still reads correctly, the identity row (logo + eye icon + collapse chevron) is unaffected, and the footer (ThemeToggle + ProfileMenu) still sits at the bottom with a visible top border. These rows were not touched by Task 2 beyond the footer's `paddingTop`, so this is a quick visual sanity pass, not a deep audit.

- [ ] **Step 5: If a scrollbar is still present at 1280×800**

The clamp constants in the spec are starting values, not exact guarantees for every possible content length. If the nav still overflows at 800px height:
1. Re-open `frontend/app/admin/layout.tsx`.
2. Tighten the `MIN` bound (third→first argument) on the link padding first (Task 2 Step 5) — it's applied 21 times and has the largest total impact — e.g. drop `clamp(2px, 2vh - 15px, 9px)` to `clamp(1px, 2vh - 15px, 9px)` or increase the subtracted constant (`2vh - 15px` → `2vh - 16px`) to reach the target sooner.
3. Re-run Task 2 Step 7 (tsc) and Task 3 (Jest) after any further edit, then repeat Step 3 of this task.
4. Once the 800px case is scrollbar-free and the 950px case still matches the original density, amend the Task 2 commit is **not** required — make a small follow-up commit instead (`git commit -m "fix(admin): tighten sidebar clamp constants"`), since Task 2's commit already landed in Task 2.

- [ ] **Step 6: No commit for this task** unless Step 5's iteration produced a follow-up commit (already described above).

---

## Self-review notes (from plan authoring)

- Spec coverage: all 7 spacing rows from the spec's table are covered — 6 edits in Task 2 (nav `gap`+`marginTop` are combined into a single edit since they're on the same line).
- The spec's "may be adjusted at implementation time" escape hatch is captured explicitly in Task 4 Step 5 rather than left as an unquantified TODO.
- No new automated test is added, matching the spec's explicit call-out that jsdom can't compute `clamp()` — Tasks 1 and 3 exist purely to bound the regression risk on the *existing* suite.
