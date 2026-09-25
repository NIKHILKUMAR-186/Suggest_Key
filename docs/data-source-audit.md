# Data Source Audit: Hardcoded Business Data → Supabase Dynamic Data

## Entity Mapping Table

| Business Entity | Current Source (Hardcoded/Fallback) | Required Source (Database) | Files Using It | Migration Required | Status |
|-----------------|--------------------------------------|----------------------------|----------------|-------------------|--------|
| **Mentor Names** | `bookingService.ts`: "Rahul Sharma", "Ananya Patel", "Dr. Vikram Joshi", "Aman Kumar"<br>`LoginPage.tsx`: same names<br>`MentorBookingDetailPage.tsx`: same names<br>`SignUpPage.tsx`: same names<br>`MentorSignupPage.tsx`: same names | `profiles` table (full_name) joined with `user_roles` (role='mentor') | `bookingService.ts`, `LoginPage.tsx`, `MentorBookingDetailPage.tsx`, `SignUpPage.tsx`, `MentorSignupPage.tsx`, `MentorGigsPage.tsx` | Replace all hardcoded mentor names with `discoveryService.getDiscoverableMentors()` or direct Supabase query | 🔴 Pending |
| **Mentor Prices** | `bookingService.ts`: 999, 1299, 1200, 1500 (INR)<br>`MentorGigsPage.tsx`: default price '999' | `mentor_profiles.hourly_rate` or `gigs.price` | `bookingService.ts`, `MentorGigsPage.tsx` | Query `mentor_profiles.hourly_rate` for mentor pricing; `gigs.price` for gig-specific pricing | 🔴 Pending |
| **Mentor Ratings** | `bookingService.ts`: 4.95, 4.98 (hardcoded fallbacks) | Calculated from `bookings` + `reviews` (if reviews table exists) or derived metric | `bookingService.ts` | Implement rating calculation from booking completion/feedback data | 🔴 Pending |
| **Segments/Categories** | `bookingService.ts`: "Relationship Advisor", "Autism Mentor"<br>`SignUpPage.tsx`: segment dropdown options<br>`MentorSignupPage.tsx`: segment selection | `segments` table (active segments only) | `bookingService.ts`, `SignUpPage.tsx`, `MentorSignupPage.tsx`, `SeekerHomePage.tsx`, `SeekerMentorListPage.tsx` | Replace with `discoveryService.fetchActiveSegments()` or direct `segments` query | 🔴 Pending |
| **Mentor-Segment Mapping** | `bookingService.ts`: hardcoded segment per mentor name | `mentor_segments` junction table | `bookingService.ts`, `SeekerMentorListPage.tsx` | Join `mentor_segments` → `segments` for each mentor | 🔴 Pending |
| **Availability (Recurring)** | `bookingService.ts`: hardcoded times 10:00, 11:00, 18:00, 09:00, 17:00, 19:00 per mentor<br>`MentorAvailabilityPage.tsx`: hardcoded recurring slots + exceptions<br>`LandingPage.tsx`: hardcoded availability display | `mentor_availability` table (day_of_week, start_time, end_time, is_active) | `bookingService.ts`, `MentorAvailabilityPage.tsx`, `LandingPage.tsx`, `slotEngine.ts` | Query `mentor_availability` for recurring slots; use `slotEngine.generateSlots()` with real data | 🔴 Pending |
| **Availability Exceptions** | `MentorAvailabilityPage.tsx`: hardcoded exception dates/times | `mentor_availability_exceptions` table | `MentorAvailabilityPage.tsx`, `slotEngine.ts` | Query exceptions and apply in slot generation | 🔴 Pending |
| **Slot Holds** | `bookingService.ts`: mock slot hold logic with localStorage fallback | `slot_holds` table (mentor_id, slot_start, slot_end, seeker_id, expires_at, status) | `bookingService.ts`, `slotEngine.ts` | Implement real slot hold CRUD with Supabase; enforce 10-min TTL server-side | 🔴 Pending |
| **Bookings** | `bookingService.ts`: hardcoded fallback bookings array with demo data | `bookings` table (all fields: mentor_id, seeker_id, gig_id, slot_start, slot_end, status, payment_status, etc.) | `bookingService.ts`, `AdminBookingsPage.tsx`, `MentorBookingDetailPage.tsx`, `SeekerDashboardPage.tsx` | Replace all mock bookings with real Supabase queries; enforce RLS | 🔴 Pending |
| **Payments** | `bookingService.ts`: hardcoded payment fallbacks with fake transaction IDs | `payments` table (booking_id, amount, currency, status, provider, provider_txn_id, webhook_payload) | `bookingService.ts`, `AdminDashboardPage.tsx` | Replace with real payment records; implement server-side state transitions (pending → captured/failed/refunded) | 🔴 Pending |
| **Notifications** | `notificationService.ts`: hardcoded notification presets and demo data<br>`bookingService.ts`: fallback notifications | `notifications` table (user_id, type, title, body, data, read_at, created_at) | `notificationService.ts`, `bookingService.ts`, `SeekerDashboardPage.tsx`, `MentorDashboardPage.tsx` | Replace all hardcoded notifications with real DB queries; implement real-time subscriptions | 🔴 Pending |
| **Dashboard Metrics (Admin)** | `AdminDashboardPage.tsx`: fetches from `/api/admin/metrics` but underlying data may be seeded | Aggregated queries: `bookings`, `payments`, `profiles`, `gigs` tables | `AdminDashboardPage.tsx` | Ensure API endpoint computes real metrics from live tables | 🟡 Partial |
| **Dashboard Metrics (Seeker/Mentor)** | Various dashboard pages may use mock data | Real queries on `bookings`, `payments`, `session_workspaces` | `SeekerDashboardPage.tsx`, `MentorDashboardPage.tsx` | Replace with live data queries | 🔴 Pending |
| **Session Workspaces** | `workspaceService.ts`: hardcoded demo workspace data (meeting URLs, notes, whiteboard) | `session_workspaces` table (booking_id, meeting_url, notes, whiteboard_state, recording_url, started_at, ended_at) | `workspaceService.ts`, `MentorBookingDetailPage.tsx`, `SeekerBookingDetailPage.tsx` | Replace demo data with real workspace records; generate meeting URLs server-side | 🔴 Pending |
| **Seed UUIDs** | Migration `20260924000001_phase13_seed_data.sql`: `00000000-0000-0000-0000-000000000001`, `00000000-0000-0000-0000-000000000002` | Real UUIDs from `auth.users` → `profiles` → `user_roles` | All files referencing seed users | Remove seed migration or make it idempotent for dev only; never reference seed UUIDs in code | 🔴 Pending |
| **Demo Meeting URLs** | `workspaceService.ts`: "https://meet.suggestkey.com/demo-session-*" | Generated per booking via video provider (Daily.co, Whereby, or custom) | `workspaceService.ts` | Implement server-side meeting URL generation on booking confirmation | 🔴 Pending |
| **Mentor Gig Data** | `MentorGigsPage.tsx`: hardcoded default price, mock gig creation | `gigs` table (mentor_id, title, description, price, duration_min, is_active, segment_id) | `MentorGigsPage.tsx`, `SeekerMentorListPage.tsx` | Full CRUD on `gigs` table; fetch mentor's gigs for seeker discovery | 🔴 Pending |
| **Seeker/Mentor Profiles** | `AuthContext.tsx`: demo auth fallback with hardcoded profiles | `profiles` + `seeker_profiles` / `mentor_profiles` tables | `AuthContext.tsx`, all dashboard pages | Remove demo fallback; enforce real profile completion flow | 🔴 Pending |

