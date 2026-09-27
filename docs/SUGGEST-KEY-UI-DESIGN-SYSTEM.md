# Suggest Key — UI Design System & Frontend Design Bible

**Version:** 1.0  
**Status:** Draft for frontend implementation  
**Scope:** Frontend UI/UX only

---

## 1. Purpose

This document defines the visual language, interaction patterns, reusable components, responsive behavior, theme architecture, and frontend quality standards for Suggest Key.

Suggest Key should feel:

- Premium
- Calm
- Human
- Trustworthy
- Modern
- Focused

The UI must feel like a premium mentorship platform, not a generic SaaS dashboard.

---

## 2. Product UX Principles

### 2.1 Clarity First

Every page should make the user's current task obvious.

The user should quickly understand:

- Where they are
- What information matters
- What action is primary
- What state the system is currently in
- What happens next

### 2.2 Visual Hierarchy

Use visual hierarchy rather than excessive decoration.

Priority order should generally be:

1. Primary task/action
2. Important contextual information
3. Supporting information
4. Metadata

### 2.3 Minimal Visual Noise

Avoid:

- Excessive cards
- Excessive borders
- Excessive shadows
- Unnecessary gradients
- Excessive glassmorphism
- Decorative animations with no UX purpose
- Repeated UI containers
- Generic dashboard styling

### 2.4 Consistency

Equivalent UI concepts must look and behave consistently throughout the application.

The same:

- Button type
- Input
- Status
- Toast
- Card
- Modal
- Navigation item
- Loading state

must use the same design language everywhere.

---

# 3. Role-Specific UX Direction

Suggest Key has three roles.

## Seeker

Primary job:

```text
Discover → Book → Attend → Review outcome
```

UX direction:

- Clean
- Focused
- Discovery-oriented
- Low cognitive load
- Strong booking CTA

Navigation:

```text
Home
My Bookings
Notifications
Settings
```

Use a top navigation shell.

---

## Mentor

Primary job:

```text
Manage availability → Manage bookings → Conduct session → Document outcome
```

UX direction:

- Clean
- Operational
- Action-oriented
- Clear session states

Navigation:

```text
Home
My Bookings
Availability
Notifications
Settings
```

Use a top navigation shell.

---

## Admin

Primary job:

```text
Monitor → Verify → Control → Resolve
```

UX direction:

- Operational
- Information-dense
- Efficient
- Clear queues and actions

Navigation:

```text
Dashboard
Users
Mentors
Segments
Bookings
Payments
Notifications
Settings
```

Use a sidebar shell on desktop and a collapsible/drawer navigation on smaller screens.

---

# 4. Frontend-Only Constraint

This document defines the frontend visual system.

Frontend redesign work must NOT change unrelated backend architecture or business rules.

Do NOT:

- Modify database schema
- Modify Supabase RLS
- Modify authentication architecture
- Modify booking business logic
- Modify payment business logic
- Modify availability logic
- Modify server-side authorization
- Replace backend APIs
- Introduce fake production business data
- Bypass existing state rules
- Replace real data with mock data
- Rewrite unrelated backend modules

The UI must represent the real backend state.

Backend/database remains the source of truth.

---

# 5. Theme Architecture

Suggest Key must support:

- Light mode
- Dark mode

The two themes must be intentionally designed, not created by simply inverting colors.

## 5.1 Semantic Tokens

Components should consume semantic tokens rather than hardcoded colors.

Conceptual token groups:

```text
Background
Surface
Surface Muted
Surface Elevated

Foreground
Foreground Muted
Foreground Subtle

Border
Border Strong

Primary
Primary Hover
Primary Foreground

Success
Warning
Destructive
Info
```

Prefer semantic classes/tokens such as:

```text
bg-background
bg-card
bg-muted
text-foreground
text-muted-foreground
border-border
bg-primary
text-primary-foreground
```

Avoid scattering hardcoded values such as:

```text
bg-white
text-black
bg-gray-900
border-gray-200
```

through individual components when a semantic token can represent the same concept.

---

# 6. Light Mode

Light mode should feel:

- Clean
- Bright
- Calm
- Spacious
- Premium

Use a hierarchy such as:

```text
Page Background
    ↓
Normal Surface
    ↓
Elevated Surface
```

