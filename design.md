# 🎨 Cascade — UI Redesign Instructions

This is a planning document, not a changelog entry — it does not describe work
already done. It exists to be handed to whoever (human or agent) implements the
redesign, so every page ends up sharing one visual system instead of each
component inventing its own colors and effects.

**Trigger.** The current UI works but reads as visually noisy and inconsistent:
heavy gradients, glowing/blurred halos, and looping ambient animation are
scattered across most pages, each added independently over time with no shared
token system. There is also no light theme at all — `client/index.html` hardcodes
`<html class="dark">` and every color in the app is a literal dark-mode value
(`bg-surface-950`, `text-white/60`, …), so a light theme cannot be bolted on
without a token layer underneath it first.

**Scope.** Visual redesign only — colors, surfaces, typography, spacing,
motion, and a light/dark theme toggle. No new routes, no new features, no
change to any component's props/behavior/data flow. A component that currently
renders a risk score as an animated gauge should still render a risk score;
it should just stop glowing while it does it.

---

## 0. Hard constraint: zero feature loss

**Every feature — including the smallest ones — must keep working exactly as
it does today.** This redesign changes what things look like, never what they
do. If applying a token or removing an animation would require touching a
`useState`, an event handler, a conditional render, an API call, or a prop —
stop and flag it instead of changing behavior to make the visual change
easier. The only JSX changes allowed are the ones needed to apply new class
names/tokens (e.g. swapping a `<div className="blur-xl animate-glow-pulse">`
wrapper for a plain `<span>`) — never a change to *what* renders or *when*.

**Concretely, this means preserved verbatim:**
- Every button, toggle, link, and keyboard shortcut still does exactly what
  it did before, in the same order, with the same confirmations/guards
- Every conditional render (empty states, loading states, error states,
  disabled states) still triggers under the same conditions
- Every API call, optimistic update, and rollback-on-failure path is untouched
- Every prop signature and exported function signature is untouched, so no
  other file needs to change to accommodate this one

**Feature inventory to regression-test against** (not exhaustive by design —
if it's not on this list, that's a gap in this list, not permission to drop
it; when in doubt, check `changes.md` and `suggestions.md` for the full
history before touching a component):

