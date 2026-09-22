# Suggest Key — Rules

Version: 1.0  
Status: MVP

## Non-Negotiable Rules

### Data
1. No fake production business data.
2. Business data comes from Supabase.
3. Seed/demo data is only for development/testing.
4. Backend/database is authoritative.

### Authorization
1. Supabase Auth handles authentication.
2. Roles: seeker, mentor, admin.
3. RLS is mandatory.
4. Client-side role checks are not security.
5. Users cannot access another role's protected data/routes.
6. Ownership and role permissions are enforced server-side.

### Navigation
- Seeker: top navigation.
- Mentor: top navigation.
- Admin: sidebar.
- Navigation configuration is centralized and role-aware.

### Mentor
1. Mentor must be approved and active before discovery.
2. Mentor can belong to multiple segments.
3. One active gig per mentor/segment.
4. Availability is global across gigs.

### Availability
1. Never hardcode slots.
2. Use mentor timezone.
3. Store actual timestamps in UTC.
4. Date exceptions override recurring availability.
5. Past slots are never bookable.
6. Bookings and active holds must be included in conflict checks.

### Booking
1. Booking is a state machine.
2. Critical transitions are server-side.
3. No overlapping active bookings for a mentor.
4. No overlapping active hold/booking conflicts.
5. Booking creation is atomic.
6. Failed validation creates no partial booking.

### Hold
- Duration: 15 minutes.
- ACTIVE → EXPIRED or RELEASED.
- Expiration is server-side.
- Expired holds release slots.

### Payment
- MVP: manual QR.
- States: pending, approved, rejected.
- Admin verifies payments.
- Payment proof is private.
- Payment architecture must support future provider replacement.

### Confirmation
- Mentor must add HTTPS meeting link before confirmation.
- Recommended deadline: 2 hours before session.
- Missing deadline does not automatically cancel booking.

### Session
- Link hidden until T-5.
- Join denied before T-5.
- Join allowed from T-5 through end.
- Join denied after end.
- Server-side session access is authoritative.

### Cancellation
- Seeker normal cancellation: ≥24 hours before start.
- Mentor cancellation notifies seeker and admin.
- Admin can intervene.

### Rescheduling
- Normal rescheduling: ≥24 hours before start.
- New slot must pass normal availability/conflict rules.

### UI
1. UI reflects real backend state.
2. Important operations need loading/empty/error/success states.
3. No fake charts or availability.
4. Seeker/mentor UI remains clean.
5. Admin UI may be dense.
6. Avoid unnecessary navigation.

### Time
- UTC storage.
- User timezone stored.
- Mentor availability interpreted in mentor timezone.
- Browser-local time is never the business source of truth.

### Development
1. Do not rewrite unrelated modules.
2. Do not bypass business rules.
3. Reuse shared UI components.
4. Keep business logic out of presentation where practical.
5. Test critical time/state/booking logic.
6. Prefer incremental vertical slices.

### Definition of Done
A feature is done only when real data, authorization, server-side rules, states, edge cases and relevant tests work.