Avoid making every area pure white.

Use subtle surface differences to create hierarchy.

---

# 7. Dark Mode

Dark mode should feel:

- Deep
- Calm
- Comfortable
- Premium
- High contrast without being harsh

Do not treat dark mode as:

```text
white → black
```

Instead use:

```text
Deep Background
    ↓
Dark Surface
    ↓
Elevated Dark Surface
```

Use subtle surface contrast and borders where useful.

Do not make every surface pure black.

---

# 8. Theme Component Requirement

Every reusable component must be validated in both themes.

At minimum:

- Background
- Text
- Border
- Icon
- Hover
- Active
- Focus
- Disabled
- Selected
- Error
- Success
- Warning

must remain visually correct in both Light and Dark modes.

---

# 9. Typography System

Typography must be centralized.

Recommended hierarchy:

```text
Display XL
Display L
Display M

H1
H2
H3
H4

Body Large
Body
Body Small

Label
Caption
Metadata
```

Rules:

- Same semantic level uses the same typography treatment.
- Page titles must be visually distinct from section titles.
- Section titles must be visually distinct from card titles.
- Supporting text must be visibly subordinate.
- Avoid arbitrary one-off font sizes.

Typography should communicate hierarchy before decoration is added.

---

# 10. Spacing System

Use a consistent spacing rhythm.

Base values:

```text
4
8
12
16
24
32
40
48
64
80
96
```

Most UI should be composed using these values or the framework's equivalent spacing scale.

Avoid arbitrary spacing such as:

```text
17px
23px
29px
37px
```

unless there is a specific design reason.

---

# 11. Border Radius

Use a consistent radius hierarchy.

Conceptual levels:

```text
Small
→ badges, compact controls

Medium
→ buttons, inputs, small surfaces

Large
→ cards, panels

XL
→ major surfaces, dialogs where appropriate
```

Do not make every element pill-shaped.

Use pill shapes primarily for:

- Tags
- Compact status indicators
- Explicit pill controls

---

# 12. Elevation & Shadows

Use a small elevation system.

```text
Level 0
→ Page background

Level 1
→ Normal surface

Level 2
→ Elevated card, dropdown

Level 3
→ Dialog, modal, important overlay
```

Light mode may use subtle shadows.

Dark mode should often use:

- Surface contrast
- Subtle borders
- Controlled shadows

Avoid large dramatic shadows.

---

# 13. Iconography

Use one primary icon system consistently.

Maintain consistency in:

- Icon family
- Stroke style
- Stroke weight
- Size
- Alignment
- Color

Do not mix unrelated icon styles, random SVGs, Unicode symbols, and emoji as if they are one icon system.

Icons should support comprehension rather than create decoration.

---

# 14. Button System

Standard button variants:

### Primary

For the main action.

Examples:

```text
Book Session
Confirm Session
Save Changes
Join Session
```

### Secondary

For supporting actions.

Examples:

```text
View Details
Edit
Back
```

### Outline

For visible but lower-emphasis actions.

### Ghost

For low-emphasis contextual actions.

### Destructive

For dangerous actions.

Examples:

```text
Reject
Delete
Deactivate
```

Each button must define:

```text
Default
Hover
Pressed
Focus
Disabled
Loading
```

states.

Buttons must remain readable and distinguishable in both themes.

---

# 15. Form & Input System

Standard form structure:

```text
Label
↓
Input
↓
Helper text / validation
```

Every important input should support:

- Default
- Hover
- Focus
- Filled
- Disabled
- Error
- Success where appropriate

Error communication must not rely only on color.

Use:

- Clear error text
- Appropriate icon where useful
- Visual state
- Correct field association

---

# 16. Cards & Surfaces

Do not place every piece of content inside a card.

Use cards when they provide meaningful grouping or interaction.

Good card use cases:

- Mentor profile
- Mentor offering
- Booking summary
- Payment summary
- Operational queue item
- Session workspace section

Avoid cards for:

- Every paragraph
- Every heading
- Every small piece of metadata
- Simple page sections that can be grouped by spacing alone

The goal is to reduce visual noise.

---

# 17. Mentor Card

Mentor discovery is a core Suggest Key experience.

A mentor card should prioritize:

