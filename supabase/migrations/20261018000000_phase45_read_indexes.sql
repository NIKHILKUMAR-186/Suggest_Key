-- =============================================================================
-- phase45: read-path indexes for the high-frequency screens
--
-- Goal: prepare for more data and users WITHOUT changing app behavior.
-- Every index below is backed by a real query found in pg_stat_statements or
-- in the code (server.ts / discoveryService.ts). No speculative indexes.
--
-- HOW TO APPLY:
--   This file uses plain CREATE INDEX (not CONCURRENTLY) so it runs under
--   `supabase db push`, which wraps every migration in a transaction.
--   CREATE INDEX CONCURRENTLY cannot run inside a transaction, so it is NOT
--   used here. That is safe because every table below is currently small
--   (1-39 rows), so a plain CREATE INDEX completes instantly and does not
--   meaningfully block writes.
--
--   IF any of these tables is large (tens of thousands of rows) by the time
--   you apply this, do NOT run it via `supabase db push`. Instead apply the
--   CONCURRENTLY variant per statement in the Supabase SQL Editor or psql,
--   e.g.:
--     CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bookings_mentor_start
--         ON public.bookings (mentor_id, start_time);
--   (repeat for each index below). CONCURRENTLY builds the index without
--   blocking INSERT/UPDATE/DELETE on a live table.
--
-- TO UNDO: run the matching DROP INDEX IF EXISTS statements at the bottom
--   (DROP INDEX works inside a transaction, so it is safe via db push).
--
-- Before/after EXPLAIN ANALYZE timings for each query are in the review
-- notes that accompany this migration. All EXPLAIN ANALYZE runs were
-- read-only SELECTs; no data-changing query was EXPLAINed.
-- =============================================================================

-- 1) mentor_availability -------------------------------------------------------
-- Query (slot grid, every mentor-availability page view, server.ts computeMentorSlotsForDate):
--   SELECT * FROM mentor_availability
--   WHERE mentor_id = $1 AND is_enabled = true;
-- Before: Seq Scan on mentor_availability (Filter: is_enabled AND mentor_id,
--         "Rows Removed by Filter: 39"). The existing idx_mentor_availability_lookup
--         is (mentor_id, day_of_week, is_enabled) and cannot serve this query
--         because day_of_week is not in the WHERE clause.
CREATE INDEX IF NOT EXISTS idx_mentor_availability_mentor_enabled
    ON public.mentor_availability (mentor_id, is_enabled);

-- 2) bookings: mentor's "My Bookings" list ------------------------------------
-- Query (GET /api/mentor/bookings, server.ts):
--   SELECT ... FROM bookings WHERE mentor_id = $1
--   ORDER BY start_time ASC LIMIT $2;
-- Before: Index Scan idx_bookings_mentor_status (mentor_id, status) then an
--         in-memory Sort on start_time. New index removes the sort.
CREATE INDEX IF NOT EXISTS idx_bookings_mentor_start
    ON public.bookings (mentor_id, start_time);

-- 3) bookings: seeker's "My Bookings" list ------------------------------------
-- Query (GET /api/seeker/bookings, server.ts):
--   SELECT ... FROM bookings WHERE seeker_id = $1
--   ORDER BY start_time DESC LIMIT $2;
-- Before: Index Scan idx_bookings_seeker_status (seeker_id, status) then an
--         in-memory Sort on start_time DESC. New index removes the sort.
CREATE INDEX IF NOT EXISTS idx_bookings_seeker_start_desc
    ON public.bookings (seeker_id, start_time DESC);

-- 4) notifications: in-app notification feed ----------------------------------
-- Query (notificationService.ts, 5,799 calls in pg_stat_statements):
--   SELECT * FROM notifications WHERE user_id = $1
--   ORDER BY created_at DESC LIMIT $2;
-- Before: Index Scan idx_notifications_user_unread (user_id, is_read, created_at)
--         then an in-memory Sort on created_at DESC. The is_read column in the
--         middle of the existing index breaks the ordering, so a dedicated
--         (user_id, created_at DESC) index removes the sort.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created_desc
    ON public.notifications (user_id, created_at DESC);

-- 5) mentor_applications: admin verification queue ----------------------------
-- Query (GET /api/admin/mentor-applications, server.ts):
--   SELECT ... FROM mentor_applications WHERE status = $1
--   ORDER BY created_at DESC LIMIT $2;
-- Before: Index Scan idx_mentor_applications_review_queue (submitted_at) then an
--         in-memory Sort on created_at DESC. New index removes the sort.
CREATE INDEX IF NOT EXISTS idx_mentor_applications_status_created
    ON public.mentor_applications (status, created_at DESC);

-- 6) mentor_profiles: seeker directory ("View All Mentors") -------------------
-- Query (fetchAllMentors / fetchEligibleLanguages, discoveryService.ts):
--   SELECT ... FROM mentor_profiles
--   WHERE is_approved = true AND is_active = true AND approval_status = 'approved'
--   ORDER BY is_featured DESC, rating DESC, id;
-- Before: Index Scan idx_mentor_profiles_approval (approval_status) then a
--         Filter recheck on (is_approved AND is_active) and a Sort. The new
--         composite index answers all three equality filters in one index probe.
CREATE INDEX IF NOT EXISTS idx_mentor_profiles_discovery
    ON public.mentor_profiles (is_approved, is_active, approval_status);

