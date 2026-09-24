# Suggest Key — Project Memory

## Product
Suggest Key is a 1:1 mentorship marketplace.

## Core Loop
```text
Discover → Select slot → Hold → Pay → Admin verify
→ Mentor confirm → Join → Complete → Workspace
```

## Roles

### Seeker
Job: Discover → Book → Attend → Review outcome  
Navigation: Home, My Bookings, Notifications, Settings  
Shell: Top navigation.

### Mentor
Job: Manage availability → Manage bookings → Conduct → Document outcome  
Navigation: Home, My Bookings, Availability, Notifications, Settings  
Shell: Top navigation.

### Admin
Job: Monitor → Verify → Control → Resolve  
Navigation: Dashboard, Users, Mentors, Segments, Bookings, Payments, Notifications, Settings  
Shell: Sidebar.

## Critical Invariants
- Real database data only in production.
- Backend/database is source of truth.
- Mentor availability is global.
- No overlapping active mentor bookings.
- No conflicting active holds/bookings.
- One active gig per mentor/segment.
- Mentor must be approved, active, have active gig and valid slot to be discoverable.
- Past slots cannot be booked.
- Hold = 15 minutes.
- Payment rejection releases slot.
- Payment approval keeps slot blocked.
- Meeting link hidden until T-5.
- Session access is server-authorized.
- Mentor confirmation requires meeting link.

## States
Booking:
PAYMENT_PENDING → MENTOR_PENDING → CONFIRMED → IN_PROGRESS → COMPLETED

Payment:
PENDING → APPROVED / REJECTED

Hold:
ACTIVE → EXPIRED / RELEASED

## Entities
profiles, user_roles, segments, mentor_segments, mentor_profiles, seeker_profiles, gigs, mentor_availability, mentor_availability_exceptions, slot_holds, bookings, payments, notifications, session_workspaces

## Payment
Current: Manual QR  
Future: Razorpay

## Time
Store timestamps in UTC. Mentor availability uses mentor timezone. Browser-local time is not authoritative.

## Workspace
Overview, mentor notes, key takeaways, suggestions, next steps, optional follow-up recommendation.

## UI Direction
Seeker/mentor: clean top navigation and focused user experience.  
Admin: operational sidebar and denser dashboard.

## Build Philosophy
Build the core loop first, then expand page-by-page and function-by-function.

```text
Foundation
→ Auth/Roles
→ DB/RLS
→ Availability
→ Booking
→ Payment
→ Admin verification
→ Mentor confirmation
→ Session access
→ Workspace
→ Notifications
→ Polish
→ Testing
```

## Future Direction
Potential future areas include intelligent mentor matching and structured mentorship outcome intelligence. These are not MVP requirements.