1. Mentor identity
2. Relevant segment/gig
3. Short description
4. Availability
5. Price/duration
6. Primary action

Conceptual structure:

```text
Mentor Avatar

Mentor Name
Segment / Gig

Short bio

Duration        Price

Next available slot

[ View Mentor ]
```

Do not overload the card with unnecessary information.

---

# 18. Status System

Status visuals must be centralized.

Booking states:

```text
PAYMENT_PENDING
MENTOR_PENDING
CONFIRMED
IN_PROGRESS
COMPLETED
CANCELLED
REJECTED
```

Payment states:

```text
PENDING
APPROVED
REJECTED
```

Hold states:

```text
ACTIVE
EXPIRED
RELEASED
```

Every status should have:

- Text label
- Semantic visual treatment
- Optional supporting icon

Do not communicate status through color alone.

The same status must look the same throughout the product.

---

# 19. Booking Progress

The booking experience should make state progression visible.

Conceptual pattern:

```text
✓ Slot selected

✓ Payment submitted

● Awaiting verification

○ Mentor confirmation

○ Session
```

The user should understand:

- What has happened
- What is happening now
- What happens next

Do not expose unnecessary internal technical state.

---

# 20. Loading States

Every important asynchronous area needs a deliberate loading state.

Prefer skeletons when the content shape is known.

Example:

```text
┌─────────────────────┐
│ ░░░░░░░░░░░░        │
│ ░░░░░░░░            │
│ ░░░░░░░░░░░░░       │
│ ░░░░░░              │
└─────────────────────┘
```

Avoid using a full-page spinner for every operation.

Buttons should use inline loading states when an action is being submitted.

---

# 21. Empty States

Empty states must explain:

1. What is empty
2. Why it may be empty when useful
3. What the user can do next

Example:

```text
No mentors available

We couldn't find a bookable mentor
for this segment and date.

[ Choose another date ]
```

Another example:

```text
No upcoming sessions

Your upcoming mentorship sessions
will appear here.

[ Explore Mentors ]
```

Do not leave large blank spaces with no explanation.

---

# 22. Error States

Errors should be human-readable and actionable.

Prefer:

```text
Something went wrong

We couldn't load your bookings.
Please try again.

[ Try Again ]
```

Avoid exposing raw technical errors as primary UI.

The UI should preserve enough detail for users to understand the issue without exposing implementation details unnecessarily.

---

# 23. Success States

Important successful operations should provide clear confirmation.

Examples:

```text
Profile updated successfully
```

```text
Payment proof submitted
```

```text
Session confirmed
```

Success feedback can use:

- Toast
- Inline confirmation
- Status transition
- Contextual success message

Use the least disruptive feedback appropriate to the action.

---

# 24. Toast System

Standard categories:

```text
Success
Warning
Error
Info
```

Toasts must use the same:

- Position
- Radius
- Typography
- Icon treatment
- Spacing
- Theme behavior

throughout the application.

---

# 25. Modal / Dialog System

Use dialogs for focused decisions or contained workflows.

Conceptual sizes:

```text
Small
→ Confirmation

Medium
→ Standard form

Large
→ Complex workflow
```

Actions should be predictable:

```text
Cancel
Confirm
```

Dangerous actions should clearly communicate their consequence.

---

# 26. Navigation System

Navigation must be centralized and role-aware.

## Seeker

```text
Home
My Bookings
Notifications
Settings
```

Top navigation.

## Mentor

```text
Home
My Bookings
Availability
Notifications
Settings
```

Top navigation.

## Admin

```text
Dashboard
Users
Mentors
Segments
Bookings
Payments
Notifications
Settings
```

Sidebar.

Do not implement independent ad-hoc navigation systems inside individual pages.

---

# 27. Responsive Navigation

### Seeker / Mentor

Desktop:

```text
Horizontal top navigation
```

Mobile:

```text
Compact header
+
Collapsible menu/sheet
```

### Admin

Desktop:

```text
Persistent sidebar
```

Mobile:

```text
Collapsible sidebar / drawer
```

---

# 28. Settings UX

## Seeker

```text
Settings
├── Profile
├── Personal Information
├── Appearance
├── Notifications
├── Security
└── Account
```

## Mentor

