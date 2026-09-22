# SUGGEST KEY — MVP PRODUCT & TECHNICAL SPECIFICATION

Version: 1.0
Status: MVP
Product: Suggest Key
Document Type: Product + Technical Specification

---

# 1. PRODUCT OVERVIEW

Suggest Key is a mentorship marketplace that helps a seeker who needs mentorship connect with an appropriate mentor and book a 1:1 mentorship session.

The MVP supports three roles:

- Seeker
- Mentor
- Admin

The core product loop is:

Seeker discovers a mentor
→ selects a valid time slot
→ temporarily holds the slot
→ pays through manual QR payment
→ uploads payment proof
→ admin verifies payment
→ booking moves to mentor
→ mentor adds meeting link and confirms
→ seeker joins at the allowed time
→ session completes
→ session moves to history
→ mentor creates a session workspace with notes and suggestions

---

# 2. MVP PRINCIPLES

The following principles are mandatory.

## 2.1 Real Data Only

Production UI must never rely on fake, static, or hardcoded business data.

Examples that must come from the database:

- mentors
- seekers
- segments
- gigs
- prices
- availability
- bookings
- payment records
- notifications
- session notes
- meeting links

Seed/demo accounts may exist for development/testing, but production functionality must use real Supabase data.

---

## 2.2 Backend Is the Source of Truth

The frontend must never be trusted for:

- booking conflicts
- payment status
- hold expiry
- session timing
- meeting access
- mentor confirmation
- availability
- role authorization

Critical business rules must be enforced server-side/database-side.

---

## 2.3 Mentor Owns the Global Availability Timeline

Availability belongs to the mentor.

Availability does NOT belong to a gig.

A mentor can have multiple gigs across multiple segments, but their time is globally shared.

Example:

Rahul:

Relationship Advisor
→ Gig A

Autism Mentor
→ Gig B

If Rahul's:

Wednesday 6:00 PM slot

is booked in Relationship Advisor,

the same:

Wednesday 6:00 PM

must be unavailable in Autism Mentor.

This is a fundamental business invariant.

---

# 3. ROLES

## 3.1 SEEKER

A seeker can:

- sign in
- manage their profile
- discover segments
- select a date
- discover available mentors
- view mentor profiles
- view mentor gigs
- view pricing
- select a slot
- hold a slot
- pay using QR
- upload payment proof
- view payment status
- view booking status
- receive notifications
- view upcoming sessions
- join sessions during the allowed window
- view completed sessions
- access session workspace
- cancel eligible bookings
- reschedule eligible bookings

---

# 3.2 MENTOR

A mentor can:

- sign in
- manage profile
- manage segments they mentor
- create one gig per segment
- configure gig pricing
- configure gig duration
- manage global availability
- configure recurring weekly availability
- configure date exceptions
- view bookings
- view seeker information relevant to the booking
- see segment/gig details
- see exact booked time
- add meeting links
- confirm sessions
- receive notifications
- join sessions during allowed time
- view completed sessions
- create/edit session workspace notes
- provide takeaways
- provide suggestions
- provide next steps

A mentor must be approved/activated by Admin before becoming discoverable to seekers.

---

# 3.3 ADMIN

Admin is the operational control layer.

Admin can:

- manage seekers
- create seekers
- edit seekers
- activate/deactivate seekers
- manage mentors
- create mentors
- edit mentors
- approve mentors
- activate/deactivate mentors
- manage segments
- create segments
- edit segments
- archive/deactivate segments
- reorder segment priority
- manage gigs
- view availability
- view bookings
- view payment submissions
- approve payments
- reject payments
- cancel bookings where required
- intervene in booking issues
- view session information
- view notifications
- view session workspaces
- manage platform settings

Admin is the final authority for manual payment verification.

---

# 4. INFORMATION ARCHITECTURE

The application uses role-specific navigation.

## 4.1 SEEKER APP

The seeker application uses a clean top navigation. There is NO sidebar for seekers.

Primary navigation:

1. Home
2. My Bookings
3. Notifications
4. Settings

### Seeker navigation responsibilities

**Home**
- mentorship discovery
- active segment
- date selection
- mentor discovery
- booking flow

