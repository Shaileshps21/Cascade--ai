# Cascade — UI Redesign & Design System Specification

> A practical visual architecture for a calm, realistic, information-rich productivity application.

## Design objective

**Make Cascade feel like a real shipped productivity product — not an AI-generated dashboard.**  
The redesign reduces visual noise without reducing information or functionality.

| Principle | Decision |
|---|---|
| Information | Preserve all task-planning controls and contextual details. |
| Visual style | Calm, technical, restrained, modern, productivity-first. |
| Themes | Token-driven light and dark modes. |
| Effects | No ambient glow, decorative blur, floating animation, or excessive gradients. |
| Behavior | Visual redesign only; existing behavior, state, API flow, props and handlers remain unchanged. |

> **Core rule:** do not remove information to make the UI minimal. Instead, group, prioritize, align, and visually quiet the information.

This specification supersedes the earlier dashboard-only interpretation: task-dependent planning parameters remain visible because they influence how Cascade plans and schedules each task.

---

# 1. Product Design Direction

The current interface contains the right functionality but presents too many elements with equal visual weight. The redesign should preserve the information density while establishing a clear hierarchy.

## The target experience

| Current tendency | Redesign direction |
|---|---|
| Many independent rounded cards | Fewer cohesive surfaces; use sections, spacing and dividers. |
| Purple/glowing AI aesthetic | Restrained indigo accent used only for actions and selected states. |
| Emoji-heavy iconography | One consistent icon language, preferably a single stroke-based icon set. |
| Settings-like task controls | A unified Planning Parameters area attached directly to the task. |
| Large decorative treatment | Typography, alignment and whitespace become the primary hierarchy tools. |
| Dashboard feels like a component showcase | Dashboard becomes a planning workspace first, monitoring workspace second. |

## Visual language

- **Calm:** no neon, no excessive contrast, no glowing decoration.
- **Technical:** precise alignment, compact metadata, consistent controls and predictable states.
- **Productivity-focused:** the user should quickly understand what to do and how Cascade will handle it.
- **Information-rich but visually quiet:** minimal styling does not mean hiding task-planning information.
- **Consistent:** the same tokens, spacing, control states and icon language are used throughout every page.

## Real-product test

For every visual element, ask:

> “Does this help the user understand, decide, or act?”

If not, remove the effect rather than adding another decorative treatment.

---

# 2. Non-Negotiable Constraints

This is a **visual redesign, not a feature or architecture rewrite**.

## Zero feature loss

- Every button, toggle, link, keyboard shortcut and confirmation remains functional.
- Every conditional render, loading state, error state, disabled state and empty state remains unchanged.
- API calls, optimistic updates, rollback paths and SSE behavior remain untouched.
- Existing props and exported function signatures remain unchanged.
- Do not modify `useState`, event handlers, conditionals or data flow merely to make visual changes easier.
- Only JSX changes required to apply the new visual system are allowed.

## Feature inventory that must remain visually supported

| Area | Must remain available |
|---|---|
| Task creation | Natural-language input, 15-agent pipeline, live SSE trace, deadline picker/AI inference, Calendar sync, Resource Mode, Manual Todo Mode. |
| Dashboard | Stats, filters, Morning Briefing, API key panel, Calendar connection, scheduling controls, weekend policy, capacity, project actions and resume states. |
| Onboarding | Next/Back, dot navigation, Skip, close, Get Started, persistent dismissal. |
| Login | Google sign-in and account-picker flow. |
| Project Workspace | All seven tabs, roadmap reorder, Next Best Action, Risk Meter, notes and project controls. |
| Task Workspace | Execution steps, notes, Start/Pause/Complete/Skip/Blocked, Focus Mode and timing behavior. |
| Scheduling internals | Conflict detection, priority ordering, pace calibration, automatic reassignment and manual rescheduling. |
| Global | Breadcrumbs, safe resource rendering and sign-out. |

## Implementation rule

> If a visual change appears to require a behavioral change, stop and flag it. The redesign should never alter product logic to achieve a visual result.

---

# 3. Shared Design Tokens

All pages must consume one shared token system. Do not introduce page-specific colors, gradients or shadows.

## 3.1 Surface and text

