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


---

## 9. Supplementary design rules (adopted from Cascade UI Redesign Complete Specification)

The sections below are additive — they do not change anything defined in §0–§8 above. They address structural and information-architecture problems that the token/animation pass alone cannot fix, and they are the primary reason the current UI reads as AI-generated rather than as a real shipped product.

**Implementation order:** complete §7's page-by-page token pass first, then layer in §9's structural changes on top of the already-tokenised components.

---

### 9.1 Product design direction — what "not AI-generated" means concretely

The current interface contains the right functionality but presents too many elements with **equal visual weight**. Every section — stat tiles, task input, scheduling preferences, calendar connection, API key — floats as its own independent card with its own header, border, and internal padding. Real productivity tools establish a clear dominant action and push monitoring/status to the periphery.

| Current tendency | Required redesign direction |
|---|---|
| Many independent rounded cards | Fewer cohesive surfaces; use sections, spacing, and dividers *within* a surface |
| Purple/glowing AI aesthetic | Restrained indigo accent used only for actions and selected states |
| Emoji-heavy iconography in UI chrome | One consistent stroke-based icon set; emoji only in user-authored content |
| Settings-like task controls scattered separately | Unified Planning Parameters area attached directly to the task goal |
| Every section has equal visual weight | Typography, alignment, and whitespace become the primary hierarchy tools |
| Dashboard feels like a component showcase | Dashboard becomes a planning workspace first, monitoring workspace second |

> **Core rule:** do not remove information to make the UI minimal. Instead, group, prioritise, align, and visually quiet the information.

---

### 9.2 Token additions not covered in §3

Two tokens referenced in §6's component classes but not defined in §3:

| Token | Light value | Dark value | Used for |
|---|---|---|---|
| `--bg-surface-hover` | `17 19 23 / 0.04` | `255 255 255 / 0.05` | Hover state on interactive surfaces without introducing a new hardcoded color per component |
| `--border-strong` | `15 17 21 / 0.15` | `255 255 255 / 0.15` | Stronger hairline for hover states on interactive cards/scrollbar thumb (referenced via `var(--border-strong, ...)` in the scrollbar CSS below and in §9.11's `.card-interactive:hover`) |

Also: **scrollbar colors in `index.css`** are currently hardcoded (`#0d0f1a` track, `#2d3158` thumb). Replace with token values so light mode scrollbars are not dark:

```css
::-webkit-scrollbar-track  { background: rgb(var(--bg-base)); }
::-webkit-scrollbar-thumb  { background: rgb(var(--border-strong, var(--border))); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgb(var(--brand-500)); }
```

Also: the existing `class="dark"` on `<html>` in `index.html` **must be removed** when switching to the `data-theme` mechanism — leaving both in place causes a Tailwind `darkMode` specificity conflict.

---

### 9.3 Button state decisions (from §5 extension)

`design.md` §5 leaves `active:scale-95` as "either is acceptable." Make the decision explicit so it is applied consistently:

- **`.btn-primary`** — keep `active:scale-95`. The primary CTA benefits from tactile feedback.
- **`.btn-ghost`** — remove `active:scale-95`. Ghost buttons feel visually fragile when they scale; a background-color shift is sufficient.
- **All buttons** — add `focus-visible:ring-2 focus-visible:ring-brand-500/40` for keyboard accessibility. This is missing from the current codebase.

Updated shared class additions:

```css
.btn-primary:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgb(var(--brand-500) / 0.4);
}
.btn-ghost:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgb(var(--brand-500) / 0.4);
}
```

---

### 9.4 Iconography — replace UI-chrome emoji with a stroke icon set

`design.md` does not address iconography. The current codebase uses emoji extensively in UI controls: `⚡`, `📅`, `🏋️`, `⛔`, `🌅`, `☀️`, `🌙`, `⏱`, `✨`, `⠿`, etc. Mixing emoji, inline SVGs, and text symbols in the same control row is one of the clearest signals of an AI-generated interface.

**Rule:** Use one consistent stroke-based icon set (Lucide React is appropriate — it is compatible with the project's React 18 version and tree-shakes to zero unused icons). Emoji are permitted **only** in:
- User-authored content (notes, task names)
- The four onboarding slides (where they are decorative/illustrative, not functional controls)

**Dependency:** `lucide-react` is **not** currently in `client/package.json` — it must be added (`npm install lucide-react` inside `client/`) before this section can be implemented; it is not already available in the codebase.

**Application to existing components:**

| Component | Current emoji | Replace with |
|---|---|---|
| `Header.jsx` theme toggle | `☀️` / `🌙` | `<Sun>` / `<Moon>` from Lucide |
| `SchedulePreferences.jsx` | `☀️ Day`, `🌙 Night`, `🏋️ Weekend heavy`, `⛔ Skip`, `🌅 Light`, `📅 Full`, `⏱ Daily capacity` | Lucide `<Sun>`, `<Moon>`, `<Dumbbell>`, `<Ban>`, `<Sunrise>`, `<CalendarDays>`, `<Timer>` |
| `CalendarSyncToggle.jsx` | `📅` | `<Calendar>` |
| `TaskInput.jsx` | `📅 Sync to Google Calendar` | `<Calendar>` |
| `ProjectCard.jsx` | grab-handle `⠿` | `<GripVertical>` |
| `AgentTrace.jsx` spinner | `⚡` | retain (brand mark, acceptable) |
| Status dots | remain as `<span>` colored dots | no change needed |

Icon sizing: 16px for inline controls, 18px for section markers, 20–24px for standalone section icons.

---

### 9.5 Dashboard information hierarchy — plan first, monitor second

This is the single most impactful structural change for eliminating the AI-generated look.

**Current layout (everything equal weight):**
```
Stat tiles  |  Task input + scheduling controls
Calendar    |  API key panel
Project grid
```

**Required layout (dominant action at top, monitoring below):**
```
1. PLAN COMPOSER          ← the primary job the user came to do
   Goal input
   Planning Parameters
   Activate button
   
2. TODAY SUMMARY          ← compact, not dominant
   Active / At Risk / Overdue / Done (4 flat stat items, not 4 large cards)

3. TODAY'S FOCUS + MORNING BRIEFING

4. PROJECTS               ← monitoring, not primary
   Project cards grid

5. SYSTEM STATUS          ← only when relevant
   API quota / Calendar connection (collapsed by default unless action required)
```

**Visual treatment rules for the reordered dashboard:**
- Use **one Planning Surface** for the goal + all parameters, not six separate preference cards
- Stat tiles become a **compact inline row** (4 numbers with small labels), not 4 large bordered cards
- Project cards remain in a grid below the fold
- Calendar connection and API key panel become **collapsed panels** in System Status — expanded only when attention is needed (quota low, calendar disconnected)

**Zero behavioral change.** The same components, handlers, and API calls are used. This is a layout/ordering change only — no `useState` or prop changes required.

---

### 9.6 Unified Planning Surface — goal input + all planning parameters in one form

**Current problem:** `TaskInput.jsx` and `SchedulePreferences.jsx` are separate, disconnected components. A user setting up a new task must scroll between two unrelated-looking areas. This is the "settings page accidentally placed next to a task creator" pattern.

**Required structure — one cohesive form surface:**

```
CREATE PLAN
────────────────────────────────────────────────────────

GOAL
[ What do you want to accomplish?                      ]

PLANNING PARAMETERS

Deadline       [ Tomorrow · 12:00 PM ▾ ]
Calendar       [ ✓ Google Calendar synced ]
Scheduling     [ Day ]  [ Flexible ]  [ Night ]
Weekend        [ Skip ]  [ Light ]  [ Full ]  [ Heavy ]
Capacity       [ − ]  2 h/day  [ + ]
Resources      [ With Links ]  [ Info Only ]

                                    [ Activate Plan → ]
```

**Label wording (contextual, not settings-like):**

| Currently says | Should say |
|---|---|
| Scheduling style | How should Cascade schedule this? |
| Weekend scheduling | Weekend availability |
| Daily capacity | How much time can you spend daily? |
| Resource Mode | How should resources be provided? |

The wording change makes the relationship between the user's choice and Cascade's planning behavior obvious. This is a copy-only change — no handler or data changes.

**Implementation note:** the segmented controls (Day / Flexible / Night, Skip / Light / Full / Heavy) and the stepper (Capacity) that currently live in `SchedulePreferences.jsx` are composed into the Planning Surface. Their internal `useState`, save handlers, and API calls are completely unchanged — they are just rendered inside the new form layout instead of inside a standalone settings card.

---

### 9.7 Controls must look like controls, not feature cards

This rule applies to every component in the codebase. The principle:

> Do not wrap every binary toggle or segmented option in its own titled, bordered, padded card container.

**AI-generated pattern (what to remove):**
```jsx
<div className="card p-4 border border-white/5 space-y-5">
  <div className="flex items-center justify-between">
    <div>
      <p className="text-sm font-medium">Weekend scheduling</p>
      <p className="text-xs text-white/40">How much work on Sat/Sun</p>
    </div>
    <div className="flex gap-1.5">
      {WEEKEND_OPTIONS.map(opt => <button ...>{opt.label}</button>)}
    </div>
  </div>
  <div className="border-t border-white/5" />
  ...next control...
</div>
```

**Real-product pattern (what to use):**
```jsx
<div className="space-y-3">
  <label className="text-xs font-medium text-muted uppercase tracking-wide">
    Weekend availability
  </label>
  <div className="flex gap-1">
    {WEEKEND_OPTIONS.map(opt => <button className="segmented-btn" ...>{opt.label}</button>)}
  </div>
</div>
```

Add a `.segmented-btn` shared class:
```css
.segmented-btn {
  @apply px-3 py-1.5 rounded-md text-xs font-medium border border-border
         text-secondary hover:text-primary hover:bg-surface-hover
         transition-colors duration-100;
}
.segmented-btn[data-active="true"] {
  @apply border-brand-500 bg-brand-500/10 text-brand-500;
}
```

Apply the `data-active` attribute pattern consistently so the active state is set/read from the component's existing state variable — no new state required.

---

### 9.8 AI Provider Panel — compact selector, not competing feature cards

The current API key panel presents Groq and Gemini as two large marketing-style cards with icons, descriptions, and competing visual weight. This is an AI-generated dashboard pattern.

**Required structure:**

```
AI PROVIDER
Use your own API key for a larger personal quota.

Provider
┌─────────────────────────────────────────────────────┐
│ ● Groq                              Recommended     │
│   Llama · Ultra-fast                                │
├─────────────────────────────────────────────────────┤
│ ○ Google Gemini                                     │
│   Gemini · Includes RAG                             │
└─────────────────────────────────────────────────────┘

API key
[ gsk_........................................... ]
[ Save & verify ]

Get a free Groq key · 30 sec →
Stored privately.
```

**Provider option visual states:**

| State | Treatment |
|---|---|
| Default | Neutral `--bg-surface` background, `--border` hairline |
| Hover | `--bg-surface-hover` background, slightly stronger border |
| Selected | `--brand-500` border + `--brand-500/8` background tint |
| Recommended label | Small `--text-muted` secondary text; **not** a large colored pill |
| Error | `--danger` text near the affected field only |
| Verified | `--success` indicator + concise status text |

The selected state uses the `.segmented-btn[data-active]` pattern from §9.7. All existing save, verify, cancel, and provider-switch handlers are unchanged.

---

### 9.9 Context metadata — planning parameters visible after task creation

**Project Workspace header** (add below the project title, above the 7 tabs):
```
Build E-Commerce Backend
Preparing for tomorrow's investor meeting

📅 Sep 15  ·  Flexible · 2 h/day  ·  Weekends skipped
```

Render as a single `<p>` row of `--text-muted` text, 12px, with `·` separators. Pull data from the existing project context — `context.intent.deadline`, `context.preferences.workStyle`, `context.preferences.availableHoursPerDay`, `context.preferences.weekendMode`. These are already in the project document; no new API call is needed.

**Schedule tab header** (above the day-by-day schedule):
```
Planning: Flexible · 2 h/day · Weekends skipped
```

Same data, same rendering. This makes the schedule's logic understandable without navigating to Settings.

**This is a display-only change** — no new state, no new props, no API calls. The values are already available on the project context object passed to the workspace.

---

### 9.10 Numeric displays — monospace font

All numbers that change dynamically should use `font-mono` (JetBrains Mono, already in the font stack) to prevent layout shift as digits change.

Apply `font-mono tabular-nums` to:
- Stat tile numbers (Active / At Risk / Overdue / Done counts)
- Focus Mode timer display
- Daily capacity stepper value
- Time estimates on roadmap subtask rows
- Progress percentages

This is a `className` addition only — no behavioral change.

---

### 9.11 Card hover state

**Rule:** On hover, a card that is clickable/navigable should shift its border color from `--border` to a slightly stronger value. No shadow, no glow.

```css
.card-interactive {
  @apply card cursor-pointer transition-colors duration-150;
}
.card-interactive:hover {
  border-color: rgb(var(--border-strong, 255 255 255 / 0.15));
}
```

Use `.card-interactive` on `ProjectCard.jsx` and any roadmap module row that opens something on click. Plain `.card` (non-interactive containers, stat tiles) gets no hover state.

---

### 9.12 Updated definition of done (additions to §8)

Add these checks to the §8 checklist:

- [ ] Dashboard information hierarchy follows the order: Plan Composer → Today Summary → Today's Focus / Morning Briefing → Projects → System Status
- [ ] All task-planning parameters (Deadline, Calendar, Scheduling, Weekend, Capacity, Resources) are grouped together in one Planning Surface
- [ ] No UI-chrome emoji remain in functional controls — all replaced with Lucide stroke icons
- [ ] AI Provider panel renders as compact radio-style rows
- [ ] Project Workspace header displays a one-line planning context summary below the project title
- [ ] Schedule tab displays the planning parameters at its top
- [ ] All dynamic numeric displays use `font-mono tabular-nums`
- [ ] `.btn-ghost` does **not** scale on `active` — background-color shift only
- [ ] All buttons have a `focus-visible` ring using `--brand-500/40`
- [ ] Scrollbar CSS uses token values, not hardcoded hex
- [ ] `class="dark"` is removed from `index.html`; only `data-theme` drives theme state
- [ ] `--bg-surface-hover` is defined in the token layer with explicit light and dark values
- [ ] WCAG AA contrast verified: run `npx wcag-contrast "#e8e9ee" "#1a1d23"` and `npx wcag-contrast "#111317" "#ffffff"` — both must return ≥ 4.5:1
