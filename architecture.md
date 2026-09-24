# Suggest Key — Architecture

Version: 1.0  
Status: MVP

## 1. Core Principles
- Supabase/PostgreSQL is the source of truth for business state.
- Production business data must be real database data.
- Supabase Auth handles authentication.
- RLS/server-side authorization protects private data.
- Critical booking, availability, payment, timing, and session rules are server/database enforced.
- Mentor availability is global across all gigs.
- Payment is provider-abstracted.
- UI is role-specific.

## 2. Role Shells

```text
Authenticated User
        |
        v
    Role Check
   /     |      Seeker Mentor   Admin
  |       |       |
Top Nav Top Nav Sidebar
```

### Seeker Top Navigation
- Home
- My Bookings
- Notifications
- Settings

### Mentor Top Navigation
- Home
- My Bookings
- Availability
- Notifications
- Settings

### Admin Sidebar
- Dashboard
- Users
- Mentors
- Segments
- Bookings
- Payments
- Notifications
- Settings

## 3. Suggested Stack
- Next.js + TypeScript
- Tailwind CSS
- shadcn/ui
- Framer Motion
- Supabase Auth
- PostgreSQL
- Supabase Storage
- Vercel
- GitHub
- Playwright + Vitest
- Sentry
- PostHog

## 4. Core Data Model
```text
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
```

## 5. Availability
Availability belongs to the mentor, not the gig.

```text
Mentor
 ├─ recurring availability
 ├─ date exceptions
 ├─ bookings
 └─ active holds
        ↓
   Slot generation
```

Slots use mentor timezone, gig duration, selected date, current time, exceptions, bookings and holds.

## 6. Booking State Machine
```text
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
```

Booking creation must be atomic and concurrency-safe.

## 7. Payment
MVP: Manual QR.  
Future: Razorpay.

Payment states:
- pending
- approved
- rejected

Payment provider must not be tightly coupled to booking logic.

## 8. Session Access
```text
now < start - 5m       → DENY
start - 5m <= now < end → ALLOW
now >= end              → DENY
```

Meeting link requires a valid HTTPS URL and mentor confirmation requires a meeting link.

## 9. Security
- RLS mandatory.
- Payment proof storage private.
- Seeker can access own private data.
- Mentor can access own resources and relevant booking data.
- Admin has required operational access.
- Client-side checks never replace server authorization.

## 10. Architecture Rule
Business rules belong in server/database logic. UI represents valid backend state.