| Token | Light | Dark | Purpose |
|---|---|---|---|
| `--bg-base` | `#F5F6F8` | `#14161A` | Page background |
| `--bg-surface` | `#FFFFFF` | `#1A1D23` | Cards and primary panels |
| `--bg-elevated` | `#FFFFFF + border` | `#20242B` | Modal, dropdown, popover, floating surface |
| `--border` | `rgba(15,17,21,.08)` | `rgba(255,255,255,.08)` | Hairline borders |
| `--text-primary` | `#111317` | `#E8E9EE` | Headings and primary content |
| `--text-secondary` | `65% black` | `62% white` | Body/secondary content |
| `--text-muted` | `40% black` | `35% white` | Captions/placeholders |
| `--surface-hover` | subtle dark mix | subtle white mix | Hover state |

## 3.2 Brand accent

| Token | Value | Use |
|---|---|---|
| `--brand-400` | `#818CF8` | Hover brand text/icons |
| `--brand-500` | `#6366F1` | Primary actions, active state, focus ring |
| `--brand-600` | `#4F46E5` | Primary action hover |

## 3.3 Status colors

| Status | Value | Preferred visual expression |
|---|---|---|
| Success | `#10B981` | Small dot, thin accent, or text |
| Warning | `#F59E0B` | Small dot, thin accent, or text |
| Danger | `#F43F5E` | Small dot, thin accent, or destructive text |
| Info | `#0EA5E9` | Small dot, thin accent, or informational text |

Status colors should not become full-saturation card backgrounds. A risk state should read as a small colored indicator plus neutral UI, not a neon pill.

---

# 4. Shape, Typography, Elevation and Iconography

## 4.1 Shape system

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | `8px` | Inputs, small controls, badges |
| `--radius-md` | `12px` | Cards and primary panels |
| `--radius-lg` | `16px` | Modals and large overlays |
| `--shadow-elevated` | `0 4px 20px rgba(0,0,0,.10)` light / `.35` dark | Floating UI only |

Cards and buttons should have no resting drop shadow. Depth comes from surface contrast and hairline borders. Shadows are reserved for things that actually float.

## 4.2 Typography

| Role | Size | Weight |
|---|---:|---:|
| Page title | 22–24px | 700 |
| Section header | 16–18px | 600 |
| Body | 14px | 400–500 |
| Secondary / caption | 12–13px | 400 |
| Micro / timestamp / badge | 11px | 500–600 |

Keep the existing **Inter / JetBrains Mono** font stack. Do not introduce a new font as part of the redesign.

## 4.3 Iconography

- Use one consistent icon family across the product; a Lucide-style stroke system is appropriate if already available.
- Avoid mixing emoji, custom SVG styles and unrelated icon weights.
- Default icon size: 16–18px for controls, 20–24px for section markers, smaller for metadata.
- Icons communicate meaning; they should not become decorative focal points.

## 4.4 Controls

Controls should look like controls:

- segmented options
- radio-like selections
- steppers
- inputs
- buttons

Do **not** turn every control into a standalone feature card.

---

# 5. Motion and Effects Policy

Cascade should feel responsive, not animated for the sake of being animated.

## Allowed

- Hover/focus color and background transitions: approximately 100–150ms.
- Modal/dropdown/onboarding open-close: one fade or fade + approximately 8px translation, capped around 200ms.
- Loading spinner used to communicate an actual loading state.
- Progress bars that transition when real progress changes.
- The live terminal cursor in AgentTrace because it communicates live output.

## Remove

- Glow-pulse halos behind icons.
- Floating/bobbing decorative elements.
- Blurred ambient gradient orbs.
- Decorative shimmer sweeps and animated borders.
- Looping background animation.
- Unnecessary button scaling; prefer a color transition unless tactile scale is genuinely useful.

## Decision rule

If an animation continues while the user is doing nothing, it is probably decorative and should be removed.

If it occurs once because the user acted or because real state changed, it can remain if it is short and purposeful.

---

# 6. Dashboard Architecture

The Dashboard is the most important redesign because the current screen gives statistics, notices, calendar, scheduling preferences, resources and task creation approximately equal visual treatment.

## New hierarchy

**1. Create / plan work → 2. See today's work → 3. Monitor projects → 4. Read secondary system status.**

## Recommended structure

```text
HEADER
↓
DASHBOARD INTRO
↓
PLAN COMPOSER (primary)
    • Goal input
    • Task planning parameters
    • Activate
↓
TODAY SUMMARY
    • Active / At Risk / Overdue / Done
↓
TODAY'S FOCUS + MORNING BRIEFING
↓
PROJECTS
↓
SYSTEM STATUS
    • AI quota / calendar status when appropriate
```

