-- Suggest Key Complete Database Schema (Phase 3 & Phase 4 MVP)
-- Tables: profiles, user_roles, segments, mentor_segments, mentor_profiles, seeker_profiles,
--         gigs, mentor_availability, mentor_availability_exceptions, slot_holds,
--         bookings, payments, notifications, session_workspaces
-- Security: Row Level Security (RLS), concurrency-safe exclusion constraints, RPCs, private storage

\i migrations/20260920000000_phase3_auth_roles.sql
\i migrations/20260920000001_phase4_mvp_schema.sql
\i migrations/20260920000002_phase5_seed_discovery.sql
\i migrations/20260920000003_phase6_atomic_booking.sql
\i migrations/20260921000001_phase10_session_workspace.sql
\i migrations/20260921000002_phase11_notifications.sql