```text
Settings
├── Profile
├── Personal Information
├── Appearance
├── Notifications
├── Security
├── Segments
├── Gigs
└── Account
```

Availability remains a dedicated primary navigation item for mentors.

---

# 29. Admin UI Direction

Admin UI can be denser than seeker/mentor UI.

Prioritize:

- Operational metrics
- Queues
- Filters
- Tables
- Status
- Quick actions
- Search
- Clear information hierarchy

Avoid turning admin into an unreadable enterprise dashboard.

All metrics and business data must come from real data.

Never fabricate:

- KPIs
- Charts
- Notification counts
- Payment counts
- Booking counts
- Availability
- User counts

---

# 30. Domain Components

Reusable domain components should include, where appropriate:

```text
MentorCard
SlotPicker
BookingStatus
PaymentStatus
BookingProgress
SessionCountdown
NotificationItem
BookingSummary
PaymentSummary
WorkspaceSection
AvailabilityCalendar
```

Domain components should represent backend state consistently.

Do not duplicate status logic and visual logic across pages.

---

# 31. Session Experience

The session experience is time-sensitive.

The UI should clearly communicate:

```text
Before T-5
→ Session starts in X minutes

At T-5
→ Join becomes available

During session
→ Join available

After end time
→ Session ended
```

The frontend countdown is UX only.

Server-side authorization remains authoritative.

---

# 32. Animation

Animation should be purposeful.

Good uses:

- Page transitions
- Modal entrance
- Dropdown opening
- Button feedback
- Skeleton loading
- Slot selection
- Status transitions

Avoid:

- Excessive scroll animations
- Constant floating elements
- Heavy parallax
- Animation on every component
- Long transitions that slow down workflows

Goal:

```text
The interface should feel alive,
not animated.
```

Respect reduced-motion preferences where applicable.

---

# 33. Responsive Design

Every important page must be designed for:

```text
Mobile
Tablet
Desktop
Large Desktop
```

Do not simply shrink desktop layouts.

Information hierarchy may need to change.

Example:

Desktop mentor card:

```text
Avatar | Info | Price | Availability | CTA
```

Mobile:

```text
Avatar
Name
Segment
Price
Availability
CTA
```

---

# 34. Accessibility Baseline

The UI should provide:

- Sufficient contrast
- Visible keyboard focus
- Proper labels
- Clear navigation
- Responsive layouts
- Non-color-only status communication
- Usable touch targets
- Logical reading/order structure
- Reduced-motion consideration

Accessibility is part of the design system, not a final patch.

---

# 35. Theme QA Matrix

Every reusable component should be checked against:

| Component | Light | Dark | Hover | Focus | Disabled | Mobile |
|---|---|---|---|---|---|---|
| Button | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Input | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Card | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Modal | ✓ | ✓ | — | ✓ | — | ✓ |
| Badge | ✓ | ✓ | — | — | — | ✓ |
| Table | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Dropdown | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Tabs | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Toast | ✓ | ✓ | — | — | — | ✓ |
| Skeleton | ✓ | ✓ | — | — | — | ✓ |

A component is not finished until both themes are intentionally validated.

---

# 36. Page Redesign Order

Do not redesign every page independently.

Use this order:

## Phase 1 — Foundation

```text
Design tokens
Colors
Typography
Spacing
Radius
Elevation
Icons
```

## Phase 2 — Primitives

```text
Buttons
Inputs
Selects
Checkboxes
Switches
Badges
```

## Phase 3 — Shared Components

```text
Cards
Dialogs
Dropdowns
Tabs
Toasts
Tables
Skeletons
Empty states
Error states
```

## Phase 4 — Shells

```text
SeekerShell
MentorShell
AdminShell
```

## Phase 5 — Domain Components

```text
MentorCard
SlotPicker
BookingStatus
PaymentStatus
SessionCountdown
NotificationItem
```

## Phase 6 — Pages

### Seeker

```text
Home
Mentor Discovery
Mentor Detail
Slot Selection
Payment
My Bookings
Booking Detail
Session
History
Workspace
Notifications
Settings
```

### Mentor

```text
Home
Bookings
Booking Detail
Availability
Segments / Gigs
Session
Workspace
Notifications
Settings
```

### Admin