> **Important:** task-dependent planning parameters must remain visible. They are not generic application settings.

## Visual treatment

- Use one main Planning Surface rather than six separate settings cards.
- Use sections and dividers inside the surface.
- Keep statistics compact and quiet.
- Make the task goal and Activate action the strongest visual hierarchy.
- Use project rows/cards below the planning area to support monitoring.
- Avoid stacking every dashboard element as a large rounded container.

---

# 7. Task Planning Parameters — Core Design Decision

This is the most important clarification from the redesign discussion:

**Scheduling Style, Weekend Scheduling, Daily Capacity, Resource Mode, Calendar Sync and Deadline are task-planning inputs.**

Their values can change from one task/project to another, so they must remain directly visible in the planning flow.

## 7.1 Unified Planning Surface

```text
CREATE PLAN
───────────────────────────────────────────

GOAL

[ What do you want to accomplish? ]

PLANNING PARAMETERS

Deadline       [ Tomorrow · 12:00 PM ]
Calendar       [ Google Calendar ✓ ]
Scheduling     [ Day ] [ Flexible ] [ Night ]
Weekend        [ Skip ] [ Light ] [ Full ] [ Heavy ]
Capacity       [ − ] 2h/day [ + ]
Resources      [ With Links ] [ Info Only ]

[ Activate → ]
```

## 7.2 Progressive density, not progressive hiding

### Primary
- Goal
- Deadline
- Activate

### Secondary but always visible
- Calendar
- Scheduling style
- Weekend policy
- Capacity
- Resources

### Metadata
- Helper text
- Privacy notes
- Status explanations

## 7.3 Contextual wording

| Instead of | Prefer |
|---|---|
| Scheduling style | How should Cascade schedule this? |
| Weekend scheduling | Weekend availability |
| Daily capacity | How much time can you spend daily? |
| Resource Mode | How should resources be provided? |

The purpose is not to add more copy. It is to make the relationship between the user's choice and Cascade's planning behavior obvious.

---

# 8. AI Provider / API Key Panel

The API-key panel should be redesigned as a **compact configuration panel**, not an AI-provider showcase.

All existing information remains available.

## Information that must remain

- Add your own API key / personal quota explanation.
- Groq provider and recommendation.
- Google Gemini provider.
- Provider descriptions.
- API-key input.
- Save & Verify action.
- Free Groq key link.
- Stored privately indication.
- Cancel / close action.

## Recommended structure

```text
AI PROVIDER

Use your own API key for a larger personal quota.

Provider

● Groq                                  Recommended
  Llama · Ultra-fast

○ Google Gemini
  Gemini · Includes RAG

API key

[ gsk_................................ ]

[ Save & verify ]

Get a free Groq key · 30 sec →

Stored privately
```

> Provider options should behave visually like radio/segmented selections, not like two competing feature cards.

## Provider state rules

| State | Visual treatment |
|---|---|
| Default | Neutral surface, subtle border. |
| Hover | Subtle surface-hover background and slightly stronger border. |
| Selected | Brand-colored border + very subtle brand tint. |
| Recommended | Small secondary text; avoid a large purple pill. |
| Error | Danger text / small indicator near the affected field. |
| Verified | Success indicator and concise status text. |

---

# 9. Page-by-Page Design Architecture

## 9.1 Header

- Logo/brand on the left.
- Primary navigation or contextual actions in the center/right.
- Theme toggle near account controls.
- Keep Connect Calendar as contextual status/action rather than a visually dominant permanent CTA when not required.

## 9.2 Login

- Single focused authentication surface.
- Remove gradient background washes.
- Use the shared card and input tokens.
- Keep Google sign-in and account-picker behavior unchanged.

## 9.3 Onboarding

- Flat modal/elevated surface.
- Static icon chip instead of glowing halo.
- No ambient blur or floating decorative objects.
- Keep slide-specific accent color as a small visual cue.
- Keep functional directional transition within ~200ms.

## 9.4 Project Workspace

- Project identity and task-planning context appear near the top.
- Seven tabs remain unchanged.
- Risk Meter becomes a flat arc/ring with no glow.
- Roadmap progress uses flat brand fill.
- Use whitespace and alignment rather than card-on-card nesting.

## 9.5 Task Workspace / Focus Mode

- Execution steps should look like actionable rows, not decorative cards.
- Active/in-progress state uses a small accent indicator.
- Timer remains visually prominent because it is the current work context.
- Focus Mode can use elevated treatment because it is a true overlay.
- Markdown notes must remain readable in both themes.