## Migration Priority Order

1. **Segments & Mentor Discovery** - Foundation for all seeker flows
2. **Mentor Availability & Slot Engine** - Core booking prerequisite
3. **Gigs & Pricing** - Mentor onboarding and seeker booking
4. **Bookings & Slot Holds** - Transactional core
5. **Payments** - Revenue flow
6. **Notifications** - Real-time engagement
7. **Session Workspaces** - Post-booking experience
8. **Dashboards (Admin/Seeker/Mentor)** - Observability
9. **Auth & Profile Completion** - User onboarding
10. **Seed Data Cleanup** - Dev/prod hygiene

## RLS Policy Checklist

- [ ] `profiles`: SELECT own, UPDATE own; mentors SELECT all mentors for discovery
- [ ] `user_roles`: SELECT own role
- [ ] `segments`: SELECT all active (public read)
- [ ] `mentor_segments`: SELECT for discovery; INSERT/UPDATE mentor own
- [ ] `mentor_profiles`: SELECT for discovery; INSERT/UPDATE mentor own
- [ ] `seeker_profiles`: SELECT own; INSERT/UPDATE own
- [ ] `gigs`: SELECT active for discovery; CRUD mentor own
- [ ] `mentor_availability`: SELECT for slot generation; CRUD mentor own
- [ ] `mentor_availability_exceptions`: SELECT for slot generation; CRUD mentor own
- [ ] `slot_holds`: SELECT/INSERT/UPDATE seeker own holds; mentor can view holds on their slots
- [ ] `bookings`: SELECT own (mentor/seeker); INSERT seeker; UPDATE mentor (confirm/cancel); payment webhook updates
- [ ] `payments`: SELECT own; INSERT payment webhook; UPDATE webhook only
- [ ] `notifications`: SELECT own; INSERT system triggers
- [ ] `session_workspaces`: SELECT/UPDATE participants of booking

## Files to Modify (Priority Order)

1. `src/lib/discoveryService.ts` - Already uses Supabase, verify completeness
2. `src/lib/slotEngine.ts` - Wire to real `mentor_availability` + exceptions
3. `src/lib/bookingService.ts` - **Largest migration**: remove ALL hardcoded fallbacks
4. `src/lib/workspaceService.ts` - Remove demo data, use real `session_workspaces`
5. `src/lib/notificationService.ts` - Remove hardcoded presets, use real `notifications`
6. `src/pages/seeker/SeekerHomePage.tsx` - Verify uses discoveryService
7. `src/pages/seeker/SeekerMentorListPage.tsx` - Verify uses discoveryService
8. `src/pages/mentor/MentorAvailabilityPage.tsx` - Replace hardcoded availability with DB CRUD
9. `src/pages/mentor/MentorGigsPage.tsx` - Replace hardcoded price, use `gigs` table
10. `src/pages/admin/AdminDashboardPage.tsx` - Verify real metrics from API
11. `src/pages/admin/AdminBookingsPage.tsx` - Remove dev fallback, use real bookings
12. `src/pages/public/LandingPage.tsx` - Remove hardcoded mentor showcase
13. `src/context/AuthContext.tsx` - Remove demo auth fallback
14. `supabase/migrations/20260924000001_phase13_seed_data.sql` - Remove or guard seed UUIDs