**My Bookings**
- upcoming bookings
- completed/history
- cancelled/rejected bookings
- booking/session details
- join session when eligible

**Notifications**
- in-app notifications

**Settings**
- profile
- personal information
- profile photo
- bio
- timezone
- security/password
- notification preferences
- account settings

There must NOT be a separate Profile sidebar/top-level navigation item.

Profile/account functionality belongs inside Settings.

---

## 4.2 MENTOR APP

The mentor application uses a clean top navigation. There is NO sidebar for mentors.

Primary navigation:

1. Home
2. My Bookings
3. Availability
4. Notifications
5. Settings

### Mentor navigation responsibilities

**Home**
- mentor operational overview
- today's/upcoming sessions
- pending confirmations
- relevant booking actions

**My Bookings**
- pending bookings
- upcoming bookings
- completed/history
- cancelled bookings
- booking/session details
- meeting-link and confirmation actions

**Availability**
- global recurring availability
- date-specific exceptions
- availability management

**Notifications**
- in-app notifications

**Settings**
- profile
- personal information
- profile photo
- bio
- timezone
- security/password
- notification preferences
- account settings
- segments
- gigs

Mentor profile, segments and gigs are managed from Settings, while Availability remains a dedicated primary navigation item because it is a core mentor workflow.

---

## 4.3 ADMIN APP

Admin uses a dedicated sidebar because the Admin application has substantially more operational content than the seeker/mentor applications.

Recommended sidebar navigation:

- Dashboard
- Users
- Mentors
- Segments
- Bookings
- Payments
- Notifications
- Settings

The admin sidebar may also contain a bottom account area for:

- Admin profile
- Logout

Admin navigation is not constrained by the seeker/mentor navigation structure.

---

## 4.4 ROLE-SPECIFIC APP SHELL

The application must render the appropriate shell based on the authenticated user's role.

```text
Authenticated User
        |
        v
    Role Check
        |
   +----+----+----+
   |         |    |
Seeker    Mentor Admin
   |         |    |
   v         v    v
Top Nav    Top Nav Sidebar
```

The navigation configuration must be centralized and role-aware.

Do NOT duplicate navigation definitions independently across every page.

Conceptually:

```text
Seeker:
Home
My Bookings
Notifications
Settings

Mentor:
Home
My Bookings
Availability
Notifications
Settings

Admin:
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

## 4.5 GLOBAL UI DIRECTION

The navigation change is a global application-shell decision.

### Seeker + Mentor

The user-facing applications should have:

- top navigation
- clean content canvas
- minimal visual clutter
- contextual primary actions
- responsive navigation on mobile

The sidebar pattern should NOT be used for seeker/mentor primary navigation.

### Admin

The admin application should have:

- persistent sidebar on desktop
- dense operational information architecture
- quick access to operational queues
- dashboard-oriented layouts
- responsive/collapsible sidebar behavior on smaller screens

Admin UI may be denser than seeker/mentor UI because its primary purpose is operational control.

---

## 4.6 ROLE-SPECIFIC PRODUCT JOBS

Navigation and content should reflect the primary job of each role.

### Seeker

```text
Discover
→ Select
→ Book
→ Attend
→ Review outcome
```

### Mentor

```text
Manage availability
→ Manage bookings
→ Confirm
→ Conduct session
→ Document outcome
```

### Admin

```text
Monitor
→ Verify
→ Control
→ Resolve
```

---

# 5. SEGMENTS

Segments represent mentorship categories.

Examples:

- Relationship Advisor
- Autism Mentor
- Career Mentor

These are examples only.

Admin creates and controls actual production segments.

---

## 5.1 Segment fields

Recommended fields:

- id
- name
- slug
- description
- image/icon if required by UI
- is_active
- priority
- created_at
- updated_at

---

## 5.2 Segment priority

Admin controls segment priority.

Example:

1. Relationship Advisor
2. Autism Mentor
3. Career Mentor

When a seeker enters Home, the highest-priority active segment is automatically selected.

No hardcoded default segment is allowed.

---

# 6. MENTOR SEGMENT MEMBERSHIP

A mentor can belong to multiple segments.

Example:

Rahul:

- Relationship Advisor
- Autism Mentor

A mentor only becomes discoverable for a segment if:

1. mentor is approved
2. mentor is active
3. mentor has an active gig for that segment
4. mentor has at least one valid bookable slot on the selected date

---

# 7. GIGS

A gig describes what a mentor offers inside a segment.

A mentor can have:

- one gig per segment

A mentor cannot have multiple active gigs inside the same segment.

---

## 7.1 Gig fields

Recommended:

- id
- mentor_id
- segment_id
- title
- description
- duration_minutes
- price
- currency
- is_active
- created_at
- updated_at

---

## 7.2 Database invariant

Enforce:

UNIQUE(mentor_id, segment_id)

This prevents duplicate gigs for the same mentor and segment.

---

# 8. MENTOR PROFILE

Recommended mentor profile fields:

- user_id
- display_name
- profile_photo
- short_bio
- timezone
- approval_status
- is_active
- created_at
- updated_at

Optional future fields:

- qualifications
- experience
- languages
- expertise tags
- social links
- website

These are not required for MVP unless UI requires them.

---

# 9. SEEKER PROFILE

MVP seeker profile should remain intentionally simple.

Recommended:

- user_id
- display_name
- profile_photo
- short_bio
- timezone
- created_at
- updated_at

Do not collect unnecessary personal information.

---

# 10. HOME / DISCOVERY FLOW

After login:

Seeker
→ Home

Home automatically selects the highest-priority active segment.

Example:

Segment:

Relationship Advisor

Then seeker selects:

Date:

18 March 2026

The application fetches mentors who satisfy ALL conditions:

- approved mentor
- active mentor
- belongs to selected segment
- has active gig for selected segment
- has at least one valid bookable slot on selected date

---

# 11. FIND ALL MENTORS

Home contains:

[ Find All Mentors ]

The mentor list should represent actual bookability.

A mentor with zero valid slots on the selected date should NOT appear in the available mentor results.

This avoids showing mentors who cannot actually be booked.

---

# 12. MENTOR DISCOVERY CARD

Recommended information:

- profile photo
- mentor name
- short bio
- segment
- gig title
- duration
- price
- next available slot
- availability indicator

Example:

Mentor:
Rahul Sharma

Relationship Advisor

60 min
₹999

Available today

[ View Mentor ]

---

# 13. MENTOR DETAIL PAGE

Mentor detail should show:

- mentor photo
- name
- bio
- selected segment
- gig title
- gig description
- duration
- price
- selected date
- available slots

Primary action:

[ Book Session ]

---

# 14. GLOBAL AVAILABILITY

Mentor availability is global.

It is NOT attached to a gig.

---

# 15. RECURRING AVAILABILITY

Mentors should be able to configure weekly availability.

Example:

Monday
10:00–13:00
17:00–20:00

Tuesday
09:00–12:00

Wednesday
17:00–21:00

---

# 16. DATE EXCEPTIONS

Mentors can override normal availability for specific dates.

Examples:

18 March
Unavailable

25 March
14:00–18:00

Date-specific exceptions override recurring availability.

---

# 17. SLOT GENERATION

Slots are derived from:

- mentor availability
- gig duration
- selected date
- mentor timezone
- current time
- existing bookings
- active holds
- booking status
- exceptions

Slots must be generated dynamically.

Do NOT hardcode slots.

---

# 18. TODAY'S SLOT RULE

If selected date is today:

Past slots must not appear.

Example:

Current time:

3:30 PM

Slot:

2:00 PM

must not be bookable.

A slot must also account for timezone conversion.

---

# 19. GLOBAL SLOT CONFLICT

A mentor's timeline is globally shared.

Example:

Rahul has:

6:00 PM slot

Relationship Advisor booking:

6:00 PM

Then:

Autism Mentor
6:00 PM

must also be unavailable.

Conflict checking must use mentor_id + actual time interval.

Not:

mentor_id + gig_id

---

# 20. BOOKING SYSTEM

Booking is a stateful process.

Core flow:

Seeker selects slot
→ Hold
→ Payment
→ Admin verification
→ Mentor pending
→ Mentor confirmation
→ Confirmed
→ Session
→ Completed
→ History

---

# 21. SLOT HOLD

When seeker selects a slot:

A temporary hold is created.

Hold duration:

15 minutes.

Example:

10:00 PM

hold created

expires:

10:15 PM

During active hold:

The slot is unavailable to every other seeker.

---

# 22. HOLD EXPIRATION

When hold expires:

- hold becomes expired
- slot becomes available
- payment-pending booking is invalidated/released if applicable
- another seeker can book the slot

Expiration must be enforced server-side.

Frontend timers alone are insufficient.

---

# 23. PAYMENT

MVP payment method:

Manual QR payment.

Future payment provider:

Razorpay.

Payment architecture must be provider-abstracted.

The booking engine should NOT be tightly coupled to QR payment.

Future migration should look conceptually like:

Manual QR Provider
→ Razorpay Provider

without rewriting:

- availability
- slot locking
- booking
- session
- mentor confirmation

---

# 24. PAYMENT FLOW

After slot hold:

Show payment screen.

Payment screen contains:

- booking summary
- mentor
- segment
- date
- time
- duration
- amount
- QR code
- payment instructions
- payment deadline
- payment proof upload

Seeker submits:

- payment proof/screenshot
- confirmation that payment has been made

---

# 25. PAYMENT STATUS

Recommended statuses:

- pending
- approved
- rejected

---

# 26. PAYMENT APPROVAL

Admin reviews payment proof.

If approved:

Payment:

approved

Booking:

mentor_pending

Hold:

released

But the booking itself continues to block the mentor's time.

The slot does NOT become available just because the temporary hold ended.

---

# 27. PAYMENT REJECTION

If Admin rejects payment:

Booking:

rejected

Hold:

released

Slot:

available again

Seeker receives an in-app notification.

---

# 28. MENTOR PENDING STATE

After Admin approves payment:

Mentor receives the booking.

Booking status:

MENTOR_PENDING

Meaning:

Payment is verified, but mentor has not yet added the meeting link and confirmed the session.

---

# 29. MENTOR BOOKING VIEW

Mentor must see full booking context.

Example:

NEW SESSION

Seeker:
Aman Kumar

Segment:
Relationship Advisor

Gig:
Relationship Guidance Session

Date:
18 March 2026

Time:
4:00 PM – 5:00 PM

Duration:
60 minutes

Payment:
Verified

Status:
Pending Confirmation

Meeting Link:
[ Add meeting link ]

[ Confirm Session ]

---

# 30. MEETING LINK

Mentor can add any valid meeting URL.

Examples may include:

- Google Meet
- Zoom
- Microsoft Teams
- other valid HTTPS meeting platforms

The application should validate that the URL is a valid HTTPS URL.

---

# 31. MENTOR CONFIRMATION

Mentor must add a meeting link before confirming.

Confirmation action:

[ Confirm Session ]

After successful confirmation:

Booking:

CONFIRMED

Seeker receives notification.

Mentor receives confirmation state.

---

# 32. MEETING LINK DEADLINE

Mentor should add the meeting link at least:

2 hours before session start.

Example:

Session:

4:00 PM

Recommended deadline:

2:00 PM

If the deadline passes:

- booking remains active
- admin is notified/flagged
- mentor can still add the link
- system records the missed deadline

Do not automatically cancel solely because the mentor missed this deadline.

---

# 33. MEETING LINK VISIBILITY

Meeting link must NOT be visible to seeker immediately after confirmation.

The link becomes available:

5 minutes before session start.

Example:

Session:

4:00 PM – 5:00 PM

Meeting link becomes visible:

3:55 PM

---

# 34. SESSION COUNTDOWN

Before the 5-minute access window:

Show countdown.

Example:

Session starts in:

5:00

4:59

4:58

...

At 4:00 minutes:

Session starts in 4 minutes

...

At 0:

[ Join Session ]

This should update dynamically.

---

# 35. JOIN SESSION RULES

Before T−5 minutes:

Join is blocked.

At T−5 minutes:

Join becomes available.

During session:

Join is available.

After session end:

Join is disabled.

Example:

4:00–5:00 session

3:54:

blocked

3:55:

join enabled

4:30:

join enabled

5:00:

session ended

5:01:

join disabled

---

# 36. SERVER-SIDE SESSION ACCESS

Session access must be validated server-side.

Pseudo-rule:

if now < start_time - 5 minutes:

DENY

if start_time - 5 minutes <= now < end_time:

ALLOW

if now >= end_time:

DENY

Frontend countdown is only UX.

It is not a security mechanism.

---

# 37. SESSION COMPLETION

After end_time:

Session becomes:

COMPLETED

The booking moves out of active/upcoming sessions.

It appears in:

History.

---

# 38. MY BOOKINGS

My Bookings should have:

## Upcoming

Future sessions that are:

- pending mentor confirmation
- confirmed
- otherwise legitimately active

## History

Completed sessions.

## Cancelled

Cancelled/rejected sessions.

---

# 39. SESSION HISTORY

Each completed booking becomes a historical session.

Example:

Relationship Advisor

Rahul Sharma

18 March 2026

4:00 PM – 5:00 PM

Completed

[ Open Workspace ]

---

# 40. SESSION WORKSPACE

Every completed session has a workspace.

The workspace is attached to that specific booking/session.

It should contain:

## Session Overview

- mentor
- seeker
- segment
- gig
- date
- time
- duration
- status

---

## Mentor Notes

Free-form notes about the session.

---

## Key Takeaways

Important things the seeker should remember.

---

## Suggestions / Recommendations

Practical recommendations from the mentor.

---

## Next Steps

Actions the seeker should take after the session.

---

## Follow-up Recommendation

Optional:

- No follow-up needed
- Follow-up recommended

If recommended:

- suggested timeframe
- reason

---

# 41. SESSION WORKSPACE VISIBILITY

Mentor:

Can create/edit workspace content.

Seeker:

Can view mentor-published workspace content.

Admin:

Can view workspace for operational/support purposes.

Do not expose private internal mentor notes unless explicitly designed as seeker-visible content.

Recommended MVP implementation:

All workspace fields are seeker-visible after mentor saves them.

If private notes are required later, introduce separate private fields.

---

# 42. CANCELLATION POLICY

Seeker cancellation:

Allowed only when:

session_start >= 24 hours from now

If within 24 hours:

cancellation is not allowed through normal seeker UI.

Admin can intervene.

---

# 43. MENTOR CANCELLATION

If mentor cancels:

Booking becomes cancelled.

Seeker receives notification.

Admin is notified.

The system should support:

- rescheduling
- refund/payment resolution

Because payment is manually verified in MVP, refund handling can remain an Admin-controlled operational workflow.

---

# 44. RESCHEDULING

Reschedule is allowed at least:

24 hours before session start.

New slot must be genuinely available.

The new slot must pass the same global mentor conflict checks.

Past slots are never allowed.

---

# 45. PAST BOOKINGS

Past bookings must never be bookable.

The system must reject:

- past dates
- past time slots
- expired holds
- already-booked intervals

This must be enforced server-side.

---

# 46. BOOKING STATES

Recommended booking state machine:

PAYMENT_PENDING
        |
        +---- REJECTED
        |
        v
MENTOR_PENDING
        |
        +---- CANCELLED
        |
        v
CONFIRMED
        |
        +---- CANCELLED
        |
        v
IN_PROGRESS
        |
        v
COMPLETED

---

# 47. PAYMENT STATES

PENDING
   |
   +---- REJECTED
   |
   v
APPROVED

---

# 48. HOLD STATES

ACTIVE
  |
  +---- EXPIRED
  |
  +---- RELEASED

---

# 49. IMPORTANT BOOKING INVARIANTS

These must always hold.

## Invariant 1

One mentor cannot have overlapping active bookings.

## Invariant 2

One mentor cannot have overlapping active hold + booking conflicts.

## Invariant 3

A mentor's availability is shared across all gigs.

## Invariant 4

One mentor can have only one gig per segment.

## Invariant 5

A mentor without an active gig for a selected segment cannot be discovered for that segment.

## Invariant 6

A mentor with no valid slot on the selected date must not appear in available mentor results.

## Invariant 7

Past slots cannot be booked.

## Invariant 8

Expired holds release the slot.

## Invariant 9

Payment rejection releases the slot.

## Invariant 10

Payment approval transfers responsibility to mentor without releasing the time slot.

## Invariant 11

Meeting link is hidden until T−5 minutes.

## Invariant 12

Session cannot be joined before T−5 minutes.

## Invariant 13

Session cannot be joined after end time.

## Invariant 14

Mentor confirmation requires a meeting link.

---

# 50. NOTIFICATIONS

MVP uses in-app notifications only.

Recommended notification fields:

- id
- user_id
- type
- title
- message
- related_entity_type
- related_entity_id
- is_read
- created_at

---

# 51. NOTIFICATION EVENTS

## Seeker

- booking created
- payment submitted
- payment approved
- payment rejected
- mentor pending
- mentor confirmed
- meeting link available
- session starting soon
- mentor cancelled
- booking rescheduled
- session completed
- workspace updated

## Mentor

- payment approved
- new booking pending confirmation
- meeting link deadline approaching
- meeting link overdue
- session starting soon
- seeker cancelled
- booking rescheduled
- session completed

## Admin

- payment proof submitted
- mentor link overdue
- mentor cancellation
- booking requiring intervention

---

# 52. TIMEZONE MODEL

Store timestamps in UTC.

Users have a timezone.

Mentor availability should be interpreted in mentor timezone.

Seeker discovery/booking UI should clearly communicate the displayed timezone.

The actual booking interval should be stored as an unambiguous UTC instant/range.

Never perform business logic using browser-local time alone.

---

# 53. DATABASE ARCHITECTURE

Recommended core entities:

users
profiles
user_roles

segments
mentor_segments

mentor_profiles
seeker_profiles

gigs

mentor_availability
mentor_availability_exceptions

slot_holds

bookings

payments

notifications

session_workspaces

---

# 54. PROFILE / ROLE MODEL

Supabase Auth remains responsible for authentication.

Application profile data lives separately.

Recommended:

profiles
    id = auth.users.id
    display_name
    profile_photo
    timezone
    ...

user_roles
    user_id
    role

Roles:

- seeker
- mentor
- admin

Do not store passwords in application tables.

---

# 55. SECURITY

RLS must be enabled.

## Seeker

Can access:

- own profile
- own bookings
- own payments
- own notifications
- own session workspaces
- public mentor information
- active segments
- bookable availability

Cannot modify:

- payment approval
- booking state
- mentor availability
- another user's data

---

## Mentor

Can access:

- own profile
- own gigs
- own availability
- own bookings
- relevant seeker booking information
- own notifications
- own session workspaces

Cannot:

- approve own payment
- alter another mentor's availability
- access unrelated seeker private information
- manipulate booking ownership

---

## Admin

Admin can access operational data required to manage the platform.

Admin actions must still be auditable where appropriate.

---

# 56. PAYMENT PROOF STORAGE

Payment screenshots should use private storage.

Recommended:

payment-proofs

Storage must not be publicly accessible.

Use authenticated/signed access for Admin review.

Do not store public permanent URLs for payment screenshots.

---

# 57. ADMIN AUDITABILITY

Important admin actions should be traceable.

Recommended audit events:

- mentor approved
- mentor deactivated
- segment created
- segment edited
- segment priority changed
- payment approved
- payment rejected
- booking cancelled
- booking manually changed
- user created
- user role changed

---

# 58. ADMIN DASHBOARD

Dashboard should provide operational visibility.

Recommended metrics:

- total seekers
- total mentors
- pending mentor approvals
- pending payments
- mentor-pending bookings
- upcoming sessions
- completed sessions
- cancelled sessions

Do not fabricate numbers.

Every number must come from real database queries.

---

# 59. SETTINGS

Settings is the central account-management area.

## Seeker

- profile
- personal information
- profile photo
- bio
- timezone
- security/password
- notification preferences
- account settings

## Mentor

Everything above plus:

- segments
- gigs
- availability

---

# 60. AUTHENTICATION

Authentication should use the existing Supabase Auth architecture.

Do not build custom password storage.

Application authorization must be role-based.

After login:

Seeker
→ Home

Mentor
→ Mentor Home

Admin
→ Admin Dashboard

Users must not be able to access another role's protected application routes merely by manipulating URLs.

---

# 61. ERROR HANDLING

Every important operation must have:

- loading state
- empty state
- error state
- success state

Examples:

No mentors available:

"No mentors are available for this segment and date."

No slots:

"No bookable slots available."

Payment rejected:

"Payment could not be verified. Please review the payment details and try again."

Hold expired:

"Your slot hold expired. Please select another available slot."

---

# 62. CONCURRENCY / DOUBLE BOOKING

This is a high-priority engineering requirement.

Two seekers may attempt to book:

same mentor
same slot
at almost the same time.

The database/backend must guarantee that only one succeeds.

Do NOT depend on:

- frontend disabled buttons
- React state
- localStorage
- client-side availability checks

Use database constraints/transactions/locking or an equivalent atomic server-side booking mechanism.

---

# 63. BOOKING TRANSACTION

Conceptually:

1. validate user
2. validate mentor
3. validate gig
4. validate segment
5. validate selected time
6. validate timezone conversion
7. validate future time
8. validate mentor availability
9. validate exceptions
10. check conflicting booking
11. check active hold
12. create hold
13. create payment-pending booking
14. commit atomically

If any critical step fails:

Do not create a partial booking.

---

# 64. REAL-TIME / FRESHNESS

Booking availability should be refreshed frequently enough to avoid stale slots.

When a user opens a mentor/date:

fetch fresh availability.

After booking/hold:

refresh availability.

After hold expiry:

availability must become bookable again.

If realtime is used, it can improve UX, but server validation remains authoritative.

---

# 65. GLOBAL NAVIGATION IMPLEMENTATION RULES

The navigation architecture is part of the global UI system and must not be implemented as page-specific ad hoc navigation.

## 65.1 Navigation Components

Recommended shared structure:

```text
AppShell
├── SeekerShell
│   ├── TopNavigation
│   └── MainContent
│
├── MentorShell
│   ├── TopNavigation
│   └── MainContent
│
└── AdminShell
    ├── Sidebar
    └── MainContent