## 9.6 Resources, Analytics, Notes, Schedule

### Resources
Clean list of links/status; inert text remains inert when no confident URL exists.

### Analytics
Prioritize readable data hierarchy over decorative charts.

### Notes
Typography-first reading experience with neutral code blocks and links.

### Schedule
Show the generated schedule alongside a compact summary of the task's planning parameters.

---

# 10. Context Architecture Across the Product

Task-specific planning choices should remain attached to the project/task context so the user can understand why a schedule looks the way it does.

## Conceptual data-to-UI relationship

```text
TASK / PROJECT
│
├── Goal
├── Deadline
├── Planning Preferences
│   ├── Calendar
│   ├── Scheduling Style
│   ├── Weekend Policy
│   ├── Daily Capacity
│   └── Resource Mode
│
└── AI-generated plan
    ├── Milestones
    ├── Modules
    ├── Tasks
    └── Schedule
```

## Project header example

```text
Investor Pitch Deck
Preparing for tomorrow's investor meeting

Tomorrow · 12:00 PM
Flexible · 2h/day
Weekends skipped
```

The parameters should be visible as contextual metadata once the project exists, rather than forcing the user to remember which choices were made during creation.

## Schedule page example

```text
SCHEDULE

Planning: Flexible · 2h/day · Weekends skipped

───────────────────────────────────────

TODAY

10:00  Research competitors       45m
11:00  Create slide structure     30m
14:00  Draft slides               1h

TOMORROW

09:00  Finalize deck              1h
```

---

# 11. Shared Component Architecture

The goal is to make visual consistency an architectural property rather than a page-by-page styling effort.

## Recommended component hierarchy

```text
App
├── ThemeContext
├── Header
├── Dashboard
│   ├── DashboardIntro
│   ├── PlanComposer
│   │   ├── GoalInput
│   │   ├── PlanningParameters
│   │   │   ├── DeadlineControl
│   │   │   ├── CalendarControl
│   │   │   ├── SchedulingControl
│   │   │   ├── WeekendControl
│   │   │   ├── CapacityControl
│   │   │   └── ResourceModeControl
│   │   └── ActivateButton
│   ├── DashboardSummary
│   ├── TodayFocus
│   ├── MorningBriefing
│   └── Projects
├── AIProviderPanel
├── ProjectWorkspace
│   ├── ProjectContext
│   └── ProjectTabs
└── TaskWorkspace
    ├── ExecutionSteps
    ├── TaskContext
    └── FocusMode
```

## Shared CSS architecture

- CSS custom properties define colors, surfaces, text, borders and elevation.
- Tailwind consumes those tokens through semantic utility names.
- Shared component classes define card, button, input, badge and agent-step patterns.
- Pages should not introduce arbitrary hex colors or bespoke visual systems.
- Theme switching changes token values, not component markup.

## Suggested shared classes

```text
.card        → semantic surface + border + radius
.btn-primary → brand action + short transition
.btn-ghost   → neutral secondary action
.input-field → semantic input + focus treatment
.badge       → neutral metadata with optional leading status dot
.agent-step  → compact bordered activity row
```

---

# 12. Light / Dark Theme Architecture

The application should support both themes through the token layer rather than duplicating page-specific styles.

## Theme mechanism

- Use `data-theme="light"` / `data-theme="dark"` on `<html>`.
- Default to the operating-system preference on first visit.
- Persist explicit user choice in `localStorage`, e.g. `cascade-theme`.
- Apply the saved theme before the application paints to avoid a flash of the wrong theme.
- Provide a simple sun/moon toggle near the account controls.
- Use a small `ThemeContext` with `{ theme, toggleTheme }` rather than prop drilling.

## Theme principles

| Dark | Light |
|---|---|
| Soft dark slate, not near-black | Soft off-white, not pure white |
| Surface `#1A1D23` | Surface `#FFFFFF` |
| Elevated `#20242B` | Elevated `#FFFFFF + border` |
| Text `#E8E9EE` | Text `#111317` |
| Same brand indigo | Same brand indigo |

The brand accent must remain recognizable across themes. The surrounding surfaces change; the brand identity does not.

---

# 13. Visual Do / Don't Rules