| Area | Features that must still work |
|---|---|
| Task creation | Natural-language input → 15-agent pipeline; live SSE agent trace; deadline picker (or AI-inferred); Calendar-sync checkbox; Resource Mode toggle (With Links / Info Only); Manual Todo Mode builder (`/projects/new/manual`) — modules, inline "+Add subtask", running total-hours footer |
| Dashboard | Stat tiles (Active/At Risk/Overdue/Done); filter tabs (all/active/at risk/completed/overdue); Morning Briefing "Generate Now"; API key banner + "Use own key"; Google Calendar connect/disconnect; Scheduling style (Day/Flexible/Night); Weekend scheduling (Skip/Light/Full/Heavy); Daily capacity stepper; per-project Archive (soft-delete) with confirm dialog; per-project Calendar Sync toggle; "✨ Let AI enhance this" on manual projects; resume banner for quota-interrupted pipelines |
| Onboarding | Shows only for zero-project + not-completed users; Next/Back navigation; direct dot-navigation to any slide; "Skip tour" (both the text link and the ✕ button); "Get Started" on the last slide; dismissal persists to Firestore and never re-shows after |
| Login | Google sign-in; "Use a different Google account" (forces account picker, silently ignores popup-cancel) |
| Project Workspace | All 7 tabs (Overview/Roadmap/Schedule/Resources/Analytics/Notes/Settings); Roadmap drag-to-reorder (grab handle only on modules with >1 task, order syncs to the Dashboard's "Continue Working" card too); Next Best Action card; Risk Meter; project-level markdown notes (edit/view toggle, XSS-safe links) |
| Task Workspace | Execution step list — Start/Pause/Complete/Skip/Mark blocked (with reason prompt); step-level markdown notes; Focus Mode ("Start Working") — real-time timer, pause/resume, marks step in-progress on open, reports real elapsed minutes on complete, over-estimate warning |
| Scheduling internals (no UI, but observable via schedule output) | Cross-project conflict detection; priority-weighted within-day ordering; historical pace calibration blending into time estimates; automatic missed-task reassignment (30-min sweep) + manual "Reschedule now" |
| Global | Breadcrumbs on every nested page; resource links render as inert text (not a dead link) when no confident URL exists; sign-out |

---

## 1. Current-state audit

**Pages:** `Login`, `Dashboard` (home), `ManualProjectBuilder`, `ProjectWorkspace`
(Overview/Roadmap/Schedule/Resources/Analytics/Notes/Settings tabs),
`TaskWorkspace` (+ `FocusMode` full-screen overlay).

**Shared component classes** (`client/src/index.css`), all hardcoded to dark
literals with zero light-mode path:
```css
.card         { @apply bg-surface-800 border border-white/5 rounded-xl; }
.btn-primary  { @apply bg-brand-500 hover:bg-brand-600 text-white ... active:scale-95; }
.btn-ghost    { @apply text-white/60 hover:text-white hover:bg-white/5 ...; }
.input-field  { @apply bg-surface-900 border border-white/10 text-white ...; }
.risk-badge   { @apply inline-flex ... rounded-full ...; }
.agent-step   { @apply flex items-start gap-3 p-3 rounded-lg border ...; }
```

**Every one of these files currently uses a gradient, a blur/glow halo, or a
looping/ambient animation** (`grep -rlE "bg-gradient-to|animate-(pulse|glow|float|slide|fade)|blur-"`):
`App.jsx`, `Header.jsx`, `Dashboard.jsx`, `ProjectCard.jsx`, `TaskInput.jsx`,
`AgentTrace.jsx`, `RoadmapTree.jsx`, `ExecutionStepItem.jsx`, `dailyBriefing.jsx`,
`Onboarding.jsx`, `Login.jsx`, `ProjectWorkspace.jsx`, `TaskWorkspace.jsx`.
That's effectively the entire app — this is a full pass, not a spot-fix.

**Worst offender to use as the running example:** `Onboarding.jsx` (just
redesigned in the previous session) — per-slide glowing `blur-xl
animate-glow-pulse` icon halos, `animate-float` bobbing badges, two blurred
ambient gradient orbs behind the modal, and a gradient progress bar. It is a
good stress-test for this doc: everything in §5 below that's on the deny-list
is demonstrated somewhere in that one file.

---

## 2. Design principles (from the brief, made concrete)

| Brief says | Concrete rule |
|---|---|
| "UI is not good" | Replace ad-hoc per-component colors with one shared token system (§3) used everywhere. |
| "UI remains same for all pages" | Every page is built only from the shared tokens + shared component classes in §6. No page defines its own one-off `bg-[#...]`, gradient, or shadow. |
| "Modern" | Flat surfaces, hairline 1px borders, generous whitespace, restrained type scale. Not skeuomorphic, not neon. |
| "Not too much animation and glowing" | See the animation allow/deny list in §5. Ambient/looping/decorative animation is removed entirely. Functional transitions (hover, focus, open/close) stay, capped at 150–200ms. |
| "Minimal gradients" | Exactly **one** approved gradient in the whole app (§3.4), reserved for the primary brand mark and the primary CTA button. Nowhere else. |
| "Light dark kind of background" | Neither theme uses a pure extreme. Dark mode's base is a soft dark slate (`#14161a`), not near-black. Light mode's base is a soft off-white (`#f5f6f8`), not `#ffffff`. See §3.1. |
| "Dark and light theme mode" | Full token-driven theme system, user-toggleable, persisted, defaulting to OS preference. See §4. |

---

## 3. Design tokens

All colors are defined once, as CSS custom properties, and consumed through
Tailwind via `rgb(var(--token) / <alpha-value>)` so existing opacity-modifier
syntax (`bg-surface/50`, `text-primary/60`, etc.) keeps working unchanged.

### 3.1 Surface & text (the "light dark" requirement lives here)

| Token | Light value | Dark value | Used for |
|---|---|---|---|
| `--bg-base` | `245 246 248` (`#f5f6f8`) | `20 22 26` (`#14161a`) | Page background |
| `--bg-surface` | `255 255 255` (`#ffffff`) | `26 29 35` (`#1a1d23`) | Cards, panels |
| `--bg-elevated` | `255 255 255` + border | `32 36 43` (`#20242b`) | Modals, dropdowns, popovers |
| `--border` | `15 17 21 / 0.08` | `255 255 255 / 0.08` | All hairline borders |
| `--text-primary` | `17 19 23` (`#111317`) | `232 233 238` (`#e8e9ee`) | Headings, primary text |
| `--text-secondary` | `17 19 23 / 0.65` | `232 233 238 / 0.62` | Body/secondary text |
| `--text-muted` | `17 19 23 / 0.4` | `232 233 238 / 0.35` | Captions, placeholders |

Neither background is a pure `#000`/`#fff` extreme in either mode — that's the
literal implementation of "light dark kind of background." The dark base
(`#14161a`) is deliberately several steps lighter than the current
`surface-950` (`#07080f`), which reads as near-black on most monitors.

### 3.2 Brand accent

Keep the existing brand hue (already establishes the app's identity) but use
it **sparingly** — primary actions and active/selected states only, never as a
card background or a decorative wash.

| Token | Value | Used for |
|---|---|---|
| `--brand-400` | `129 140 248` (`#818cf8`) | Hover state on brand-colored text/icons |
| `--brand-500` | `99 102 241` (`#6366f1`) | Primary buttons, active tab underline, focus ring |
| `--brand-600` | `79 70 229` (`#4f46e5`) | Primary button hover |

These stay the same literal values in both themes — an accent color that
doesn't shift between light/dark keeps brand recognition consistent, only the
surfaces around it change.

### 3.3 Status colors (unchanged between themes, used sparingly)

| Token | Value | Used for |
|---|---|---|
| `--success` | `16 185 129` (`#10b981`) | Completed, on-track, connected states |
| `--warning` | `245 158 11` (`#f59e0b`) | At-risk, medium priority |
| `--danger` | `244 63 94` (`#f43f5e`) | Overdue, critical, destructive actions |
| `--info` | `14 165 233` (`#0ea5e9`) | Informational badges |

Rule: status color appears as a small dot, a thin left-border accent, or text
color — never as a full-saturation background fill. A risk badge is a colored
dot + neutral-background text, not a colored pill.

### 3.4 The one approved gradient

```css
--gradient-brand: linear-gradient(135deg, rgb(var(--brand-500)), rgb(var(--brand-600)));
```

Used in exactly two places in the entire app: the logo mark (⚡ icon in the
header) and the primary CTA button's background (`.btn-primary`). Every other
gradient currently in the codebase (ambient orbs, progress bars, icon badges,
risk meters, card headers) is removed and replaced with a flat token color.

### 3.5 Shape & elevation

| Token | Value |
|---|---|
| `--radius-sm` | `8px` — inputs, small buttons, badges |
| `--radius-md` | `12px` — cards |
| `--radius-lg` | `16px` — modals |
| `--shadow-elevated` | `0 4px 20px rgb(0 0 0 / 0.10)` (dark: `/ 0.35`) — modals/dropdowns only |

No shadow on cards or buttons in their resting state — flat surfaces
distinguished by the 1px `--border` token, not by drop shadow. Shadow is
reserved for things that visually float above the page (modals, dropdown
menus, the Focus Mode overlay).

### 3.6 Typography

Keep the existing font stack (Inter / JetBrains Mono — no change, no new
font). Formalize the scale already implicit in the app:

| Role | Size | Weight |
|---|---|---|
| Page title | 22–24px | 700 |
| Section header | 16–18px | 600 |
| Body | 14px | 400–500 |
| Secondary/caption | 12–13px | 400 |
| Micro (badges, timestamps) | 11px | 500–600 |

---

## 4. Theme system

- **Mechanism:** `data-theme="light"` / `data-theme="dark"` attribute on
  `<html>`, not the current hardcoded `class="dark"`. Tailwind config sets
  `darkMode: ['selector', '[data-theme="dark"]']` (Tailwind v3.4+) so `dark:`
  variants keep working for any one-off cases, while the token layer in §3
  does the heavy lifting for everything else.
- **Default:** on first visit, resolve from `window.matchMedia('(prefers-color-scheme: dark)')`.
  After that, respect an explicit user choice.
- **Persistence:** store the resolved choice in `localStorage` (e.g.
  `cascade-theme`), read it before first paint (inline script in
  `index.html`, before the stylesheet/app loads) to avoid a flash of the
  wrong theme.
- **Toggle UI:** a sun/moon icon button in `Header.jsx`, next to the existing
  "Sign out" control. Three-state is unnecessary — light/dark toggle is
  enough; "system" is just "whatever `prefers-color-scheme` resolved to
  before the user overrode it."
- **State home:** a small `ThemeContext` (mirrors the existing `AuthContext`
  pattern already in the codebase) — `{ theme, toggleTheme }` — rather than
  prop-drilling through every page.

---

## 5. Animation policy

**Allowed** (functional, short, non-looping):
- Hover/focus color and background transitions, 100–150ms
- Open/close transitions on modals, dropdowns, the Onboarding overlay — a
  single fade or fade+8px-translate, ≤200ms, once per open/close event
- Loading spinners (the existing `⚡` spin used during "Initialising…")
- Progress bars that reflect real progress (width transition on value change,
  not a decorative shimmer)
- The blinking terminal cursor in `AgentTrace` (it's communicating "live
  input," which is functional, not decorative)

**Removed — replace with a static equivalent:**
- `animate-pulse-slow` / `animate-glow-pulse` glow halos behind icons
  (`Onboarding.jsx`'s `IconBadge`, any risk-meter glow) → flat icon in a flat
  circular chip, no blur
- `animate-float` bobbing elements → static position
- Blurred ambient background orbs (`Onboarding.jsx`'s two `blur-[100px]`
  divs) → removed entirely; the modal sits on the flat `--bg-elevated` surface
- Shimmer-sweep effects (`AgentTrace`'s live-border shimmer, if decorative
  rather than status-indicating) → a plain 1–2px solid accent border while
  active, no motion
- `active:scale-95` on buttons → keep only if it reads as "modern tactile
  feedback" is desired; otherwise drop in favor of a background-color shift
  only. Either is acceptable — scale is optional, glow is not.

**Rule of thumb:** if an animation runs continuously while the user is doing
nothing (breathing glow, floating icon, shimmer sweep), remove it. If it runs
once in response to a user action or a real state change, keep it and cap it
at ~200ms.

---

## 6. Shared component classes (replace `client/src/index.css` `@layer components`)

```css
.card {
  @apply bg-surface border border-border rounded-lg;
  /* no shadow at rest */
}

.btn-primary {
  @apply text-white font-medium px-4 py-2 rounded-md transition-colors duration-150
         disabled:opacity-40 disabled:cursor-not-allowed;
  background: var(--gradient-brand);
}
.btn-primary:hover { filter: brightness(1.08); }

.btn-ghost {
  @apply text-secondary hover:text-primary hover:bg-surface-hover
         font-medium px-4 py-2 rounded-md transition-colors duration-150;
}

.input-field {
  @apply w-full bg-surface border border-border rounded-md px-4 py-3
         text-primary placeholder:text-muted
         focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500
         transition-colors duration-150;
}

.badge {
  @apply inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium
         bg-surface-hover text-secondary;
  /* status color, if any, is the leading dot — not the badge background */
}

.agent-step {
  @apply flex items-start gap-3 p-3 rounded-md border border-border transition-colors duration-150;
}
```

(`bg-surface-hover` = a fourth surface token, ~4–6% white/black mix over
`--bg-surface`, for hover states without introducing a new hardcoded color
per component.)

---

## 7. Page-by-page pass

Work through pages in this order — each one only depends on §3–§6 being in
place first, not on each other, so they can land as separate PRs/commits.
**After each page, re-check every §0 feature that lives on it before moving
to the next one** — catching a dropped handler immediately, on the page that
broke it, is far cheaper than finding it at the end of the whole pass.

1. **Global infra** — `tailwind.config.js` token wiring, `index.css` token
   definitions + component class rewrite, `ThemeContext`, theme toggle in
   `Header.jsx`, inline no-flash script in `index.html`.
2. **Login** — remove any gradient background wash; form card uses `.card` +
   `.input-field` as-is.
3. **Dashboard** — `ProjectCard` risk indicator becomes a flat colored dot +
   text, not a gradient/glow badge; stat tiles (Active/At Risk/Overdue/Done)
   go flat-background + colored icon, no glow.
4. **Onboarding** — the concrete worked example: drop the glow-pulse icon
   halos, the floating animation, and the two blurred ambient orbs; keep the
   per-slide accent *color* (it's a reasonable way to differentiate slides)
   but express it as a flat icon chip + a thin accent-colored progress bar
   segment, not a glow. Keep the directional slide transition (functional,
   one-shot, ≤200ms) — that one's fine as-is.
5. **ProjectWorkspace** (all 7 tabs) — `RiskMeter` becomes a flat arc/ring in
   a status color, no glow; `RoadmapTree` progress bars go flat brand-colored
   fill, no gradient.
6. **TaskWorkspace + FocusMode** — timer display, execution step cards,
   markdown notes rendering — verify all read correctly against both the
   light and dark surface tokens (the markdown code-span background in
   particular, currently a hardcoded `bg-white/10`).
7. **Remaining shared components** — `AgentTrace`, `dailyBriefing`,
   `TaskInput`, `SchedulePreferences`, `CalendarConnect`/`CalendarSyncToggle`,
   `ResourceLink`, `Breadcrumbs`.

---

## 8. Definition of done

- [ ] Every feature in the §0 inventory still works, unchanged, on every page
      that was touched — verified by actually exercising it (click it, drag
      it, complete it), not just by reading the diff
- [ ] The diff for each touched file is class-name/style changes only — no
      handler, state, prop, or conditional-logic changes beyond what was
      strictly required to apply the new visual system (e.g. removing a
      wrapper `<div>` that existed only to hold a glow effect is fine;
      changing what that div's sibling does on click is not)
- [ ] Every page/component renders correctly in **both** themes with no
      manual per-component light/dark override needed beyond the token layer
- [ ] Theme choice persists across a full page reload with no flash of the
      wrong theme
- [ ] Zero hardcoded `text-white`, `bg-surface-950`, `border-white/…` literals
      remain outside the token definitions themselves (`grep` for these
      should return nothing outside `index.css`/`tailwind.config.js`)
- [ ] Exactly one gradient exists in the codebase (`--gradient-brand`),
      used in exactly two places
- [ ] No `animate-pulse-slow`, `animate-glow-pulse`, `animate-float`, or
      ambient blurred-orb divs remain anywhere
- [ ] Text/background contrast passes WCAG AA (4.5:1 for body text) in both
      themes — spot-check `--text-secondary`/`--text-muted` against
      `--bg-surface` in each mode, since these are the values most likely to
      drift out of range
- [ ] `npm run build` (client) and `npm test` (server, unaffected by this
      change but should stay green) both pass