```

---

## 65.2 Navigation Configuration

Navigation should be driven from a centralized role-aware configuration.

Do not hardcode different navigation menus independently inside every page.

The authenticated role determines the shell and navigation configuration.

---

## 65.3 Responsive Behavior

### Seeker

Desktop:
- horizontal top navigation

Mobile:
- compact header
- navigation may collapse into a menu/sheet

### Mentor

Desktop:
- horizontal top navigation

Mobile:
- compact header
- navigation may collapse into a menu/sheet

### Admin

Desktop:
- persistent sidebar

Mobile:
- collapsible sidebar/drawer

---

## 65.4 Authorization

Changing the navigation UI must NOT be treated as authorization.

A user must not gain access to another role's protected routes by changing URLs or manipulating the client.

Role authorization must remain enforced server-side/database-side through the existing authentication and RLS architecture.

---

# 100. UI/UX PRINCIPLES

The UI should feel like a modern premium mentorship platform.

Avoid:

- generic SaaS dashboard appearance
- excessive repeated cards
- unnecessary tables for user-facing flows
- hardcoded demo data
- fake charts
- fake availability
- fake notifications
- confusing multi-step navigation

Prioritize:

- clear hierarchy
- strong mentor discovery
- obvious booking CTA
- clean slot selection
- transparent payment flow
- clear status communication
- countdown-driven session experience
- useful session history
- polished empty/loading/error states

The existing design system/reference files may be used for visual direction, but product logic and the role-specific navigation architecture must come from this document.

---

# 100. PRIMARY SEEKER FLOW

```text
Login
 ↓
Home
 ↓
Auto-selected Segment
 ↓
Select Date
 ↓
Find All Mentors
 ↓
Mentor List
 ↓
Mentor Detail
 ↓
Select Slot
 ↓
15-minute Hold
 ↓
Payment QR
 ↓
Upload Payment Proof
 ↓
Payment Pending
 ↓
Admin Approves
 ↓
Mentor Pending
 ↓
Mentor Adds Meeting Link
 ↓
Mentor Confirms
 ↓
Confirmed
 ↓
T−5 Countdown
 ↓
Join Session
 ↓
Session Ends
 ↓
History
 ↓
Session Workspace