```text
Dashboard
Users
Mentors
Segments
Bookings
Payments
Notifications
Settings
```

---

# 37. UI Audit Process

Each existing page should be reviewed in three passes.

## Pass 1 — Foundation

Check:

- Colors
- Fonts
- Spacing
- Radius
- Shadows
- Icons
- Buttons
- Inputs

## Pass 2 — Components

Check:

- Cards
- Tables
- Dialogs
- Dropdowns
- Tabs
- Badges
- Toasts
- Skeletons
- Empty states
- Error states

## Pass 3 — Page

Check:

- Information hierarchy
- Primary CTA
- Navigation
- Responsive behavior
- Light mode
- Dark mode
- Loading
- Empty
- Error
- Success
- Accessibility

---

# 38. Frontend QA Checklist

A redesigned page is complete only when:

```text
✓ Light mode works
✓ Dark mode works
✓ Mobile works
✓ Tablet works
✓ Desktop works
✓ Typography is consistent
✓ Spacing is consistent
✓ Components are reusable
✓ Loading state exists
✓ Empty state exists
✓ Error state exists
✓ Success state exists
✓ Focus states work
✓ Status is understandable
✓ Primary action is obvious
✓ No fake business data
✓ No hardcoded availability
✓ No hardcoded notifications
✓ No fake metrics
✓ Backend behavior is preserved
```

---

# 39. AI Coding Agent Rules

When an AI coding agent implements this design system:

1. Inspect the existing frontend before modifying it.
2. Reuse existing working functionality.
3. Prefer shared components over duplicated page-specific components.
4. Create/update design tokens centrally.
5. Do not solve theme problems with isolated page overrides.
6. Do not hardcode business data.
7. Do not change backend logic for a frontend-only redesign.
8. Do not modify authentication unless explicitly requested.
9. Do not modify booking/payment/availability business rules unless explicitly requested.
10. Preserve real Supabase data flow.
11. Validate both Light and Dark themes.
12. Validate responsive layouts.
13. Preserve role-based navigation.
14. Remove visual duplication where practical.
15. Avoid unnecessary dependencies.
16. Avoid rewriting unrelated modules.
17. Test critical UI states after changes.
18. Keep business logic outside presentational components where practical.

---

# 40. Anti-Patterns

Do NOT introduce:

```text
❌ Random colors per page
❌ Random typography per page
❌ Random card styles
❌ Random button styles
❌ Pure black everywhere in dark mode
❌ Pure white everywhere in light mode
❌ Excessive borders
❌ Excessive shadows
❌ Excessive gradients
❌ Excessive glassmorphism
❌ Every section inside a card
❌ Fake charts
❌ Fake notifications
❌ Fake availability
❌ Hardcoded production data
❌ Page-specific theme hacks
❌ Duplicate navigation implementations
❌ Emoji as a substitute for a proper icon system
```

---

# 41. Core Design Principle

The most important rule:

> **Do not make individual pages beautiful at the expense of making the product inconsistent.**

The design system is the source of visual truth.

The implementation flow should be:

```text
Design Tokens
      ↓
Reusable Primitives
      ↓
Shared Components
      ↓
Role Shells
      ↓
Domain Components
      ↓
Pages
      ↓
Light/Dark QA
      ↓
Responsive QA
      ↓
Accessibility QA
```

---

# 42. Final Design Goal

Suggest Key should feel like one coherent product.

A user should be able to move from:

```text
Home
→ Mentor Discovery
→ Mentor Detail
→ Slot Selection
→ Payment
→ Booking
→ Session
→ Workspace
```

without feeling that each page was designed by a different person.

The same should be true for:

```text
Mentor
→ Availability
→ Bookings
→ Session
→ Workspace
```

and:

```text
Admin
→ Dashboard
→ Payments
→ Bookings
→ Mentors
→ Settings
```

The visual system must remain coherent across all roles while preserving their different jobs.

---

## 43. Short Theory

A strong frontend is not a collection of beautiful pages.

It is:

```text
Design System
+
Reusable Components
+
Consistent States
+
Responsive Layout
+
Theme Architecture
+
Accessibility
+
Real Application State
```

The objective is not merely to make the current UI prettier.

The objective is to create a frontend foundation where future Suggest Key features automatically look and behave like part of the same product.