| DO | DON'T |
|---|---|
| Use whitespace, typography and alignment for hierarchy. | Use glow to create hierarchy. |
| Use one cohesive planning surface for task parameters. | Create a separate card for every control. |
| Use a consistent stroke-based icon system. | Mix emoji, random SVGs and unrelated icon styles. |
| Use subtle borders and surface contrast. | Use thick/high-contrast borders everywhere. |
| Use indigo for actions and selection. | Make the entire dashboard purple. |
| Use small status dots and restrained status text. | Use saturated red/green/yellow card backgrounds. |
| Use short functional transitions. | Use looping ambient animation. |
| Keep task parameters visible. | Hide task-dependent parameters in generic Settings. |
| Make API provider selection compact. | Make providers look like competing marketing cards. |
| Use flat progress/risk visuals. | Use gradients and glow around every metric. |
| Make the primary action obvious. | Give every button the same visual weight. |

---

# 14. Recommended Implementation Sequence

Implement the redesign in layers so that the visual system becomes stable before individual pages are restyled.

1. **Global token infrastructure:** define CSS variables, Tailwind mappings and semantic shared classes.
2. **Theme system:** add light/dark token switching, persistence and no-flash initialization.
3. **Header:** apply the shared visual system and theme toggle.
4. **Dashboard shell:** establish the new information hierarchy without removing any functionality.
5. **Plan Composer:** consolidate Goal + all task-planning parameters into one cohesive surface.
6. **AI Provider Panel:** convert provider cards into a compact selector + key field structure.
7. **Project/Task workspaces:** apply the same hierarchy, surfaces, context metadata and status language.
8. **Onboarding/Login:** remove decorative effects while preserving every interaction.
9. **Remaining shared components:** AgentTrace, Briefing, ResourceLink, Breadcrumbs, Calendar controls, etc.
10. **Regression pass:** exercise every existing feature and verify both themes before considering the redesign complete.

## Important implementation boundary

A visual change must not become an excuse to rewrite logic.

If an existing component requires behavior changes to support the new layout, preserve the behavior and flag the conflict rather than silently modifying it.

---

# 15. Definition of Done

The redesign is complete only when both visual consistency and feature preservation are verified.

| Check | Acceptance criteria |
|---|---|
| Feature preservation | Every existing feature still works exactly as before. |
| Theme coverage | Every page renders correctly in light and dark themes. |
| Theme persistence | Choice survives reload and there is no wrong-theme flash. |
| Token usage | No scattered hardcoded theme colors outside token definitions. |
| Gradient rule | Only the approved brand gradient exists, used for the brand mark and primary CTA. |
| Animation rule | No looping glow, float, shimmer or ambient blur remains. |
| Task context | All task-dependent planning controls remain visible and usable. |
| API provider panel | Groq/Gemini selection, key entry and existing actions remain available. |
| Accessibility | Body text and controls meet WCAG AA contrast expectations. |
| Build/test | Client build and existing server tests remain green. |

## Regression mindset

For each touched page, actually click, drag, submit, complete, pause, reschedule and otherwise exercise the relevant behavior.

**Do not rely only on reading the diff.**

---

# 16. Final Design Principles — Quick Reference

Use this page as the short implementation checklist.

## 1. Information is not the enemy.

Cascade is an information-rich planning product. Do not hide important task-dependent controls just to make the UI look minimal.

## 2. Group related information.

Task-planning controls belong together in a **Planning Parameters** surface. AI-provider controls belong together in an **AI Provider** panel.

## 3. Reduce visual noise, not functionality.

Remove glow, blur, decorative gradients, excessive cards and looping animation — not useful information.

## 4. Hierarchy comes from structure.

Use typography, spacing, alignment, surface contrast and restrained borders before reaching for visual effects.

## 5. Indigo is an accent.

Use brand color for primary actions, focus and selected states. Do not wash the UI in purple.

## 6. Context travels with the work.

Deadline, scheduling style, weekend policy, capacity, calendar and resource mode should remain understandable after task creation.

## 7. Make every state believable.

Loading, success, warning, danger, disabled and selected states should look like natural product states rather than decorative effects.

## 8. One visual system everywhere.

Login, Dashboard, Onboarding, Project Workspace, Task Workspace and Focus Mode should look like parts of the same application.

---

# FINAL TARGET

**Calm · Technical · Information-rich · Consistent · Realistic · Productivity-first**

## Source basis

This specification incorporates the supplied Cascade redesign specification and the subsequent clarification that task-dependent planning parameters must remain visible for each task. The supplied specification establishes the zero-feature-loss constraint, shared token system, restrained animation policy, theme architecture and page coverage.