-- 7) gigs: offers listed under one segment (admin + discovery) ----------------
-- Query (GET /api/admin/segments gigs, server.ts):
--   SELECT ... FROM gigs WHERE segment_id = $1 AND is_active = true
--   ORDER BY created_at DESC;
-- Before: Bitmap Index Scan idx_gigs_segment_id (segment_id) then a Filter
--         recheck on is_active and a Sort. The new composite index covers both
--         the segment filter and the active flag.
CREATE INDEX IF NOT EXISTS idx_gigs_segment_active
    ON public.gigs (segment_id, is_active);

-- =============================================================================
-- UNDO (safe via `supabase db push` -- DROP INDEX runs inside a transaction):
-- =============================================================================
-- DROP INDEX IF EXISTS public.idx_mentor_availability_mentor_enabled;
-- DROP INDEX IF EXISTS public.idx_bookings_mentor_start;
-- DROP INDEX IF EXISTS public.idx_bookings_seeker_start_desc;
-- DROP INDEX IF EXISTS public.idx_notifications_user_created_desc;
-- DROP INDEX IF EXISTS public.idx_mentor_applications_status_created;
-- DROP INDEX IF EXISTS public.idx_mentor_profiles_discovery;
-- DROP INDEX IF EXISTS public.idx_gigs_segment_active;

-- =============================================================================
-- EXISTING INDEXES THAT ARE NEVER USED (0 scans in pg_stat_user_indexes).
-- Listed for review -- NOT dropped here, because dropping is a separate,
-- riskier decision (some are unique constraints that protect data integrity).
-- Each one still costs a write on every INSERT/UPDATE/DELETE of its table.
--
-- Safe-to-consider redundant duplicates (same columns as another index):
--   mentor_segments.idx_mentor_segments_segment        == idx_mentor_segments_segment_id
--   bookings.idx_bookings_code                         == bookings_booking_code_key
--   session_workspaces.idx_workspaces_booking_id       == uq_session_workspaces_booking_id
--   session_workspaces.idx_session_workspaces_booking_id == uq_session_workspaces_booking_id
--   mentor_application_audit.idx_mentor_app_audit_application == idx_mentor_audit_application
--   mentor_verification_documents.idx_mentor_documents_application == idx_mentor_verification_docs_app
--
-- Other 0-scan non-unique indexes (review before dropping):
--   system_logs:      idx_system_logs_request_id (7.3MB), idx_system_logs_path (1.7MB),
--                     idx_system_logs_user_id (1.5MB), idx_system_logs_level (1.4MB),
--                     idx_system_logs_category (1.5MB)
--   session_workspaces: idx_session_workspaces_status, idx_session_workspaces_seeker_id,
--                     idx_session_workspaces_mentor_id
--   mentor_profiles:  idx_mentor_profiles_active, idx_mentor_profiles_approved,
--                     idx_mentor_profiles_created_via, idx_mentor_profiles_rating
--   bookings:         idx_bookings_mentor_status_completed, idx_bookings_ended_by_role,
--                     idx_bookings_actual_ended_at
--   mentor_applications: idx_mentor_applications_submitted
--   profiles:         idx_profiles_email, idx_profiles_account_status
--   webhook_events:   idx_webhook_events_created_at
--   support_tickets:  idx_support_tickets_queue, idx_support_tickets_booking,
--                     idx_support_tickets_payment, idx_support_tickets_assigned_admin
--   support_messages: idx_support_messages_ticket_created
--   support_audit_events: idx_support_audit_events_ticket_created
--   support_attachments: idx_support_attachments_ticket, idx_support_attachments_message
--   coupons:          idx_coupons_status_window, idx_coupons_segment, idx_coupons_mentor
--   coupon_usage:     idx_coupon_usage_coupon_status, idx_coupon_usage_reserved
--   payment_events:   idx_payment_events_payment_id, idx_payment_events_status
--   razorpay_unmatched_captures: idx_unmatched_captures_event_id,
--                     idx_unmatched_captures_order_id, idx_unmatched_captures_pending
--   login_failure_trackers: idx_login_failure_trackers_alerted,
--                     idx_login_failure_trackers_last_failed
--   reschedule_requests: idx_reschedule_requests_mentor_status,
--                     idx_reschedule_requests_seeker, idx_reschedule_requests_expiry
--   mentor_application_audit: idx_mentor_app_audit_app, idx_mentor_app_audit_created
--   mentor_verification_documents: idx_mentor_docs_status, idx_mentor_verification_docs_status
--   audit_logs:       idx_audit_logs_action, idx_audit_logs_actor_user_id,
--                     idx_audit_logs_entity_type, idx_audit_logs_request_id
--   notifications:    idx_notifications_entity, idx_notifications_event_type
--   segment_topics:   idx_segment_topics_slug
--   gig_topics:       idx_gig_topics_topic_id (14 scans, near-zero)
-- =============================================================================
