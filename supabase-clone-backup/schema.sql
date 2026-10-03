


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE SCHEMA IF NOT EXISTS "mvp";


ALTER SCHEMA "mvp" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "mvp_private";


ALTER SCHEMA "mvp_private" OWNER TO "postgres";




ALTER SCHEMA "public" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "mvp"."app_role" AS ENUM (
    'seeker',
    'mentor',
    'admin'
);


ALTER TYPE "mvp"."app_role" OWNER TO "postgres";


CREATE TYPE "mvp"."availability_day" AS ENUM (
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday'
);


ALTER TYPE "mvp"."availability_day" OWNER TO "postgres";


CREATE TYPE "mvp"."booking_status" AS ENUM (
    'payment_pending',
    'mentor_pending',
    'confirmed',
    'in_progress',
    'completed',
    'cancelled',
    'rejected'
);


ALTER TYPE "mvp"."booking_status" OWNER TO "postgres";


CREATE TYPE "mvp"."hold_status" AS ENUM (
    'active',
    'expired',
    'released'
);


ALTER TYPE "mvp"."hold_status" OWNER TO "postgres";


CREATE TYPE "mvp"."mentor_approval_status" AS ENUM (
    'pending',
    'approved',
    'rejected'
);


ALTER TYPE "mvp"."mentor_approval_status" OWNER TO "postgres";


CREATE TYPE "mvp"."payment_status" AS ENUM (
    'pending',
    'approved',
    'rejected'
);


ALTER TYPE "mvp"."payment_status" OWNER TO "postgres";


CREATE TYPE "mvp"."segment_status" AS ENUM (
    'active',
    'archived'
);


ALTER TYPE "mvp"."segment_status" OWNER TO "postgres";


CREATE TYPE "public"."app_role" AS ENUM (
    'seeker',
    'mentor',
    'mentor_pending',
    'admin'
);


ALTER TYPE "public"."app_role" OWNER TO "postgres";


CREATE TYPE "public"."notification_type" AS ENUM (
    'booking_created',
    'payment_submitted',
    'payment_approved',
    'payment_rejected',
    'mentor_pending',
    'mentor_confirmed',
    'meeting_link_available',
    'session_starting',
    'mentor_cancelled',
    'booking_rescheduled',
    'session_completed',
    'workspace_updated',
    'new_booking',
    'meeting_deadline_approaching',
    'meeting_overdue',
    'seeker_cancelled',
    'payment_proof_submitted',
    'mentor_link_overdue',
    'booking_intervention_required'
);


ALTER TYPE "public"."notification_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "mvp_private"."backfill_mvp_user_data"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'mvp', 'public'
    AS $$
BEGIN
  INSERT INTO mvp.profiles (id, display_name, timezone)
  SELECT u.id, COALESCE(u.raw_user_meta_data->>'full_name', COALESCE(u.raw_user_meta_data->>'name', u.email)), 'UTC'
  FROM auth.users u
  WHERE NOT EXISTS (SELECT 1 FROM mvp.profiles p WHERE p.id = u.id);

  INSERT INTO mvp.user_roles (user_id, role)
  SELECT u.id, 'seeker'
  FROM auth.users u
  WHERE NOT EXISTS (SELECT 1 FROM mvp.user_roles r WHERE r.user_id = u.id);
END;
$$;


ALTER FUNCTION "mvp_private"."backfill_mvp_user_data"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "mvp_private"."initialize_mvp_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'mvp', 'public'
    AS $$
BEGIN
  INSERT INTO mvp.profiles (id, display_name, timezone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', COALESCE(NEW.raw_user_meta_data->>'name', NEW.email)),
    'UTC'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO mvp.user_roles (user_id, role)
  VALUES (NEW.id, 'seeker')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "mvp_private"."initialize_mvp_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "mvp_private"."is_admin"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'mvp', 'public'
    AS $$
DECLARE
  v_role mvp.app_role;
BEGIN
  SELECT role INTO v_role
  FROM mvp.user_roles
  WHERE user_id = auth.uid()
  LIMIT 1;
  RETURN v_role = 'admin';
END;
$$;


ALTER FUNCTION "mvp_private"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "mvp_private"."is_mentor"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'mvp', 'public'
    AS $$
DECLARE
  v_role mvp.app_role;
BEGIN
  SELECT role INTO v_role
  FROM mvp.user_roles
  WHERE user_id = auth.uid()
  LIMIT 1;
  RETURN v_role = 'mentor';
END;
$$;


ALTER FUNCTION "mvp_private"."is_mentor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "mvp_private"."is_seeker"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'mvp', 'public'
    AS $$
DECLARE
  v_role mvp.app_role;
BEGIN
  SELECT role INTO v_role
  FROM mvp.user_roles
  WHERE user_id = auth.uid()
  LIMIT 1;
  RETURN v_role = 'seeker';
END;
$$;


ALTER FUNCTION "mvp_private"."is_seeker"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "mvp_private"."update_timestamps"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'mvp', 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "mvp_private"."update_timestamps"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "mvp_private"."validate_timezone"("p_timezone" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'mvp', 'public'
    AS $$
BEGIN
  IF p_timezone IS NULL OR btrim(p_timezone) = '' THEN
    RETURN false;
  END IF;
  IF length(p_timezone) > 64 THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;


ALTER FUNCTION "mvp_private"."validate_timezone"("p_timezone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_log_mentor_app_audit"("p_application_id" "uuid", "p_action" "text", "p_admin_user_id" "uuid" DEFAULT NULL::"uuid", "p_rejection_reason" "text" DEFAULT NULL::"text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  INSERT INTO public.mentor_application_audit
    (application_id, action, admin_user_id, rejection_reason, metadata)
  VALUES (p_application_id, p_action, p_admin_user_id, p_rejection_reason,
          COALESCE(p_metadata, '{}'::jsonb));
$$;


ALTER FUNCTION "public"."_log_mentor_app_audit"("p_application_id" "uuid", "p_action" "text", "p_admin_user_id" "uuid", "p_rejection_reason" "text", "p_metadata" "jsonb") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."slot_holds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mentor_id" "uuid" NOT NULL,
    "seeker_id" "uuid" NOT NULL,
    "gig_id" "uuid" NOT NULL,
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'ACTIVE'::"text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_hold_expiry" CHECK (("expires_at" > "created_at")),
    CONSTRAINT "chk_hold_time" CHECK (("start_time" < "end_time")),
    CONSTRAINT "slot_holds_status_check" CHECK (("status" = ANY (ARRAY['ACTIVE'::"text", 'CONVERTED'::"text", 'EXPIRED'::"text", 'RELEASED'::"text"])))
);

ALTER TABLE ONLY "public"."slot_holds" REPLICA IDENTITY FULL;


ALTER TABLE "public"."slot_holds" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."acquire_slot_hold"("p_mentor_id" "uuid", "p_seeker_id" "uuid", "p_gig_id" "uuid", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) RETURNS "public"."slot_holds"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_hold public.slot_holds;
  v_conflicting_booking BOOLEAN;
  v_conflicting_hold BOOLEAN;
BEGIN
  -- 1. Input sanity checks
  IF p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'Invalid interval: start_time must be strictly before end_time';
  END IF;

  IF p_start_time <= NOW() THEN
    RAISE EXCEPTION 'Cannot hold a slot in the past';
  END IF;

  -- 2. Explicit pessimistic lock on the mentor's profile row to serialize concurrent booking attempts
  PERFORM 1 FROM public.profiles WHERE id = p_mentor_id FOR UPDATE;

  -- 3. Expire stale holds for this mentor
  UPDATE public.slot_holds
  SET status = 'EXPIRED'
  WHERE mentor_id = p_mentor_id
    AND status = 'ACTIVE'
    AND expires_at <= NOW();

  -- 4. Check for overlapping non-cancelled bookings
  SELECT EXISTS (
    SELECT 1 FROM public.bookings
    WHERE mentor_id = p_mentor_id
      AND status NOT IN ('CANCELLED', 'REJECTED')
      AND tstzrange(start_time, end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) INTO v_conflicting_booking;

  IF v_conflicting_booking THEN
    RAISE EXCEPTION 'Requested slot is already booked';
  END IF;

  -- 5. Check for overlapping active holds
  SELECT EXISTS (
    SELECT 1 FROM public.slot_holds
    WHERE mentor_id = p_mentor_id
      AND status = 'ACTIVE'
      AND expires_at > NOW()
      AND tstzrange(start_time, end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) INTO v_conflicting_hold;

  IF v_conflicting_hold THEN
    RAISE EXCEPTION 'Requested slot is currently on hold by another seeker';
  END IF;

  -- 6. Insert new slot hold, expiring when the canonical hold window elapses
  INSERT INTO public.slot_holds (
    mentor_id,
    seeker_id,
    gig_id,
    start_time,
    end_time,
    status,
    expires_at,
    created_at
  ) VALUES (
    p_mentor_id,
    p_seeker_id,
    p_gig_id,
    p_start_time,
    p_end_time,
    'ACTIVE',
    NOW() + public.hold_duration_interval(),
    NOW()
  )
  RETURNING * INTO v_hold;

  RETURN v_hold;
END;
$$;


ALTER FUNCTION "public"."acquire_slot_hold"("p_mentor_id" "uuid", "p_seeker_id" "uuid", "p_gig_id" "uuid", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_support_attachment"("p_ticket_code" "text", "p_actor_id" "uuid", "p_storage_path" "text", "p_file_name" "text", "p_mime_type" "text", "p_file_size" integer, "p_message_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_ticket public.support_tickets;
  v_attachment public.support_attachments;
  v_role TEXT;
  v_name TEXT;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_actor_id IS NULL
     OR NOT public.has_role(p_actor_id, 'admin')
        AND NOT public.has_role(p_actor_id, 'mentor')
        AND NOT public.has_role(p_actor_id, 'seeker') THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, You are not authorized to attach a file';
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, You are not authorized to attach a file';
  END IF;

  v_role := CASE
    WHEN public.has_role(p_actor_id, 'admin')  THEN 'admin'
    WHEN public.has_role(p_actor_id, 'mentor') THEN 'mentor'
    ELSE 'seeker'
  END;

  SELECT * INTO v_ticket
  FROM public.support_tickets
  WHERE ticket_code = upper(btrim(p_ticket_code))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: TICKET_NOT_FOUND, Support ticket not found';
  END IF;
  IF v_role <> 'admin' AND v_ticket.requester_id <> p_actor_id THEN
    RAISE EXCEPTION 'code: FORBIDDEN_NOT_TICKET_OWNER, You are not authorized to view this support ticket';
  END IF;
  IF v_ticket.status = 'CLOSED' THEN
    RAISE EXCEPTION 'code: TICKET_CLOSED, This ticket is closed';
  END IF;

  -- The path must be inside THIS ticket's folder. The server generated that
  -- folder, so this is a second line of defence rather than the only one.
  IF p_storage_path !~ ('^support/' || v_ticket.id::TEXT || '/[0-9A-Za-z][0-9A-Za-z._-]*$') THEN
    RAISE EXCEPTION 'code: FORBIDDEN_STORAGE_PATH, That file does not belong to this ticket';
  END IF;

  IF p_mime_type NOT IN ('image/png','image/jpeg','image/webp','application/pdf') THEN
    RAISE EXCEPTION 'code: FILE_TYPE_NOT_ALLOWED, Only PNG, JPG, WebP or PDF files can be attached';
  END IF;

  IF p_file_size IS NULL OR p_file_size <= 0 OR p_file_size > 5242880 THEN
    RAISE EXCEPTION 'code: FILE_TOO_LARGE, Attachments must be 5 MB or smaller';
  END IF;

  v_name := left(regexp_replace(btrim(COALESCE(p_file_name, 'attachment')), '[^0-9A-Za-z._-]', '_', 'g'), 255);
  IF v_name = '' THEN
    v_name := 'attachment';
  END IF;

  -- The message must belong to the same ticket, or the attachment could be
  -- pinned onto somebody else's message.
  IF p_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.support_messages m
    WHERE m.id = p_message_id AND m.ticket_id = v_ticket.id
  ) THEN
    RAISE EXCEPTION 'code: FORBIDDEN_STORAGE_PATH, That message does not belong to this ticket';
  END IF;

  INSERT INTO public.support_attachments (
    ticket_id, message_id, uploaded_by, storage_path, file_name, mime_type, file_size, created_at
  ) VALUES (
    v_ticket.id, p_message_id, p_actor_id, p_storage_path, v_name, p_mime_type, p_file_size, v_now
  )
  RETURNING * INTO v_attachment;

  UPDATE public.support_tickets SET last_message_at = v_now, updated_at = v_now WHERE id = v_ticket.id;

  INSERT INTO public.support_audit_events (ticket_id, actor_id, event_type, metadata, created_at)
  VALUES (v_ticket.id, p_actor_id, 'ATTACHMENT_ADDED',
          jsonb_build_object('attachmentId', v_attachment.id, 'mimeType', p_mime_type, 'fileSize', p_file_size), v_now);

  RETURN jsonb_build_object(
    'success', TRUE,
    'attachment', jsonb_build_object(
      'id', v_attachment.id,
      'ticketId', v_ticket.id,
      'messageId', v_attachment.message_id,
      'uploadedBy', v_attachment.uploaded_by,
      'storagePath', v_attachment.storage_path,
      'fileName', v_attachment.file_name,
      'mimeType', v_attachment.mime_type,
      'fileSize', v_attachment.file_size,
      'createdAt', v_attachment.created_at
    )
  );
END;
$_$;


ALTER FUNCTION "public"."add_support_attachment"("p_ticket_code" "text", "p_actor_id" "uuid", "p_storage_path" "text", "p_file_name" "text", "p_mime_type" "text", "p_file_size" integer, "p_message_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_support_internal_note"("p_ticket_code" "text", "p_admin_id" "uuid", "p_note" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_ticket public.support_tickets;
  v_message public.support_messages;
  v_text TEXT;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_admin_id IS NULL OR NOT public.has_role(p_admin_id, 'admin') THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, Only an admin can add an internal note';
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_admin_id THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, Only an admin can add an internal note';
  END IF;

  v_text := NULLIF(btrim(COALESCE(p_note, '')), '');
  IF v_text IS NULL OR length(v_text) > 4000 THEN
    RAISE EXCEPTION 'code: MESSAGE_INVALID, The note must be between 1 and 4000 characters';
  END IF;

  SELECT * INTO v_ticket
  FROM public.support_tickets
  WHERE ticket_code = upper(btrim(p_ticket_code))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: TICKET_NOT_FOUND, Support ticket not found';
  END IF;
  IF v_ticket.status = 'CLOSED' THEN
    RAISE EXCEPTION 'code: TICKET_CLOSED, This ticket is closed';
  END IF;

  INSERT INTO public.support_messages (
    ticket_id, sender_id, sender_role, message, is_internal, created_at, updated_at
  ) VALUES (
    v_ticket.id, p_admin_id, 'admin', v_text, TRUE, v_now, v_now
  )
  RETURNING * INTO v_message;

  UPDATE public.support_tickets SET last_message_at = v_now, updated_at = v_now WHERE id = v_ticket.id;

  INSERT INTO public.support_audit_events (ticket_id, actor_id, event_type, metadata, created_at)
  VALUES (v_ticket.id, p_admin_id, 'TICKET_INTERNAL_NOTE_ADDED',
          jsonb_build_object('messageId', v_message.id), v_now);

  RETURN jsonb_build_object('success', TRUE, 'messageId', v_message.id);
END;
$$;


ALTER FUNCTION "public"."add_support_internal_note"("p_ticket_code" "text", "p_admin_id" "uuid", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_support_message"("p_ticket_code" "text", "p_actor_id" "uuid", "p_message" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_ticket public.support_tickets;
  v_message public.support_messages;
  v_role TEXT;
  v_text TEXT;
  v_new_status TEXT;
  v_admin_id UUID;
  v_recipients UUID[] := ARRAY[]::UUID[];
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_actor_id IS NULL
     OR NOT public.has_role(p_actor_id, 'admin')
        AND NOT public.has_role(p_actor_id, 'mentor')
        AND NOT public.has_role(p_actor_id, 'seeker') THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, You are not authorized to reply to a support ticket';
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, You are not authorized to reply to a support ticket';
  END IF;

  v_role := CASE
    WHEN public.has_role(p_actor_id, 'admin')  THEN 'admin'
    WHEN public.has_role(p_actor_id, 'mentor') THEN 'mentor'
    ELSE 'seeker'
  END;

  v_text := NULLIF(btrim(COALESCE(p_message, '')), '');
  IF v_text IS NULL OR length(v_text) > 4000 THEN
    RAISE EXCEPTION 'code: MESSAGE_INVALID, The message must be between 1 and 4000 characters';
  END IF;

  -- FOR UPDATE serialises concurrent replies so the ticket is locked once and
  -- the status is re-read under the lock.
  SELECT * INTO v_ticket
  FROM public.support_tickets
  WHERE ticket_code = upper(btrim(p_ticket_code))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: TICKET_NOT_FOUND, Support ticket not found';
  END IF;

  IF v_role <> 'admin' AND v_ticket.requester_id <> p_actor_id THEN
    RAISE EXCEPTION 'code: FORBIDDEN_NOT_TICKET_OWNER, You are not authorized to view this support ticket';
  END IF;

  IF NOT public.is_support_ticket_replyable(v_ticket.status) THEN
    RAISE EXCEPTION 'code: TICKET_NOT_REPLYABLE, This ticket is closed and cannot receive new replies';
  END IF;

  INSERT INTO public.support_messages (
    ticket_id, sender_id, sender_role, message, is_internal, created_at, updated_at
  ) VALUES (
    v_ticket.id, p_actor_id, v_role, v_text, FALSE, v_now, v_now
  )
  RETURNING * INTO v_message;

  -- A user replying to WAITING_FOR_USER resumes the conversation.
  v_new_status := CASE
    WHEN v_role <> 'admin' AND v_ticket.status = 'WAITING_FOR_USER' THEN 'IN_PROGRESS'
    ELSE v_ticket.status
  END;

  UPDATE public.support_tickets
  SET status = v_new_status,
      last_message_at = v_now,
      updated_at = v_now
  WHERE id = v_ticket.id;

  INSERT INTO public.support_audit_events (ticket_id, actor_id, event_type, metadata, created_at)
  VALUES (v_ticket.id, p_actor_id, 'TICKET_MESSAGE_SENT',
          jsonb_build_object('messageId', v_message.id, 'statusAfter', v_new_status), v_now);

  -- Admin replied -> tell the requester. User replied -> tell the assigned
  -- admin, or the whole queue when nobody owns the ticket yet.
  IF v_role = 'admin' THEN
    v_recipients := ARRAY[v_ticket.requester_id];
  ELSE
    IF v_ticket.assigned_admin_id IS NOT NULL THEN
      v_recipients := ARRAY[v_ticket.assigned_admin_id];
    ELSE
      SELECT COALESCE(array_agg(u.user_id), ARRAY[]::UUID[])
        INTO v_recipients
      FROM public.user_roles u WHERE u.role = 'admin';
    END IF;
  END IF;

  FOREACH v_admin_id IN ARRAY v_recipients LOOP
    INSERT INTO public.notifications (
      user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, metadata, created_at
    ) VALUES (
      v_admin_id,
      CASE WHEN v_role = 'admin'
        THEN 'New reply on support ticket ' || v_ticket.ticket_code
        ELSE 'User replied to support ticket ' || v_ticket.ticket_code END,
      CASE WHEN v_role = 'admin'
        THEN 'You have a new reply on support ticket ' || v_ticket.ticket_code || '.'
        ELSE v_role || ' ' || v_ticket.requester_id::TEXT || ' replied to support ticket ' || v_ticket.ticket_code || '.' END,
      'SYSTEM',
      'SUPPORT_TICKET_REPLY',
      'support_ticket',
      v_ticket.ticket_code,
      CASE WHEN v_role = 'admin'
        THEN format('/seeker/support?ticketCode=%s', v_ticket.ticket_code)
        ELSE format('/admin/support?ticketCode=%s', v_ticket.ticket_code) END,
      FALSE,
      jsonb_build_object('ticketCode', v_ticket.ticket_code),
      v_now
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'message', jsonb_build_object(
      'id', v_message.id,
      'senderId', v_message.sender_id,
      'senderRole', v_message.sender_role,
      'message', v_message.message,
      'isInternal', v_message.is_internal,
      'createdAt', v_message.created_at
    ),
    'status', v_new_status
  );
END;
$$;


ALTER FUNCTION "public"."add_support_message"("p_ticket_code" "text", "p_actor_id" "uuid", "p_message" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_approve_payment"("p_payment_id" "uuid", "p_admin_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_payment RECORD;
  v_booking RECORD;
  v_hold RECORD;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;
  IF v_payment IS NULL THEN
    RAISE EXCEPTION 'payment_not_found';
  END IF;

  IF v_payment.status <> 'pending' THEN
    RAISE EXCEPTION 'payment_not_pending';
  END IF;

  SELECT * INTO v_booking FROM sessions WHERE id = v_payment.booking_id;
  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'booking_not_found';
  END IF;

  UPDATE payments
  SET status = 'approved', reviewed_by = p_admin_id, reviewed_at = now()
  WHERE id = p_payment_id;

  -- payment_pending -> mentor_pending, set meeting link deadline (2h before start)
  UPDATE sessions
  SET status = 'mentor_pending',
      payment_status = 'approved',
      meeting_link_deadline = scheduled_time - interval '2 hours'
  WHERE id = v_booking.id;

  -- Release the temporary hold (booking continues to block time)
  UPDATE booking_holds
  SET status = 'released', released_at = now()
  WHERE booking_id = v_booking.id AND status = 'active';

  -- Notify mentor
  INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
  VALUES (v_booking.mentor_id, 'new_booking', 'New booking pending confirmation',
          'A student has booked your session. Please add a meeting link and confirm.',
          'booking', v_booking.id);

  -- Notify seeker
  INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
  VALUES (v_booking.student_id, 'payment_approved', 'Payment approved',
          'Your payment has been verified. Your mentor will confirm the session shortly.',
          'payment', p_payment_id);

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'booking_id', v_booking.id,
    'status', 'mentor_pending'
  );
END;
$$;


ALTER FUNCTION "public"."admin_approve_payment"("p_payment_id" "uuid", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_delete_profile_by_email"("p_email" "text", "p_except_id" "uuid" DEFAULT NULL::"uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_deleted_count integer := 0;
begin
  -- Delete from user_roles first (foreign key)
  if p_except_id is not null then
    delete from public.user_roles
    where user_id in (
      select id from public.profiles
      where email = p_email and id != p_except_id
    );
    get diagnostics v_deleted_count = row_count;

    -- Delete from dependent tables
    delete from public.seeker_profiles
    where user_id in (
      select id from public.profiles
      where email = p_email and id != p_except_id
    );

    delete from public.mentor_profiles
    where user_id in (
      select id from public.profiles
      where email = p_email and id != p_except_id
    );

    -- Finally delete the orphaned profiles
    delete from public.profiles
    where email = p_email and id != p_except_id;
    get diagnostics v_deleted_count = row_count;
  else
    -- No exception - delete all profiles with this email
    delete from public.user_roles
    where user_id in (select id from public.profiles where email = p_email);

    delete from public.seeker_profiles
    where user_id in (select id from public.profiles where email = p_email);

    delete from public.mentor_profiles
    where user_id in (select id from public.profiles where email = p_email);

    delete from public.profiles
    where email = p_email;
    get diagnostics v_deleted_count = row_count;
  end if;

  return v_deleted_count;
end;
$$;


ALTER FUNCTION "public"."admin_delete_profile_by_email"("p_email" "text", "p_except_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_delete_test_mentor"("p_mentor_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  IF to_regclass('public.bookings') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.bookings WHERE mentor_id = p_mentor_id) THEN
    RAISE EXCEPTION 'Mentor has booking history. Deactivate/archive instead of deleting.';
  END IF;

  IF to_regclass('public.payments') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.payments WHERE mentor_id = p_mentor_id) THEN
    RAISE EXCEPTION 'Mentor has payment history. Deactivate/archive instead of deleting.';
  END IF;

  IF to_regclass('public.session_workspaces') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.session_workspaces WHERE mentor_id = p_mentor_id) THEN
    RAISE EXCEPTION 'Mentor has session workspace history. Deactivate/archive instead.';
  END IF;

  -- Operational data only, removed explicitly table by table. No uncontrolled
  -- CASCADE is relied upon.
  IF to_regclass('public.availability_exceptions') IS NOT NULL THEN
    DELETE FROM public.availability_exceptions WHERE mentor_id = p_mentor_id;
  END IF;
  IF to_regclass('public.availability') IS NOT NULL THEN
    DELETE FROM public.availability WHERE mentor_id = p_mentor_id;
  END IF;
  IF to_regclass('public.gigs') IS NOT NULL THEN
    DELETE FROM public.gigs WHERE mentor_id = p_mentor_id;
  END IF;
  IF to_regclass('public.notifications') IS NOT NULL THEN
    DELETE FROM public.notifications WHERE user_id = p_mentor_id;
  END IF;

  -- Applications (and their documents) follow the user via FK cascade.
  DELETE FROM public.mentor_applications WHERE user_id = p_mentor_id;

  IF to_regclass('public.mentor_profiles') IS NOT NULL THEN
    DELETE FROM public.mentor_profiles WHERE id = p_mentor_id;
  END IF;

  IF to_regclass('public.user_roles') IS NOT NULL THEN
    DELETE FROM public.user_roles WHERE user_id = p_mentor_id;
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL THEN
    DELETE FROM public.profiles WHERE id = p_mentor_id;
  END IF;

  IF to_regclass('auth.users') IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = p_mentor_id;
  END IF;

  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."admin_delete_test_mentor"("p_mentor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_mentor_applications"("p_status" "text" DEFAULT NULL::"text") RETURNS TABLE("id" "uuid", "user_id" "uuid", "status" "text", "full_name" "text", "headline" "text", "bio" "text", "years_of_experience" integer, "timezone" "text", "requested_segment_ids" "uuid"[], "submitted_at" timestamp with time zone, "reviewed_at" timestamp with time zone, "reviewed_by" "uuid", "rejection_reason" "text", "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "document_count" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  RETURN QUERY
  SELECT a.id, a.user_id, a.status, a.full_name, a.headline, a.bio,
         a.years_of_experience, a.timezone, a.requested_segment_ids,
         a.submitted_at, a.reviewed_at, a.reviewed_by, a.rejection_reason,
         a.created_at, a.updated_at,
         (SELECT COUNT(*) FROM public.mentor_verification_documents d
           WHERE d.application_id = a.id)
  FROM public.mentor_applications a
  WHERE p_status IS NULL OR a.status = p_status
  ORDER BY
    CASE WHEN a.status = 'pending_review' THEN 0 ELSE 1 END,
    a.submitted_at ASC NULLS LAST,
    a.created_at ASC;
END;
$$;


ALTER FUNCTION "public"."admin_list_mentor_applications"("p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_reject_payment"("p_payment_id" "uuid", "p_admin_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_payment RECORD;
  v_booking RECORD;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;
  IF v_payment IS NULL THEN
    RAISE EXCEPTION 'payment_not_found';
  END IF;

  IF v_payment.status <> 'pending' THEN
    RAISE EXCEPTION 'payment_not_pending';
  END IF;

  SELECT * INTO v_booking FROM sessions WHERE id = v_payment.booking_id;
  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'booking_not_found';
  END IF;

  UPDATE payments
  SET status = 'rejected', reviewed_by = p_admin_id, reviewed_at = now(), admin_notes = p_reason
  WHERE id = p_payment_id;

  UPDATE sessions
  SET status = 'rejected', payment_status = 'rejected'
  WHERE id = v_booking.id;

  -- Release the hold so the slot becomes available again
  UPDATE booking_holds
  SET status = 'released', released_at = now()
  WHERE booking_id = v_booking.id AND status = 'active';

  -- Notify seeker
  INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
  VALUES (v_booking.student_id, 'payment_rejected', 'Payment rejected',
          'Your payment could not be verified. Please review and try again.',
          'payment', p_payment_id);

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'booking_id', v_booking.id,
    'status', 'rejected'
  );
END;
$$;


ALTER FUNCTION "public"."admin_reject_payment"("p_payment_id" "uuid", "p_admin_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_report_mentor_dependencies"("p_mentor_id" "uuid") RETURNS TABLE("user_id" "uuid", "email" "text", "mentor_profile" boolean, "application_status" "text", "gig_count" bigint, "active_gig_count" bigint, "availability_count" bigint, "availability_exception_count" bigint, "notification_count" bigint, "booking_count" bigint, "payment_count" bigint, "session_workspace_count" bigint, "historical_dependency_count" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_email TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  IF to_regclass('auth.users') IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = p_mentor_id;
  END IF;

  RETURN QUERY
  SELECT
    p_mentor_id,
    v_email,
    (to_regclass('public.mentor_profiles') IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.mentor_profiles WHERE id = p_mentor_id)),
    (SELECT status FROM public.mentor_applications WHERE user_id = p_mentor_id),
    (SELECT COUNT(*) FROM public.gigs WHERE mentor_id = p_mentor_id),
    (SELECT COUNT(*) FROM public.gigs WHERE mentor_id = p_mentor_id AND is_active = TRUE),
    (CASE WHEN to_regclass('public.availability') IS NULL THEN 0
          ELSE (SELECT COUNT(*) FROM public.availability WHERE mentor_id = p_mentor_id) END),
    (CASE WHEN to_regclass('public.availability_exceptions') IS NULL THEN 0
          ELSE (SELECT COUNT(*) FROM public.availability_exceptions WHERE mentor_id = p_mentor_id) END),
    (CASE WHEN to_regclass('public.notifications') IS NULL THEN 0
          ELSE (SELECT COUNT(*) FROM public.notifications WHERE user_id = p_mentor_id) END),
    (CASE WHEN to_regclass('public.bookings') IS NULL THEN 0
          ELSE (SELECT COUNT(*) FROM public.bookings WHERE mentor_id = p_mentor_id) END),
    (CASE WHEN to_regclass('public.payments') IS NULL THEN 0
          ELSE (SELECT COUNT(*) FROM public.payments WHERE mentor_id = p_mentor_id) END),
    (CASE WHEN to_regclass('public.session_workspaces') IS NULL THEN 0
          ELSE (SELECT COUNT(*) FROM public.session_workspaces WHERE mentor_id = p_mentor_id) END),
    (CASE WHEN to_regclass('public.bookings') IS NULL THEN 0
          ELSE (SELECT COUNT(*) FROM public.bookings WHERE mentor_id = p_mentor_id) END)
    + (CASE WHEN to_regclass('public.payments') IS NULL THEN 0
            ELSE (SELECT COUNT(*) FROM public.payments WHERE mentor_id = p_mentor_id) END)
    + (CASE WHEN to_regclass('public.session_workspaces') IS NULL THEN 0
            ELSE (SELECT COUNT(*) FROM public.session_workspaces WHERE mentor_id = p_mentor_id) END);
END;
$$;


ALTER FUNCTION "public"."admin_report_mentor_dependencies"("p_mentor_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text" NOT NULL,
    "avatar_url" "text",
    "timezone" "text" DEFAULT 'Asia/Kolkata'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "account_status" "text" DEFAULT 'active'::"text",
    "suspended_at" timestamp with time zone,
    "suspended_until" timestamp with time zone,
    "suspended_by" "uuid",
    "suspension_reason" "text",
    "internal_note" "text",
    "deactivated_at" timestamp with time zone,
    "phone" "text",
    CONSTRAINT "chk_profiles_account_status" CHECK (("account_status" = ANY (ARRAY['active'::"text", 'suspended'::"text", 'deactivated'::"text"]))),
    CONSTRAINT "profiles_account_status_check" CHECK (("account_status" = ANY (ARRAY['active'::"text", 'suspended'::"text", 'deactivated'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."profiles" IS 'UPDATE is limited to avatar_url, full_name, phone and timezone. Account lifecycle and moderation fields (account_status, suspended_*, deactivated_at, internal_note) are service-role only: granting them let a user clear their own suspension or write to the admin note. RLS keys ownership on id = auth.uid(), admin writes on is_admin().';



COMMENT ON COLUMN "public"."profiles"."phone" IS 'Admin-supplied contact number. Nullable. Not used for authentication.';



CREATE OR REPLACE FUNCTION "public"."admin_set_account_status"("p_user_id" "uuid", "p_action" "text", "p_reason" "text" DEFAULT NULL::"text", "p_suspended_until" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_internal_note" "text" DEFAULT NULL::"text") RETURNS "public"."profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_profile public.profiles;
  v_audit_action TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user is required';
  END IF;

  IF p_action NOT IN ('suspend','reactivate','deactivate') THEN
    RAISE EXCEPTION 'Invalid action %', p_action;
  END IF;

  IF p_action = 'suspend' AND COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A suspension reason is required';
  END IF;

  IF p_suspended_until IS NOT NULL AND p_suspended_until <= NOW() THEN
    RAISE EXCEPTION 'suspended_until must be in the future';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Administrators cannot change their own account status';
  END IF;

  -- Do not let the last admin lock the platform out.
  IF p_action <> 'reactivate' AND to_regclass('public.user_roles') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.user_roles
               WHERE user_id = p_user_id AND role = 'admin')
       AND NOT EXISTS (SELECT 1 FROM public.user_roles
                       WHERE user_id <> p_user_id AND role = 'admin') THEN
      RAISE EXCEPTION 'Cannot modify the last remaining administrator';
    END IF;
  END IF;

  v_audit_action := CASE p_action
                      WHEN 'suspend'    THEN 'USER_SUSPENDED'
                      WHEN 'reactivate' THEN 'USER_REACTIVATED'
                      ELSE 'USER_DEACTIVATED'
                    END;

  UPDATE public.profiles
  SET account_status = CASE p_action
                         WHEN 'suspend'    THEN 'suspended'
                         WHEN 'reactivate' THEN 'active'
                         ELSE 'deactivated'
                       END,
      suspended_at     = CASE WHEN p_action = 'suspend'    THEN NOW() ELSE NULL END,
      suspended_until  = CASE WHEN p_action = 'suspend'    THEN p_suspended_until ELSE NULL END,
      suspension_reason= CASE WHEN p_action = 'suspend'    THEN p_reason ELSE NULL END,
      suspended_by     = CASE WHEN p_action = 'suspend'    THEN auth.uid() ELSE NULL END,
      deactivated_at   = CASE WHEN p_action = 'deactivate' THEN NOW() ELSE NULL END,
      internal_note    = COALESCE(p_internal_note, internal_note),
      updated_at       = NOW()
  WHERE id = p_user_id
  RETURNING * INTO v_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- A suspended/deactivated mentor must stop being discoverable and bookable
  -- (section 24) without losing a single gig or booking row.
  IF to_regclass('public.mentor_profiles') IS NOT NULL THEN
    IF p_action IN ('suspend','deactivate') THEN
      UPDATE public.mentor_profiles
      SET is_active = FALSE, updated_at = NOW()
      WHERE id = p_user_id AND is_active = TRUE;
    ELSIF p_action = 'reactivate' THEN
      UPDATE public.mentor_profiles
      SET is_active = TRUE, updated_at = NOW()
      WHERE id = p_user_id AND approval_status = 'approved' AND is_active = FALSE;
    END IF;
  END IF;

  -- Reuse the existing platform audit infrastructure when it exists (section 26
  -- forbids a second, duplicate audit system). When no such table exists the
  -- action is simply not audit-logged rather than inventing one.
  IF to_regclass('public.admin_audit_log') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        INSERT INTO public.admin_audit_log
          (actor_admin_id, action, target_user_id, target_entity_id, metadata)
        VALUES ($1, $2, $3, $3, $4)
      $q$
      USING auth.uid(), v_audit_action, p_user_id,
            jsonb_build_object('reason', p_reason,
                               'suspended_until', p_suspended_until,
                               'internal_note', p_internal_note);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN v_profile;
END;
$_$;


ALTER FUNCTION "public"."admin_set_account_status"("p_user_id" "uuid", "p_action" "text", "p_reason" "text", "p_suspended_until" timestamp with time zone, "p_internal_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_upsert_profile"("p_id" "uuid", "p_email" "text", "p_full_name" "text", "p_role" "public"."app_role", "p_is_demo" boolean) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_profile_id uuid;
begin
  -- Upsert profile
  insert into public.profiles (id, email, full_name, onboarded)
  values (p_id, p_email, p_full_name, p_role = 'admin')
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    onboarded = excluded.onboarded,
    updated_at = now()
  returning id into v_profile_id;

  -- Upsert user_roles
  insert into public.user_roles (user_id, role)
  values (p_id, p_role)
  on conflict (user_id, role) do nothing;

  -- If admin, ensure no seeker profile
  if p_role = 'admin' then
    delete from public.seeker_profiles where user_id = p_id;
  else
    -- Ensure seeker profile exists for non-admin
    insert into public.seeker_profiles (user_id)
    values (p_id)
    on conflict (user_id) do nothing;
  end if;

  -- If mentor or mentor_pending, ensure mentor profile exists
  if p_role in ('mentor', 'mentor_pending') then
    insert into public.mentor_profiles (user_id, is_active, is_verified)
    values (p_id, false, false)
    on conflict (user_id) do nothing;
  end if;

  return v_profile_id;
end;
$$;


ALTER FUNCTION "public"."admin_upsert_profile"("p_id" "uuid", "p_email" "text", "p_full_name" "text", "p_role" "public"."app_role", "p_is_demo" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_coupon_to_booking"("p_booking_id" "uuid", "p_coupon_code" "text", "p_seeker_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_booking public.bookings;
  v_coupon public.coupons;
  v_usage public.coupon_usage;
  v_hold_expires_at timestamptz;
  v_base integer;
  v_discount integer;
  v_total integer;
  v_active_uses integer;
  v_user_uses integer;
  v_code text := upper(btrim(COALESCE(p_coupon_code, '')));
BEGIN
  IF p_seeker_id IS NULL THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, Sign in to use a coupon';
  END IF;

  IF v_code !~ '^[A-Z0-9_]{4,24}$' THEN
    RAISE EXCEPTION 'code: COUPON_CODE_INVALID, Enter a valid coupon code';
  END IF;

  -- 1. Lock the booking. Serialises two concurrent applies against one booking,
  --    so the snapshot cannot be written twice from two different codes.
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: BOOKING_NOT_FOUND, Booking not found';
  END IF;

  -- 2. Ownership. Checked against the row, never against a body field.
  IF v_booking.seeker_id <> p_seeker_id THEN
    RAISE EXCEPTION 'code: FORBIDDEN_NOT_BOOKING_OWNER, This booking belongs to someone else';
  END IF;

  -- 3. Only a still-payable booking may be repriced. Once a payment is in
  --    flight or the booking has moved on, changing the amount would invalidate
  --    an amount already promised to a gateway or an admin.
  IF v_booking.status <> 'PAYMENT_PENDING' THEN
    RAISE EXCEPTION 'code: COUPON_BOOKING_NOT_PAYABLE, A coupon can only be applied while the booking is awaiting payment';
  END IF;

  -- 3b. A live payment is the real freeze, and `bookings.status` cannot express
  --     it. `razorpayService` deliberately leaves the booking at PAYMENT_PENDING
  --     while an order is live (see its comment on the booking not moving to
  --     PAYMENT_PROCESSING), so the status check above passes even after Razorpay
  --     has been told an amount. Repricing then would leave a gateway order for
  --     one amount sitting against a booking for another.
  --     Only a payment that has definitively not happened (FAILED, REJECTED) may
  --     be repriced; PENDING_VERIFICATION is a proof an admin is about to read
  --     against a specific amount, so it freezes too.
  IF EXISTS (
    SELECT 1 FROM public.payments
    WHERE booking_id = v_booking.id
      AND status NOT IN ('FAILED', 'REJECTED')
  ) THEN
    RAISE EXCEPTION 'code: COUPON_PAYMENT_IN_FLIGHT, A payment for this booking is already in progress';
  END IF;

  -- 4. The hold must still be live. An expired hold means the booking is about
  --    to be cancelled, and reserving a coupon against it would burn a
  --    redemption for a session nobody can pay for.
  SELECT h.expires_at INTO v_hold_expires_at
  FROM public.slot_holds h
  WHERE h.id = v_booking.hold_id AND h.status = 'ACTIVE';

  IF v_booking.hold_id IS NOT NULL AND (v_hold_expires_at IS NULL OR v_hold_expires_at <= clock_timestamp()) THEN
    RAISE EXCEPTION 'code: COUPON_HOLD_EXPIRED, The payment window for this booking has closed';
  END IF;

  -- 5. Lock the coupon. THIS is the concurrency gate for usage limits: every
  --    reservation of this coupon now queues behind this row, so the counts
  --    below are read from a state no other apply can be mid-way through.
  SELECT * INTO v_coupon FROM public.coupons WHERE code = v_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: COUPON_NOT_FOUND, That coupon code was not recognised';
  END IF;

  IF v_coupon.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'code: COUPON_INACTIVE, That coupon is no longer active';
  END IF;

  IF v_coupon.starts_at > clock_timestamp() THEN
    RAISE EXCEPTION 'code: COUPON_NOT_STARTED, That coupon is not active yet';
  END IF;

  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'code: COUPON_EXPIRED, That coupon has expired';
  END IF;

  -- 6. Targeting. OR, not AND: a segment coupon covers every mentor in the
  --    segment, a mentor coupon covers every gig of that mentor. `chk_coupon_
  --    not_fully_scoped` guarantees a row can never claim to be both.
  IF v_coupon.segment_id IS NOT NULL AND v_coupon.segment_id <> v_booking.segment_id THEN
    RAISE EXCEPTION 'code: COUPON_NOT_TARGETED, That coupon does not apply to this session';
  END IF;

  IF v_coupon.mentor_id IS NOT NULL AND v_coupon.mentor_id <> v_booking.mentor_id THEN
    RAISE EXCEPTION 'code: COUPON_NOT_TARGETED, That coupon does not apply to this mentor';
  END IF;

  -- 7. The base is the booking's own snapshotted gig price. NEVER the current
  --    `gigs.price_inr`: a price edit between hold and checkout must not move
  --    what this booking is discounted from.
  v_base := v_booking.base_amount_inr;

  IF v_base < v_coupon.min_order_amount_inr THEN
    RAISE EXCEPTION 'code: COUPON_MINIMUM_NOT_MET, This coupon needs a session of at least Rs %', v_coupon.min_order_amount_inr;
  END IF;

  -- 8. Usage limits. RESERVED counts as well as REDEEMED: a seeker who holds a
  --    slot has a real claim on the discount, and excluding RESERVED would let
  --    `max_total_uses = 1` be taken by every simultaneous checkout.
  --    This booking's OWN row is excluded. Otherwise re-entering a code already
  --    reserved on this booking would count itself and report a limit reached
  --    for a coupon the seeker already holds, so applying twice would fail
  --    instead of being idempotent. Excluding it is also what keeps the upsert
  --    below honest: the slot it already holds is not double-counted.
  SELECT count(*) INTO v_active_uses
  FROM public.coupon_usage
  WHERE coupon_id = v_coupon.id
    AND status IN ('RESERVED', 'REDEEMED')
    AND booking_id <> v_booking.id;

  IF v_coupon.max_total_uses IS NOT NULL AND v_active_uses >= v_coupon.max_total_uses THEN
    RAISE EXCEPTION 'code: COUPON_LIMIT_REACHED, That coupon has been fully claimed';
  END IF;

  IF v_coupon.max_uses_per_user IS NOT NULL THEN
    SELECT count(*) INTO v_user_uses
    FROM public.coupon_usage
    WHERE coupon_id = v_coupon.id
      AND seeker_id = p_seeker_id
      AND status IN ('RESERVED', 'REDEEMED')
      AND booking_id <> v_booking.id;

    IF v_user_uses >= v_coupon.max_uses_per_user THEN
      RAISE EXCEPTION 'code: COUPON_LIMIT_REACHED, You have already used that coupon';
    END IF;
  END IF;

  -- 9. Compute the discount, floored so the payable amount can never reach 0.
  IF v_coupon.discount_type = 'PERCENTAGE' THEN
    v_discount := (v_base * v_coupon.discount_value) / 100;
    IF v_coupon.max_discount_inr IS NOT NULL AND v_discount > v_coupon.max_discount_inr THEN
      v_discount := v_coupon.max_discount_inr;
    END IF;
  ELSE
    v_discount := v_coupon.discount_value;
  END IF;

  IF v_discount > v_base - 1 THEN
    v_discount := v_base - 1;
  END IF;

  IF v_discount < 1 THEN
    RAISE EXCEPTION 'code: COUPON_NO_EFFECT, That coupon does not reduce this session price';
  END IF;

  v_total := v_base - v_discount;

  -- 10. Reserve. `UNIQUE (booking_id)` means this booking has at most one
  --     coupon_usage row for its whole life, so this is an UPSERT and not a
  --     release-then-insert: releasing the old row first would leave a RELEASED
  --     row behind and the INSERT would violate that unique constraint. The row
  --     is the booking's CURRENT claim, so switching code overwrites it, which
  --     also frees the previous coupon's slot automatically - nothing still
  --     references the old coupon, so its count drops on its own.
  --     Safe against clobbering REDEEMED: a redeemed usage implies the booking
  --     reached MENTOR_PENDING, which step 3 refuses.
  INSERT INTO public.coupon_usage (coupon_id, booking_id, seeker_id, discount_amount_inr)
  VALUES (v_coupon.id, v_booking.id, p_seeker_id, v_discount)
  ON CONFLICT (booking_id) DO UPDATE
  SET coupon_id = EXCLUDED.coupon_id,
      seeker_id = EXCLUDED.seeker_id,
      discount_amount_inr = EXCLUDED.discount_amount_inr,
      status = 'RESERVED',
      reserved_at = clock_timestamp(),
      redeemed_at = NULL,
      released_at = NULL,
      release_reason = NULL
  RETURNING * INTO v_usage;

  -- 11. Write the snapshot. `amount_inr` becomes the new payable amount, which
  --     is what Razorpay order creation already reads.
  UPDATE public.bookings
  SET amount_inr = v_total,
      discount_amount_inr = v_discount,
      coupon_id = v_coupon.id,
      coupon_code = v_coupon.code,
      updated_at = clock_timestamp()
  WHERE id = v_booking.id;

  RETURN jsonb_build_object(
    'success', true,
    'coupon_code', v_coupon.code,
    'discount_type', v_coupon.discount_type,
    'discount_value', v_coupon.discount_value,
    'discount_amount_inr', v_discount,
    'base_amount_inr', v_base,
    'amount_inr', v_total,
    'original_amount_inr', v_booking.original_amount_inr
  );
END;
$_$;


ALTER FUNCTION "public"."apply_coupon_to_booking"("p_booking_id" "uuid", "p_coupon_code" "text", "p_seeker_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mentor_applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "full_name" "text" NOT NULL,
    "bio" "text" DEFAULT ''::"text" NOT NULL,
    "timezone" "text" DEFAULT 'Asia/Kolkata'::"text" NOT NULL,
    "submitted_at" timestamp with time zone,
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "rejection_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "years_of_experience" integer,
    "headline" "text",
    "requested_segment_ids" "uuid"[],
    CONSTRAINT "chk_mentor_app_years" CHECK ((("years_of_experience" IS NULL) OR (("years_of_experience" >= 0) AND ("years_of_experience" <= 80)))),
    CONSTRAINT "mentor_applications_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'pending_review'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."mentor_applications" OWNER TO "postgres";


COMMENT ON TABLE "public"."mentor_applications" IS 'Applicant content (full_name, bio, timezone, headline, years_of_experience, requested_segment_ids) is the only client-writable surface. The review decision (status, submitted_at, reviewed_at, reviewed_by, rejection_reason) and applicant identity (user_id) are service-role only. RLS remains the ownership layer: user_id = auth.uid(), and UPDATE is further restricted to draft/rejected rows.';



CREATE OR REPLACE FUNCTION "public"."approve_mentor_application"("p_application_id" "uuid") RETURNS "public"."mentor_applications"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_app public.mentor_applications;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  SELECT * INTO v_app
  FROM public.mentor_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found';
  END IF;

  IF v_app.status = 'approved' THEN
    RETURN v_app;  -- idempotent
  END IF;

  UPDATE public.mentor_applications
  SET status           = 'approved',
      reviewed_at      = NOW(),
      reviewed_by      = auth.uid(),
      rejection_reason = NULL,
      updated_at       = NOW()
  WHERE id = v_app.id
  RETURNING * INTO v_app;

  -- Grant the mentor role. Drops seeker only when user_roles is the sole role
  -- source; both are inserted so either storage model is satisfied.
  IF to_regclass('public.user_roles') IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_app.user_id, 'mentor')
    ON CONFLICT (user_id, role) DO NOTHING;

    DELETE FROM public.user_roles
    WHERE user_id = v_app.user_id AND role = 'seeker';
  END IF;

  -- Approving must not leave a suspended applicant active.
  IF to_regclass('public.profiles') IS NOT NULL THEN
    UPDATE public.profiles
    SET account_status = 'active', updated_at = NOW()
    WHERE id = v_app.user_id AND account_status <> 'active';
  END IF;

  -- Promote the application into a real mentor profile.
  IF to_regclass('public.mentor_profiles') IS NOT NULL THEN
    INSERT INTO public.mentor_profiles
      (id, headline, about, experience_years, languages,
       rating, review_count, session_count,
       is_approved, is_featured, approval_status, is_active,
       created_at, updated_at)
    VALUES
      (v_app.user_id,
       COALESCE(v_app.headline, v_app.full_name),
       COALESCE(v_app.bio, ''),
       COALESCE(v_app.years_of_experience, 0),
       ARRAY['English','Hindi'],
       5.00, 0, 0,
       TRUE, FALSE, 'approved', TRUE,
       NOW(), NOW())
    ON CONFLICT (id) DO UPDATE
    SET headline           = COALESCE(EXCLUDED.headline, public.mentor_profiles.headline),
        about              = COALESCE(NULLIF(EXCLUDED.about,''), public.mentor_profiles.about),
        experience_years   = COALESCE(EXCLUDED.experience_years, public.mentor_profiles.experience_years),
        is_approved        = TRUE,
        approval_status    = 'approved',
        is_active          = TRUE,
        updated_at         = NOW();
  END IF;

  -- The documents that backed the approval are approved alongside it.
  UPDATE public.mentor_verification_documents
  SET status = 'approved', reviewed_at = NOW(), reviewed_by = auth.uid(), updated_at = NOW()
  WHERE application_id = v_app.id;

  PERFORM public._log_mentor_app_audit(
    v_app.id, 'approved', auth.uid(), NULL,
    jsonb_build_object('years_of_experience', v_app.years_of_experience));

  -- Notify the applicant, when the notifications table exists.
  IF to_regclass('public.notifications') IS NOT NULL THEN
    BEGIN
      INSERT INTO public.notifications
        (user_id, title, message, type, event_type, entity_type, entity_id, link)
      VALUES
        (v_app.user_id,
         'Mentor application approved',
         'Your mentor application has been approved. You can now set up your gigs and availability.',
         'success', 'mentor_application_approved', 'mentor_application', v_app.id,
         '/mentor/profile');
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- notification failure must not undo the approval
    END;
  END IF;

  RETURN v_app;
END;
$$;


ALTER FUNCTION "public"."approve_mentor_application"("p_application_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_mentor_application"("_application_id" "uuid", "_admin_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_application RECORD;
  v_result jsonb;
  v_exists boolean;
  v_now timestamptz := now();
BEGIN
  -- 1. Verify admin
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_authorized: only admins can approve mentor applications';
  END IF;

  -- 2. Fetch the application
  SELECT * INTO v_application FROM public.mentor_applications WHERE id = _application_id;
  IF v_application IS NULL THEN
    RAISE EXCEPTION 'application_not_found';
  END IF;

  IF v_application.user_id IS NULL THEN
    RAISE EXCEPTION 'application_has_no_user_id';
  END IF;

  -- 3. Check if already approved
  IF v_application.status = 'approved' THEN
    RETURN jsonb_build_object(
      'success', true,
      'alreadyApproved', true,
      'message', 'Mentor is already approved.',
      'applicationId', v_application.id,
      'mentorId', v_application.user_id
    );
  END IF;

  -- 4. Update application status + audit fields
  UPDATE public.mentor_applications
    SET status = 'approved',
        reviewed_at = v_now,
        reviewed_by = _admin_id,
        updated_at = v_now
  WHERE id = v_application.id;

  -- 5. Record status history
  INSERT INTO public.mentor_application_status_history (
    application_id, old_status, new_status, changed_by, notes, created_at
  ) VALUES (
    v_application.id, v_application.status, 'approved', _admin_id,
    'Application approved by admin', v_now
  );

  -- 6. Add mentor role (idempotent)
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = v_application.user_id AND role = 'mentor'
  ) INTO v_exists;

  IF NOT v_exists THEN
    INSERT INTO public.user_roles (user_id, role, created_at)
    VALUES (v_application.user_id, 'mentor', v_now);
  END IF;

  -- 7. Activate / verify mentor profile (upsert)
  UPDATE public.mentor_profiles
    SET is_active = true,
        is_verified = true,
        updated_at = v_now
  WHERE user_id = v_application.user_id;

  -- If the mentor profile doesn't exist yet, create a minimal one
  IF NOT FOUND THEN
    INSERT INTO public.mentor_profiles (user_id, is_active, is_verified, created_at, updated_at)
    VALUES (v_application.user_id, true, true, v_now, v_now);
  END IF;

  -- 8. Notify the applicant
  PERFORM public.insert_notification(
    v_application.user_id,
    'Application Approved',
    'Congratulations! Your mentor application has been approved.',
    'general',
    'mentor_application',
    v_application.id,
    '/mentor/pending'
  );

  -- 9. Audit log
  INSERT INTO public.audit_logs (actor_id, scope, action, details, created_at)
  VALUES (
    _admin_id,
    'mentor_applications',
    'status:approved',
    jsonb_build_object('application_id', v_application.id, 'mentor_id', v_application.user_id),
    v_now
  );

  -- 10. Return success
  RETURN jsonb_build_object(
    'success', true,
    'alreadyApproved', false,
    'message', 'Application approved successfully',
    'applicationId', v_application.id,
    'mentorId', v_application.user_id
  );
END;
$$;


ALTER FUNCTION "public"."approve_mentor_application"("_application_id" "uuid", "_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assert_booking_offer_identity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_gig public.gigs;
BEGIN
  IF NEW.gig_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_gig FROM public.gigs WHERE id = NEW.gig_id;

  -- A booking pointing at a gig that no longer exists is a different defect
  -- (the offer was deleted) and is already blocked by the foreign key. Leaving
  -- it to that constraint keeps this trigger from masking it.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_gig.mentor_id IS DISTINCT FROM NEW.mentor_id THEN
    RAISE EXCEPTION
      'code: GIG_MISMATCH, Booking % names gig % which belongs to a different mentor',
      COALESCE(NEW.booking_code, NEW.id::text), NEW.gig_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF v_gig.segment_id IS DISTINCT FROM NEW.segment_id THEN
    RAISE EXCEPTION
      'code: GIG_MISMATCH, Booking % names segment % but its gig belongs to segment %',
      COALESCE(NEW.booking_code, NEW.id::text), NEW.segment_id, v_gig.segment_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."assert_booking_offer_identity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assert_workspace_participant_identity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_booking public.bookings;
BEGIN
  SELECT mentor_id, seeker_id
    INTO v_booking
  FROM public.bookings
  WHERE id = NEW.booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'code: WORKSPACE_BOOKING_NOT_FOUND, Session workspace references booking % which does not exist',
      NEW.booking_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.mentor_id IS DISTINCT FROM v_booking.mentor_id THEN
    RAISE EXCEPTION
      'code: WORKSPACE_PARTICIPANT_MISMATCH, Session workspace mentor % does not match booking mentor %',
      NEW.mentor_id, v_booking.mentor_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.seeker_id IS DISTINCT FROM v_booking.seeker_id THEN
    RAISE EXCEPTION
      'code: WORKSPACE_PARTICIPANT_MISMATCH, Session workspace seeker % does not match booking seeker %',
      NEW.seeker_id, v_booking.seeker_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."assert_workspace_participant_identity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."booking_is_upcoming"("p_end_time" timestamp with time zone, "p_status" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  SELECT p_status NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED')
     AND p_end_time IS NOT NULL
     AND p_end_time > now();
$$;


ALTER FUNCTION "public"."booking_is_upcoming"("p_end_time" timestamp with time zone, "p_status" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."booking_is_upcoming"("p_end_time" timestamp with time zone, "p_status" "text") IS 'True while a booking is still in the future, so lists can split Upcoming vs History from server time rather than the stored status.';



CREATE OR REPLACE FUNCTION "public"."can_join_session"("p_booking_id" "uuid", "p_user_id" "uuid") RETURNS TABLE("can_join" boolean, "meeting_link" "text", "reason" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_booking public.bookings;
  v_state   text;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, 'Session not found';
    RETURN;
  END IF;

  IF v_booking.seeker_id <> p_user_id AND v_booking.mentor_id <> p_user_id THEN
    RETURN QUERY SELECT false, NULL::text, 'Not authorized';
    RETURN;
  END IF;

  -- Reconcile before deciding, so a stale CONFIRMED row cannot authorize a join.
  v_state := public.reconcile_expired_sessions(p_booking_id);

  IF v_state IS NULL THEN
    v_state := public.resolve_session_state(
      v_booking.status, v_booking.start_time, v_booking.end_time,
      v_booking.actual_ended_at, now()
    );
  END IF;

  IF v_state = 'CANCELLED' THEN
    RETURN QUERY SELECT false, NULL::text, 'Session was cancelled';
    RETURN;
  END IF;

  IF v_state = 'SCHEDULED' THEN
    RETURN QUERY SELECT false, NULL::text, 'Session not yet started (join available 5 minutes before)';
    RETURN;
  END IF;

  IF v_state = 'COMPLETED' THEN
    RETURN QUERY SELECT false, NULL::text, 'Session has ended';
    RETURN;
  END IF;

  IF v_booking.meeting_url IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, 'Meeting link not set';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_booking.meeting_url, 'OK';
END;
$$;


ALTER FUNCTION "public"."can_join_session"("p_booking_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_join_session"("p_booking_id" "uuid", "p_user_id" "uuid") IS 'Legacy-compatible join gate, repointed at the real bookings table. Releases the meeting link only inside [start-5m, end).';



CREATE OR REPLACE FUNCTION "public"."cancel_reschedule_request"("p_request_id" "uuid", "p_seeker_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_request public.reschedule_requests;
  v_now timestamp with time zone;
BEGIN
  v_now := clock_timestamp();

  SELECT * INTO v_request
  FROM public.reschedule_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: RESCHEDULE_REQUEST_NOT_FOUND, Reschedule request not found';
  END IF;

  IF v_request.seeker_id <> p_seeker_id THEN
    RAISE EXCEPTION 'code: FORBIDDEN_NOT_BOOKING_OWNER, You are not authorized to cancel this reschedule request';
  END IF;

  IF v_request.status <> 'PENDING' THEN
    RAISE EXCEPTION 'code: RESCHEDULE_REQUEST_CLOSED, This reschedule request has already been closed';
  END IF;

  UPDATE public.slot_holds
  SET status = 'RELEASED'
  WHERE id = v_request.hold_id AND status = 'ACTIVE';

  UPDATE public.reschedule_requests
  SET status = 'CANCELLED',
      mentor_responded_at = v_now,
      updated_at = v_now
  WHERE id = v_request.id
  RETURNING * INTO v_request;

  INSERT INTO public.notifications (
    user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, created_at
  ) VALUES (
    v_request.mentor_id,
    'Reschedule Request Withdrawn',
    'The seeker withdrew their reschedule request. The original session time is unchanged.',
    'BOOKING',
    'MENTOR_RESCHEDULE_CANCELLED',
    'booking',
    v_request.booking_id::text,
    format('/mentor/booking-detail?bookingId=%s', v_request.booking_id),
    FALSE,
    v_now
  );

  RETURN json_build_object('success', true, 'request_id', v_request.id, 'status', v_request.status);
END;
$$;


ALTER FUNCTION "public"."cancel_reschedule_request"("p_request_id" "uuid", "p_seeker_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_availability_overlap"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if exists (
    select 1 from availability_slots
    where mentor_id = new.mentor_id
      and day_of_week = new.day_of_week
      and is_available = true
      and id <> new.id
      and not (new.end_time <= start_time or new.start_time >= end_time)
  ) then
    raise exception 'Availability slot overlaps with existing slot';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."check_availability_overlap"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_meeting_link_overdue"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_count integer;
BEGIN
  -- Set meeting_link_overdue = true for mentor_pending sessions where:
  -- - deadline has passed
  -- - no meeting link added yet
  -- - not already flagged overdue
  UPDATE sessions
  SET meeting_link_overdue = true
  WHERE status = 'mentor_pending'
    AND meeting_link IS NULL
    AND meeting_link_deadline IS NOT NULL
    AND meeting_link_deadline < now()
    AND meeting_link_overdue = false;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Notify mentors of overdue links (only for newly flagged)
  INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
  SELECT mentor_id, 'meeting_overdue', 'Meeting link is overdue',
         'Your meeting link deadline has passed. Please add a meeting link to confirm your session.',
         'booking', id
  FROM sessions
  WHERE status = 'mentor_pending'
    AND meeting_link IS NULL
    AND meeting_link_overdue = true
    AND meeting_link_deadline < now();

  -- Notify admins of overdue links
  INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
  SELECT ur.user_id, 'mentor_link_overdue', 'Mentor meeting link overdue',
         'A mentor has not added a meeting link for an upcoming session.',
         'booking', s.id
  FROM sessions s
  JOIN user_roles ur ON ur.role = 'admin'
  WHERE s.status = 'mentor_pending'
    AND s.meeting_link IS NULL
    AND s.meeting_link_overdue = true
    AND s.meeting_link_deadline < now();

  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."check_meeting_link_overdue"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_expired_holds"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.booking_holds
  set status = 'released', released_at = now()
  where status = 'active' and expires_at <= now();
  return 1;
end;
$$;


ALTER FUNCTION "public"."cleanup_expired_holds"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_expired_sessions"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_ids       uuid[] := ARRAY[]::uuid[];
  v_row       record;
  v_completed integer := 0;
  v_notified  integer := 0;
BEGIN
  -- ended_by_role / end_reason stay NULL: a natural expiry is not a manual end.
  FOR v_row IN
    UPDATE public.bookings b
       SET status          = 'COMPLETED',
           actual_ended_at = b.end_time,
           updated_at      = now()
     WHERE b.status = 'CONFIRMED'
       AND b.end_time IS NOT NULL
       AND b.end_time <= now()
    RETURNING b.id
  LOOP
    v_ids := array_append(v_ids, v_row.id);
  END LOOP;

  v_completed := COALESCE(array_length(v_ids, 1), 0);
  IF v_completed = 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO public.notifications (
    user_id, title, message, type, link, is_read,
    event_type, entity_type, entity_id, metadata
  )
  SELECT r.user_id,
         'Session completed',
         'Your 1:1 session (' || coalesce(b.booking_code, 'session')
           || ') has ended. The meeting room is now closed and the session workspace is available.',
         'SESSION',
         CASE
           WHEN r.user_id = b.seeker_id
             THEN '/seeker/session?bookingId=' || b.id
           ELSE '/mentor/booking-detail?bookingId=' || b.id
         END,
         false,
         'SESSION_COMPLETED',
         'booking',
         b.id::text,
         jsonb_build_object(
           'bookingId', b.id,
           'auto_completed', true,
           'recipientRole', CASE WHEN r.user_id = b.seeker_id THEN 'seeker' ELSE 'mentor' END
         )
    FROM public.bookings b
    CROSS JOIN LATERAL (VALUES (b.mentor_id), (b.seeker_id)) AS r(user_id)
   WHERE b.id = ANY(v_ids)
     AND r.user_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_notified = ROW_COUNT;

  RAISE NOTICE 'complete_expired_sessions: completed % expired booking(s), % new notification(s)',
    v_completed, v_notified;

  RETURN v_completed;
END;
$$;


ALTER FUNCTION "public"."complete_expired_sessions"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."complete_expired_sessions"() IS 'Reconciles CONFIRMED bookings whose end_time has passed to COMPLETED. Idempotent; safe to run every minute from pg_cron and from any read path.';



CREATE OR REPLACE FUNCTION "public"."complete_manual_refund"("p_payment_id" "uuid", "p_admin_id" "uuid", "p_amount_paise" integer, "p_method" "text", "p_reference" "text", "p_proof_path" "text", "p_admin_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_payment public.payments;
  v_booking public.bookings;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_original_paise INTEGER;
  v_reference TEXT;
  v_method TEXT;
  v_proof_path TEXT;
  v_note TEXT;
  v_amount_label TEXT;
  v_booking_code TEXT;
BEGIN
  -- ---- 1. Authorization (database-side) ----------------------------------
  IF p_admin_id IS NULL OR NOT public.has_role(p_admin_id, 'admin')
     OR (auth.uid() IS NOT NULL AND auth.uid() <> p_admin_id) THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, Only an admin can complete a refund';
  END IF;

  -- ---- 2. Input validation, before the lock ------------------------------
  v_reference := NULLIF(btrim(COALESCE(p_reference, '')), '');
  IF v_reference IS NULL OR length(v_reference) > 64 THEN
    RAISE EXCEPTION 'code: REFUND_REFERENCE_REQUIRED, The refund reference / UTR is required and must be 64 characters or fewer';
  END IF;

  v_method := upper(btrim(COALESCE(p_method, '')));
  IF v_method NOT IN ('UPI', 'BANK_TRANSFER') THEN
    RAISE EXCEPTION 'code: REFUND_METHOD_INVALID, The refund method must be UPI or BANK_TRANSFER';
  END IF;

  -- The proof object key is generated by this server, never chosen by the
  -- browser. The prefix check is a second line of defence: it means a crafted
  -- path cannot point the record at somebody else's object, and it guarantees
  -- the row never carries a public URL.
  v_proof_path := NULLIF(btrim(COALESCE(p_proof_path, '')), '');
  IF v_proof_path IS NULL OR v_proof_path !~ ('^refunds/' || p_payment_id::text || '/[^/]+$')
     OR v_proof_path ~ '\.\.' OR v_proof_path ~ '\\' THEN
    RAISE EXCEPTION 'code: REFUND_PROOF_REQUIRED, The refund proof is required';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_admin_note, '')), '');
  IF length(COALESCE(v_note, '')) > 500 THEN
    RAISE EXCEPTION 'code: REFUND_NOTE_TOO_LONG, The admin note is too long';
  END IF;

  -- ---- 3. Lock the payment ------------------------------------------------
  -- FOR UPDATE is what makes this concurrency-safe: two admins submitting the
  -- same refund serialise here, and the loser sees the settled row in step 4.
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: PAYMENT_NOT_FOUND, Payment not found';
  END IF;

  -- ---- 4. Eligibility -----------------------------------------------------
  -- Only a MANUAL UPI/QR payment can be completed by an admin. A Razorpay
  -- refund is settled by the gateway's own refund events and must never be
  -- marked complete by hand.
  IF v_payment.gateway IS DISTINCT FROM 'manual' THEN
    RAISE EXCEPTION 'code: REFUND_NOT_MANUAL, This refund is settled by the payment gateway, not by an admin';
  END IF;

  IF v_payment.status = 'REFUNDED' OR v_payment.refund_status = 'REFUNDED' THEN
    RAISE EXCEPTION 'code: ALREADY_REFUNDED, This payment has already been refunded';
  END IF;

  -- Money was only ever received on a VERIFIED payment. Refunding anything
  -- else would return money the platform never took.
  IF v_payment.status <> 'VERIFIED' THEN
    RAISE EXCEPTION 'code: PAYMENT_NOT_REFUNDABLE, This payment is not in a refundable state';
  END IF;

  IF v_payment.refund_status <> 'PENDING' OR v_payment.manual_refund_required IS NOT TRUE THEN
    RAISE EXCEPTION 'code: REFUND_NOT_PENDING, This payment has no refund awaiting completion';
  END IF;

  -- ---- 5. Money rules, re-checked against the stored payment -------------
  v_original_paise := round(v_payment.amount_inr * 100)::INTEGER;

  IF p_amount_paise IS NULL OR p_amount_paise <= 0 THEN
    RAISE EXCEPTION 'code: REFUND_AMOUNT_INVALID, The refund amount must be more than zero';
  END IF;

  IF p_amount_paise > v_original_paise THEN
    RAISE EXCEPTION 'code: REFUND_AMOUNT_EXCEEDS_PAYMENT, The refund amount cannot exceed the amount that was paid';
  END IF;

  -- The product has no partial refunds (see docs/prd.md); the only accepted
  -- amount is the full original. Kept as its own code so the two failure modes
  -- stay distinguishable if partial refunds are ever introduced.
  IF p_amount_paise <> v_original_paise THEN
    RAISE EXCEPTION 'code: REFUND_AMOUNT_NOT_FULL, Only a full refund is supported for this payment';
  END IF;

  -- ---- 6. The transition + the audit trail + the notification ------------
  -- One transaction. Either the payment is REFUNDED and the seeker was told, or
  -- nothing happened at all.
  UPDATE public.payments
  SET status                    = 'REFUNDED',
      refund_status             = 'REFUNDED',
      refund_amount_paise       = p_amount_paise,
      refund_method             = v_method,
      refund_reference          = v_reference,
      refund_proof_storage_path = v_proof_path,
      refund_admin_note         = v_note,
      refund_reason             = COALESCE(v_payment.refund_reason, 'manual_payment_refund'),
      manual_refund_required    = FALSE,
      refunded_at               = v_now,
      refunded_by               = p_admin_id,
      updated_at                = v_now
  WHERE id = v_payment.id;

  INSERT INTO public.payment_events
    (payment_id, status, event_type, gateway, gateway_payment_id, amount_inr, reason, created_by, created_at)
  VALUES (
    v_payment.id,
    'REFUNDED',
    'MANUAL_REFUND_COMPLETED',
    'manual',
    NULL,
    v_payment.amount_inr,
    'Manual refund completed by admin via ' || v_method || ' (reference ' || v_reference || ').',
    p_admin_id,
    v_now
  );

  SELECT id, booking_code INTO v_booking FROM public.bookings WHERE id = v_payment.booking_id;
  v_booking_code := v_booking.booking_code;

  -- Exactly ONE seeker notification, written here rather than from Express so it
  -- cannot survive a handler that died after the commit. It carries the amount,
  -- the method and the reference - and deliberately NOT the admin note and NOT
  -- the storage path, which are internal.
  v_amount_label := '₹' || to_char(p_amount_paise / 100.0, 'FM990,00,000.00');
  v_amount_label := trim(trailing '.' from trim(trailing '0' from v_amount_label));

  INSERT INTO public.notifications
    (user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, metadata, created_at)
  VALUES (
    v_payment.seeker_id,
    'Refund Completed',
    'Your ' || v_amount_label || ' refund' ||
      CASE WHEN v_booking_code IS NOT NULL THEN ' for booking ' || v_booking_code ELSE '' END ||
      ' has been completed. It was sent by ' ||
      CASE v_method WHEN 'BANK_TRANSFER' THEN 'bank transfer' ELSE 'upi' END ||
      '. Reference: ' || v_reference || '.',
    'PAYMENT',
    'REFUND_COMPLETED',
    'payment',
    v_payment.id::text,
    '/seeker/bookings',
    FALSE,
    jsonb_build_object(
      'bookingId', v_payment.booking_id,
      'bookingCode', v_booking_code,
      'paymentId', v_payment.id,
      'amountInr', p_amount_paise / 100.0,
      'refundMethod', v_method,
      'refundReference', v_reference),
    v_now
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'payment_id', v_payment.id,
    'booking_id', v_payment.booking_id,
    'booking_code', v_booking_code,
    'refund_amount_paise', p_amount_paise,
    'refund_method', v_method,
    'refund_reference', v_reference,
    'refunded_at', v_now,
    'refunded_by', p_admin_id
  );
END;
$_$;


ALTER FUNCTION "public"."complete_manual_refund"("p_payment_id" "uuid", "p_admin_id" "uuid", "p_amount_paise" integer, "p_method" "text", "p_reference" "text", "p_proof_path" "text", "p_admin_note" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_code" "text" NOT NULL,
    "mentor_id" "uuid" NOT NULL,
    "seeker_id" "uuid" NOT NULL,
    "gig_id" "uuid" NOT NULL,
    "segment_id" "uuid" NOT NULL,
    "hold_id" "uuid",
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "seeker_timezone" "text" DEFAULT 'Asia/Kolkata'::"text" NOT NULL,
    "mentor_timezone" "text" DEFAULT 'Asia/Kolkata'::"text" NOT NULL,
    "amount_inr" integer NOT NULL,
    "status" "text" DEFAULT 'PAYMENT_PENDING'::"text" NOT NULL,
    "meeting_url" "text",
    "cancellation_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actual_ended_at" timestamp with time zone,
    "ended_by_role" "text",
    "end_reason" "text",
    "base_amount_inr" integer NOT NULL,
    "discount_amount_inr" integer DEFAULT 0 NOT NULL,
    "original_amount_inr" integer,
    "coupon_id" "uuid",
    "coupon_code" "text",
    CONSTRAINT "bookings_amount_inr_check" CHECK (("amount_inr" >= 0)),
    CONSTRAINT "bookings_coupon_code_check" CHECK ((("coupon_code" IS NULL) OR ("coupon_code" ~ '^[A-Z0-9_]{4,24}$'::"text"))),
    CONSTRAINT "bookings_discount_amount_inr_check" CHECK (("discount_amount_inr" >= 0)),
    CONSTRAINT "bookings_ended_by_role_check" CHECK ((("ended_by_role" IS NULL) OR ("ended_by_role" = ANY (ARRAY['mentor'::"text", 'seeker'::"text", 'admin'::"text"])))),
    CONSTRAINT "bookings_status_check" CHECK (("status" = ANY (ARRAY['PAYMENT_PENDING'::"text", 'PAYMENT_PROCESSING'::"text", 'PENDING_VERIFICATION'::"text", 'MENTOR_PENDING'::"text", 'CONFIRMED'::"text", 'COMPLETED'::"text", 'CANCELLED'::"text", 'REJECTED'::"text"]))),
    CONSTRAINT "chk_booking_coupon_snapshot_complete" CHECK (((("coupon_id" IS NOT NULL) AND ("coupon_code" IS NOT NULL) AND ("discount_amount_inr" > 0)) OR (("coupon_id" IS NULL) AND ("coupon_code" IS NULL) AND ("discount_amount_inr" = 0)))),
    CONSTRAINT "chk_booking_discount_floor" CHECK ((("coupon_id" IS NULL) OR ("amount_inr" >= 1))),
    CONSTRAINT "chk_booking_pricing_arithmetic" CHECK (("amount_inr" = ("base_amount_inr" - "discount_amount_inr"))),
    CONSTRAINT "chk_booking_time" CHECK (("start_time" < "end_time")),
    CONSTRAINT "chk_meeting_url_https" CHECK ((("meeting_url" IS NULL) OR ("meeting_url" ~* '^https://'::"text")))
);

ALTER TABLE ONLY "public"."bookings" REPLICA IDENTITY FULL;


ALTER TABLE "public"."bookings" OWNER TO "postgres";


COMMENT ON TABLE "public"."bookings" IS 'Session state (status, actual_ended_at, ended_by_role, end_reason, meeting_url, start_time, end_time) is service-role and SECURITY DEFINER RPC only. The authenticated role holds SELECT, INSERT, and UPDATE on cancellation_reason/updated_at only.';



COMMENT ON COLUMN "public"."bookings"."base_amount_inr" IS 'Gig price at the moment the hold was created, before any coupon. amount_inr = base_amount_inr - discount_amount_inr is enforced by a CHECK constraint.';



COMMENT ON COLUMN "public"."bookings"."original_amount_inr" IS 'Gig original_price_inr at hold time, or NULL when the gig had no genuine reduction. Historical: never recomputed from the current gig row.';



CREATE OR REPLACE FUNCTION "public"."confirm_booking"("p_booking_id" "uuid", "p_meeting_url" "text", "p_mentor_id" "uuid" DEFAULT NULL::"uuid") RETURNS "public"."bookings"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_booking public.bookings;
  v_url TEXT := trim(p_meeting_url);
BEGIN
  IF p_mentor_id IS NULL OR NOT public.has_role(p_mentor_id, 'mentor')
     OR (auth.uid() IS NOT NULL AND auth.uid() <> p_mentor_id) THEN
    RAISE EXCEPTION 'Unauthorized (code: UNAUTHORIZED)';
  END IF;

  IF v_url IS NULL OR v_url !~* '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'Meeting URL must be HTTPS (code: INVALID_MEETING_URL)';
  END IF;

  SELECT * INTO v_booking FROM public.bookings
  WHERE id = p_booking_id AND mentor_id = p_mentor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found (code: BOOKING_NOT_FOUND)'; END IF;

  IF v_booking.status <> 'MENTOR_PENDING' THEN
    RAISE EXCEPTION 'Invalid booking state (code: INVALID_STATE_TRANSITION)';
  END IF;

  UPDATE public.bookings SET meeting_url = v_url, status = 'CONFIRMED', updated_at = NOW()
  WHERE id = v_booking.id RETURNING * INTO v_booking;

  INSERT INTO public.notifications
    (user_id, title, message, type, event_type, entity_type, entity_id, link, metadata)
  VALUES
    (v_booking.seeker_id, 'Session confirmed',
     'Your mentor added a secure meeting link for booking ' || v_booking.booking_code || '.',
     'SESSION', 'MENTOR_CONFIRMED', 'booking', v_booking.id::text,
     '/seeker/bookings?bookingId=' || v_booking.id::text,
     jsonb_build_object('bookingId', v_booking.id, 'bookingCode', v_booking.booking_code));

  RETURN v_booking;
END;
$_$;


ALTER FUNCTION "public"."confirm_booking"("p_booking_id" "uuid", "p_meeting_url" "text", "p_mentor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."convert_hold_to_booking"("p_hold_id" "uuid", "p_seeker_id" "uuid", "p_booking_code" "text", "p_proof_storage_path" "text", "p_transaction_reference" "text" DEFAULT NULL::"text") RETURNS "public"."bookings"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_hold public.slot_holds;
  v_gig public.gigs;
  v_booking public.bookings;
  v_mentor_tz TEXT;
  v_seeker_tz TEXT;
BEGIN
  -- 1. Pessimistic lock on the slot hold record
  SELECT * INTO v_hold
  FROM public.slot_holds
  WHERE id = p_hold_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Slot hold not found';
  END IF;

  IF v_hold.seeker_id <> p_seeker_id THEN
    RAISE EXCEPTION 'Unauthorized: Slot hold does not belong to this user';
  END IF;

  IF v_hold.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Slot hold is no longer active (status: %)', v_hold.status;
  END IF;

  IF v_hold.expires_at <= NOW() THEN
    UPDATE public.slot_holds SET status = 'EXPIRED' WHERE id = p_hold_id;
    RAISE EXCEPTION 'Slot hold has expired';
  END IF;

  -- 2. Fetch gig details
  SELECT * INTO v_gig FROM public.gigs WHERE id = v_hold.gig_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Associated gig not found';
  END IF;

  -- 3. Fetch timezones
  SELECT timezone INTO v_mentor_tz FROM public.profiles WHERE id = v_hold.mentor_id;
  SELECT timezone INTO v_seeker_tz FROM public.profiles WHERE id = p_seeker_id;

  v_mentor_tz := COALESCE(v_mentor_tz, 'Asia/Kolkata');
  v_seeker_tz := COALESCE(v_seeker_tz, 'Asia/Kolkata');

  -- 4. Mark hold as CONVERTED
  UPDATE public.slot_holds
  SET status = 'CONVERTED'
  WHERE id = p_hold_id;

  -- 5. Insert Booking
  INSERT INTO public.bookings (
    booking_code,
    mentor_id,
    seeker_id,
    gig_id,
    segment_id,
    hold_id,
    start_time,
    end_time,
    seeker_timezone,
    mentor_timezone,
    amount_inr,
    status,
    created_at,
    updated_at
  ) VALUES (
    p_booking_code,
    v_hold.mentor_id,
    v_hold.seeker_id,
    v_gig.id,
    v_gig.segment_id,
    v_hold.id,
    v_hold.start_time,
    v_hold.end_time,
    v_seeker_tz,
    v_mentor_tz,
    v_gig.price_inr,
    'PENDING_VERIFICATION',
    NOW(),
    NOW()
  )
  RETURNING * INTO v_booking;

  -- 6. Insert Payment Record
  INSERT INTO public.payments (
    booking_id,
    seeker_id,
    amount_inr,
    status,
    proof_storage_path,
    transaction_reference,
    created_at,
    updated_at
  ) VALUES (
    v_booking.id,
    p_seeker_id,
    v_gig.price_inr,
    'PENDING_VERIFICATION',
    p_proof_storage_path,
    p_transaction_reference,
    NOW(),
    NOW()
  );

  -- 7. Initialize Blank Session Workspace
  INSERT INTO public.session_workspaces (
    booking_id,
    mentor_id,
    seeker_id,
    status,
    summary,
    takeaways,
    action_items,
    resources,
    created_at,
    updated_at
  ) VALUES (
    v_booking.id,
    v_hold.mentor_id,
    p_seeker_id,
    'PENDING',
    '',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    NOW(),
    NOW()
  );

  -- 8. Create Notification for Admin & Seeker
  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    p_seeker_id,
    'Payment Submitted',
    'Your payment for booking #' || p_booking_code || ' has been submitted for admin verification.',
    'PAYMENT',
    '/seeker/bookings'
  );

  RETURN v_booking;
END;
$$;


ALTER FUNCTION "public"."convert_hold_to_booking"("p_hold_id" "uuid", "p_seeker_id" "uuid", "p_booking_code" "text", "p_proof_storage_path" "text", "p_transaction_reference" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_booking_with_hold"("p_seeker_id" "uuid", "p_mentor_id" "uuid", "p_segment_id" "uuid", "p_gig_id" "uuid", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_hold public.slot_holds;
  v_gig public.gigs;
  v_booking public.bookings;
  v_exception public.mentor_availability_exceptions;
  v_mentor_tz TEXT;
  v_seeker_tz TEXT;
  v_booking_code TEXT;
  v_local_start timestamp;
  v_local_end timestamp;
  v_local_date date;
  v_local_dow int;
  v_duration_minutes int;
  v_now timestamp with time zone;
BEGIN
  -- 1. Input sanity checks
  IF p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'code: INVALID_INTERVAL, Slot start time must be earlier than end time';
  END IF;

  v_now := clock_timestamp();

  IF p_start_time <= v_now THEN
    RAISE EXCEPTION 'code: PAST_SLOT_FORBIDDEN, Cannot hold a slot that begins in the past';
  END IF;

  -- 1b. Booking cutoff. `p_start_time` is an absolute instant, so this is the
  --     mentor's own local start compared against the current instant and is
  --     correct for any mentor timezone.
  IF p_start_time < v_now + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'code: BOOKING_CUTOFF_REACHED, This slot can no longer be booked because it starts in less than 5 minutes';
  END IF;

  -- 2. Explicit pessimistic lock on the mentor's profile row to serialize
  --    concurrent booking attempts. Every check below and the hold insert run
  --    under this lock, so two seekers racing for one slot cannot both win.
  PERFORM 1 FROM public.profiles WHERE id = p_mentor_id FOR UPDATE;

  -- 3. Re-read the wall clock after acquiring the lock. A request that waited
  --    behind another booking may have crossed the cutoff while queued, so the
  --    boundary is re-tested against the instant the hold would actually be
  --    written, not the one that arrived on the wire.
  v_now := clock_timestamp();
  IF p_start_time < v_now + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'code: BOOKING_CUTOFF_REACHED, This slot can no longer be booked because it starts in less than 5 minutes';
  END IF;

  -- 4. Expire stale holds for this mentor
  UPDATE public.slot_holds
  SET status = 'EXPIRED'
  WHERE mentor_id = p_mentor_id
    AND status = 'ACTIVE'
    AND expires_at <= clock_timestamp();

  -- 5. Fetch gig + timezones before any availability decision
  SELECT * INTO v_gig FROM public.gigs WHERE id = p_gig_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: GIG_NOT_FOUND, Associated gig not found';
  END IF;

  -- 5a. The gig must be an ACTIVE offer of THIS mentor in THIS segment.
  --
  --     `gigs.segment_id` is the only thing that decides which segment a gig
  --     belongs to, so it is the only thing consulted. Comparing the caller's
  --     `p_segment_id` against the gig's own column is what makes the two
  --     arguments mutually constraining: there is no pair of values that
  --     describes one booking and spans two segments.
  IF NOT v_gig.is_active OR v_gig.mentor_id <> p_mentor_id OR v_gig.segment_id <> p_segment_id THEN
    RAISE EXCEPTION 'code: GIG_MISMATCH, Gig is not an active offer of this mentor in this segment';
  END IF;

  SELECT timezone INTO v_mentor_tz FROM public.profiles WHERE id = p_mentor_id;
  SELECT timezone INTO v_seeker_tz FROM public.profiles WHERE id = p_seeker_id;
  v_mentor_tz := COALESCE(v_mentor_tz, 'Asia/Kolkata');
  v_seeker_tz := COALESCE(v_seeker_tz, 'Asia/Kolkata');

  -- 6. Duration must equal the ACTIVE gig duration, never a client constant
  v_duration_minutes := ROUND(EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 60.0)::int;
  IF v_duration_minutes <> v_gig.duration_minutes THEN
    RAISE EXCEPTION 'code: DURATION_MISMATCH, Slot duration (%) must equal the active gig duration (%)', v_duration_minutes, v_gig.duration_minutes;
  END IF;

  -- 7. Re-validate the requested interval against the mentor's LIVE availability.
  --    Both instants are resolved in the mentor's own timezone, so a session that
  --    straddles local midnight is rejected rather than silently booked.
  v_local_start := p_start_time AT TIME ZONE v_mentor_tz;
  v_local_end := p_end_time AT TIME ZONE v_mentor_tz;
  v_local_date := v_local_start::date;
  v_local_dow := EXTRACT(DOW FROM v_local_start)::int;

  IF v_local_start::date <> v_local_end::date THEN
    RAISE EXCEPTION 'code: OUTSIDE_AVAILABILITY, Slot crosses the mentor local calendar day';
  END IF;

  SELECT * INTO v_exception
  FROM public.mentor_availability_exceptions
  WHERE mentor_id = p_mentor_id
    AND exception_date = v_local_date;

  IF FOUND THEN
    -- A date exception is authoritative for that date and never merges with
    -- the recurring weekly schedule.
    IF NOT v_exception.is_available THEN
      RAISE EXCEPTION 'code: DATE_EXCEPTION_UNAVAILABLE, Mentor is marked unavailable on this date';
    END IF;

    IF v_exception.start_time IS NULL
       OR v_exception.end_time IS NULL
       OR v_local_start::time < v_exception.start_time
       OR v_local_end::time > v_exception.end_time THEN
      RAISE EXCEPTION 'code: OUTSIDE_EXCEPTION_HOURS, Slot falls outside the custom hours set for this date';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.mentor_availability a
      WHERE a.mentor_id = p_mentor_id
        AND a.is_enabled
        AND a.day_of_week = v_local_dow
        AND a.start_time <= v_local_start::time
        AND a.end_time >= v_local_end::time
    ) THEN
      RAISE EXCEPTION 'code: OUTSIDE_AVAILABILITY, Slot falls outside the mentor current availability';
    END IF;
  END IF;

  -- 8. Check for overlapping non-cancelled bookings
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE mentor_id = p_mentor_id
      AND status NOT IN ('CANCELLED', 'REJECTED')
      AND tstzrange(start_time, end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) THEN
    RAISE EXCEPTION 'code: SLOT_ALREADY_BOOKED, Requested slot is already booked';
  END IF;

  -- 9. Check for overlapping active holds
  IF EXISTS (
    SELECT 1 FROM public.slot_holds
    WHERE mentor_id = p_mentor_id
      AND status = 'ACTIVE'
      AND expires_at > clock_timestamp()
      AND tstzrange(start_time, end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) THEN
    RAISE EXCEPTION 'code: SLOT_HELD_BY_OTHER, Requested slot is currently on hold by another seeker';
  END IF;

  -- 10. Generate booking code
  v_booking_code := 'BK-' || TO_CHAR(clock_timestamp(), 'YYMMDDHH24MI') || '-' || SUBSTRING(gen_random_uuid()::text FROM 1 FOR 4);

  -- 11. Create the slot hold, expiring when the canonical hold window elapses
  INSERT INTO public.slot_holds (
    mentor_id, seeker_id, gig_id, start_time, end_time, status, expires_at, created_at
  ) VALUES (
    p_mentor_id, p_seeker_id, p_gig_id, p_start_time, p_end_time, 'ACTIVE',
    clock_timestamp() + public.hold_duration_interval(), clock_timestamp()
  )
  RETURNING * INTO v_hold;

  -- 12. Create PAYMENT_PENDING booking
  --
  --     `gig_id` comes from the resolved gig row and `segment_id` from the
  --     validated argument. Step 5a proved they describe the same offer, so the
  --     stored pair can never contradict itself or the screen it was booked from.
  --
  --     The price snapshot is taken from the SAME resolved gig row, so what the
  --     seeker is shown and what they are charged cannot come from two different
  --     reads of a price that changed in between. `amount_inr` is the gig price
  --     and stays the amount charged; a coupon can only lower it later, through
  --     `apply_coupon_to_booking`.
  INSERT INTO public.bookings (
    booking_code, mentor_id, seeker_id, gig_id, segment_id, hold_id,
    start_time, end_time, seeker_timezone, mentor_timezone,
    amount_inr, base_amount_inr, discount_amount_inr, original_amount_inr,
    status, created_at, updated_at
  ) VALUES (
    v_booking_code, p_mentor_id, p_seeker_id, v_gig.id, p_segment_id, v_hold.id,
    p_start_time, p_end_time, v_seeker_tz, v_mentor_tz,
    v_gig.price_inr, v_gig.price_inr, 0, v_gig.original_price_inr,
    'PAYMENT_PENDING', clock_timestamp(), clock_timestamp()
  )
  RETURNING * INTO v_booking;

  -- 13. Return the canonical booking record (with hold_id and status)
  RETURN json_build_object(
    'success', true,
    'booking', json_build_object(
      'id', v_booking.id,
      'booking_code', v_booking.booking_code,
      'mentor_id', v_booking.mentor_id,
      'seeker_id', v_booking.seeker_id,
      'gig_id', v_booking.gig_id,
      'segment_id', v_booking.segment_id,
      'hold_id', v_booking.hold_id,
      'start_time', v_booking.start_time,
      'end_time', v_booking.end_time,
      'seeker_timezone', v_booking.seeker_timezone,
      'mentor_timezone', v_booking.mentor_timezone,
      'amount_inr', v_booking.amount_inr,
      'base_amount_inr', v_booking.base_amount_inr,
      'discount_amount_inr', v_booking.discount_amount_inr,
      'original_amount_inr', v_booking.original_amount_inr,
      'status', v_booking.status,
      'created_at', v_booking.created_at,
      'updated_at', v_booking.updated_at
    ),
    'hold', json_build_object(
      'id', v_hold.id,
      'mentor_id', v_hold.mentor_id,
      'seeker_id', v_hold.seeker_id,
      'gig_id', v_hold.gig_id,
      'start_time', v_hold.start_time,
      'end_time', v_hold.end_time,
      'status', v_hold.status,
      'expires_at', v_hold.expires_at,
      'created_at', v_hold.created_at
    )
  );
END;
$$;


ALTER FUNCTION "public"."create_booking_with_hold"("p_seeker_id" "uuid", "p_mentor_id" "uuid", "p_segment_id" "uuid", "p_gig_id" "uuid", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_or_update_mentor_application"("p_full_name" "text", "p_bio" "text" DEFAULT ''::"text", "p_timezone" "text" DEFAULT 'Asia/Kolkata'::"text") RETURNS "public"."mentor_applications"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_app public.mentor_applications;
BEGIN
  -- Upsert: create new or update existing draft/rejected
  INSERT INTO public.mentor_applications (user_id, full_name, bio, timezone, status, updated_at)
  VALUES (auth.uid(), p_full_name, p_bio, p_timezone, 'draft', NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        bio = EXCLUDED.bio,
        timezone = EXCLUDED.timezone,
        updated_at = NOW(),
        status = CASE
          WHEN mentor_applications.status IN ('draft', 'rejected') THEN mentor_applications.status
          ELSE mentor_applications.status -- keep approved/pending_review unchanged
        END
  RETURNING * INTO v_app;

  PERFORM public._log_mentor_app_audit(v_app.id, 'created', NULL, NULL, jsonb_build_object('full_name', p_full_name));

  RETURN v_app;
END;
$$;


ALTER FUNCTION "public"."create_or_update_mentor_application"("p_full_name" "text", "p_bio" "text", "p_timezone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_payment_booking"("p_mentor_id" "uuid", "p_scheduled_start" timestamp with time zone, "p_amount" numeric, "p_duration_mins" integer DEFAULT 30, "p_hold_id" "uuid" DEFAULT NULL::"uuid", "p_currency" "text" DEFAULT 'INR'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_student_id uuid := auth.uid();
  v_mentor_active boolean;
  v_existing_session uuid;
  v_hold RECORD;
  v_booking_id uuid;
  v_payment_id uuid;
  v_duration interval := (p_duration_mins || ' minutes')::interval;
  v_min_notice_seconds numeric;
  v_max_days_seconds numeric;
  v_rule_value text;
  v_now timestamptz := now();
BEGIN
  -- 0. Authentication
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- 1. Validate mentor is active and verified
  SELECT mp.is_active AND mp.is_verified INTO v_mentor_active
  FROM public.mentor_profiles mp
  WHERE mp.user_id = p_mentor_id;

  IF v_mentor_active IS NOT TRUE THEN
    RAISE EXCEPTION 'mentor_inactive';
  END IF;

  -- 2. Enforce booking notice rule (minimum notice)
  SELECT value::text INTO v_rule_value
  FROM public.booking_rules
  WHERE key = 'minimum_booking_notice_minutes';

  IF v_rule_value IS NULL THEN
    v_min_notice_seconds := 30 * 60;
  ELSE
    v_min_notice_seconds := v_rule_value::numeric * 60;
  END IF;

  IF p_scheduled_start < (v_now + (v_min_notice_seconds || ' seconds')::interval) THEN
    RAISE EXCEPTION 'booking_notice_violation';
  END IF;

  -- 3. Enforce maximum booking window
  SELECT value::text INTO v_rule_value
  FROM public.booking_rules
  WHERE key = 'maximum_booking_days';

  IF v_rule_value IS NULL THEN
    v_max_days_seconds := 30 * 86400;
  ELSE
    v_max_days_seconds := v_rule_value::numeric * 86400;
  END IF;

  IF p_scheduled_start > (v_now + (v_max_days_seconds || ' seconds')::interval) THEN
    RAISE EXCEPTION 'booking_window_exceeded';
  END IF;

  -- 4. Prevent double-booking: check for overlapping sessions
  SELECT id INTO v_existing_session
  FROM public.sessions
  WHERE mentor_id = p_mentor_id
    AND status NOT IN ('cancelled', 'rejected', 'failed')
    AND tstzrange(p_scheduled_start, p_scheduled_start + v_duration)
      && tstzrange(scheduled_time, scheduled_time + (duration_mins || ' minutes')::interval);

  IF v_existing_session IS NOT NULL THEN
    RAISE EXCEPTION 'just_booked_by_another_student';
  END IF;

  -- 5. Validate slot hold if provided
  IF p_hold_id IS NOT NULL THEN
    SELECT * INTO v_hold
    FROM public.booking_holds
    WHERE id = p_hold_id
      AND student_id = v_student_id
      AND status = 'active'
      AND expires_at > v_now
    FOR UPDATE;

    IF v_hold.id IS NULL THEN
      RAISE EXCEPTION 'slot_hold_expired';
    END IF;

    -- Verify hold matches the requested slot
    IF v_hold.mentor_id <> p_mentor_id
       OR v_hold.scheduled_time <> p_scheduled_start
       OR v_hold.duration_mins <> p_duration_mins THEN
      RAISE EXCEPTION 'slot_hold_mismatch';
    END IF;
  END IF;

  -- 6. Insert the session in payment_pending state
  INSERT INTO public.sessions (
    student_id, mentor_id, scheduled_time, duration_mins,
    status, payment_status, language, topic
  ) VALUES (
    v_student_id, p_mentor_id, p_scheduled_start, p_duration_mins,
    'payment_pending', 'pending', 'english', null
  )
  RETURNING id INTO v_booking_id;

  -- 7. Link the hold to this booking
  IF p_hold_id IS NOT NULL THEN
    UPDATE public.booking_holds
    SET booking_id = v_booking_id
    WHERE id = p_hold_id;
  END IF;

  -- 8. Create the payment record
  INSERT INTO payments (
    booking_id, student_id, mentor_id, amount, currency,
    status, payment_method
  ) VALUES (
    v_booking_id, v_student_id, p_mentor_id, p_amount, p_currency,
    'pending', 'qr'
  )
  RETURNING id INTO v_payment_id;

  -- 9. Notify admin that a booking is awaiting payment verification
  INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
  VALUES (v_booking_id, 'booking_created', 'New booking awaiting payment',
          'A student has created a booking and needs to complete payment.',
          'booking', v_booking_id);

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking_id,
    'payment_id', v_payment_id,
    'amount', p_amount,
    'currency', p_currency
  );
END;
$$;


ALTER FUNCTION "public"."create_payment_booking"("p_mentor_id" "uuid", "p_scheduled_start" timestamp with time zone, "p_amount" numeric, "p_duration_mins" integer, "p_hold_id" "uuid", "p_currency" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_qr_payment"("p_booking_id" "uuid", "p_amount" numeric, "p_currency" "text" DEFAULT 'INR'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_booking RECORD;
  v_student_id uuid := auth.uid();
  v_payment_id uuid;
BEGIN
  SELECT * INTO v_booking FROM sessions WHERE id = p_booking_id;
  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'booking_not_found';
  END IF;

  IF v_booking.student_id <> v_student_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_booking.status <> 'payment_pending' THEN
    RAISE EXCEPTION 'payment_not_pending';
  END IF;

  INSERT INTO payments (booking_id, student_id, mentor_id, amount, currency, status, payment_method)
  VALUES (p_booking_id, v_student_id, v_booking.mentor_id, p_amount, p_currency, 'pending', 'qr')
  RETURNING id INTO v_payment_id;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'amount', p_amount,
    'currency', p_currency
  );
END;
$$;


ALTER FUNCTION "public"."create_qr_payment"("p_booking_id" "uuid", "p_amount" numeric, "p_currency" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_reschedule_request"("p_booking_id" "uuid", "p_seeker_id" "uuid", "p_requested_start_time" timestamp with time zone, "p_requested_end_time" timestamp with time zone) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_booking public.bookings;
  v_gig public.gigs;
  v_existing public.reschedule_requests;
  v_hold public.slot_holds;
  v_request public.reschedule_requests;
  v_exception public.mentor_availability_exceptions;
  v_mentor_tz TEXT;
  v_local_start timestamp;
  v_local_end timestamp;
  v_local_date date;
  v_local_dow int;
  v_duration_minutes int;
  v_now timestamp with time zone;
BEGIN
  -- 1. Interval shape
  IF p_requested_start_time IS NULL OR p_requested_end_time IS NULL
     OR p_requested_start_time >= p_requested_end_time THEN
    RAISE EXCEPTION 'code: INVALID_INTERVAL, Slot start time must be earlier than end time';
  END IF;

  v_now := clock_timestamp();

  IF p_requested_start_time <= v_now THEN
    RAISE EXCEPTION 'code: PAST_SLOT_FORBIDDEN, Cannot request a slot that begins in the past';
  END IF;

  -- 2. Same 5-minute booking cutoff as an initial booking. Rescheduling is not
  --    a way to sneak past it.
  IF p_requested_start_time < v_now + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'code: BOOKING_CUTOFF_REACHED, This slot can no longer be booked because it starts in less than 5 minutes';
  END IF;

  -- 3. Ownership. A seeker may only request a reschedule of their own booking.
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: BOOKING_NOT_FOUND, Booking not found';
  END IF;

  IF v_booking.seeker_id <> p_seeker_id THEN
    RAISE EXCEPTION 'code: FORBIDDEN_NOT_BOOKING_OWNER, You are not authorized to reschedule this booking';
  END IF;

  -- 4. Only a live, pre-session booking is movable. CANCELLED, REJECTED,
  --    COMPLETED and the unpaid states are all out: a time change on an unpaid
  --    booking is a re-book, which goes through the normal gig flow.
  IF v_booking.status NOT IN ('MENTOR_PENDING', 'CONFIRMED') THEN
    RAISE EXCEPTION 'code: BOOKING_NOT_RESCHEDULABLE, This booking cannot be rescheduled because it is not an active confirmed session';
  END IF;

  -- 5. Lead time on the ORIGINAL slot, re-read under the mentor lock below.
  IF v_booking.start_time < v_now + public.reschedule_window_interval() THEN
    RAISE EXCEPTION 'code: RESCHEDULE_WINDOW_CLOSED, This session is too close to its start time to reschedule';
  END IF;

  -- 6. Serialize on the mentor row, exactly like the booking RPCs do.
  PERFORM 1 FROM public.profiles WHERE id = v_booking.mentor_id FOR UPDATE;

  -- 7. Re-read the clock and re-test both deadlines: this request may have
  --    waited behind another booking and crossed either boundary while queued.
  v_now := clock_timestamp();

  IF v_booking.start_time < v_now + public.reschedule_window_interval() THEN
    RAISE EXCEPTION 'code: RESCHEDULE_WINDOW_CLOSED, This session is too close to its start time to reschedule';
  END IF;

  IF p_requested_start_time < v_now + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'code: BOOKING_CUTOFF_REACHED, This slot can no longer be booked because it starts in less than 5 minutes';
  END IF;

  -- 8. The booking is only still movable if it is the row we validated.
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF v_booking.status NOT IN ('MENTOR_PENDING', 'CONFIRMED') THEN
    RAISE EXCEPTION 'code: BOOKING_NOT_RESCHEDULABLE, This booking is no longer in a reschedulable state';
  END IF;

  -- 9. At most one open request per booking.
  SELECT * INTO v_existing
  FROM public.reschedule_requests
  WHERE booking_id = p_booking_id AND status = 'PENDING';

  IF FOUND THEN
    RAISE EXCEPTION 'code: RESCHEDULE_REQUEST_PENDING, A reschedule request for this booking is already awaiting a mentor decision';
  END IF;

  -- 10. Duration is the BOOKING's own gig duration. This is the only place the
  --     gig is consulted, and only for its length: gig and segment are never
  --     allowed to influence the timeline.
  SELECT * INTO v_gig FROM public.gigs WHERE id = v_booking.gig_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: GIG_NOT_FOUND, The gig for this booking no longer exists';
  END IF;

  v_duration_minutes := ROUND(EXTRACT(EPOCH FROM (p_requested_end_time - p_requested_start_time)) / 60.0)::int;
  IF v_duration_minutes <> v_gig.duration_minutes THEN
    RAISE EXCEPTION 'code: DURATION_MISMATCH, Slot duration (%) must equal the gig duration (%)', v_duration_minutes, v_gig.duration_minutes;
  END IF;

  -- 11. Global availability: the mentor's own clock, recurring hours or the
  --     authoritative date exception. No gig, no segment.
  SELECT timezone INTO v_mentor_tz FROM public.profiles WHERE id = v_booking.mentor_id;
  v_mentor_tz := COALESCE(v_mentor_tz, 'Asia/Kolkata');

  v_local_start := p_requested_start_time AT TIME ZONE v_mentor_tz;
  v_local_end := p_requested_end_time AT TIME ZONE v_mentor_tz;
  v_local_date := v_local_start::date;
  v_local_dow := EXTRACT(DOW FROM v_local_start)::int;

  IF v_local_start::date <> v_local_end::date THEN
    RAISE EXCEPTION 'code: OUTSIDE_AVAILABILITY, Slot crosses the mentor local calendar day';
  END IF;

  SELECT * INTO v_exception
  FROM public.mentor_availability_exceptions
  WHERE mentor_id = v_booking.mentor_id
    AND exception_date = v_local_date;

  IF FOUND THEN
    IF NOT v_exception.is_available THEN
      RAISE EXCEPTION 'code: DATE_EXCEPTION_UNAVAILABLE, Mentor is marked unavailable on this date';
    END IF;

    IF v_exception.start_time IS NULL
       OR v_exception.end_time IS NULL
       OR v_local_start::time < v_exception.start_time
       OR v_local_end::time > v_exception.end_time THEN
      RAISE EXCEPTION 'code: OUTSIDE_EXCEPTION_HOURS, Slot falls outside the custom hours set for this date';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.mentor_availability a
      WHERE a.mentor_id = v_booking.mentor_id
        AND a.is_enabled
        AND a.day_of_week = v_local_dow
        AND a.start_time <= v_local_start::time
        AND a.end_time >= v_local_end::time
    ) THEN
      RAISE EXCEPTION 'code: OUTSIDE_AVAILABILITY, Slot falls outside the mentor current availability';
    END IF;
  END IF;

  -- 12. A booking for this mentor already occupies it, on any gig, in any
  --     segment. This booking's own row is excluded: its CURRENT time is being
  --     changed, not consumed.
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE mentor_id = v_booking.mentor_id
      AND id <> v_booking.id
      AND status NOT IN ('CANCELLED', 'REJECTED')
      AND tstzrange(start_time, end_time, '[)') && tstzrange(p_requested_start_time, p_requested_end_time, '[)')
  ) THEN
    RAISE EXCEPTION 'code: SLOT_ALREADY_BOOKED, Requested slot is already booked';
  END IF;

  -- 13. Somebody else already holds it, on any gig.
  IF EXISTS (
    SELECT 1 FROM public.slot_holds
    WHERE mentor_id = v_booking.mentor_id
      AND status = 'ACTIVE'
      AND expires_at > clock_timestamp()
      AND tstzrange(start_time, end_time, '[)') && tstzrange(p_requested_start_time, p_requested_end_time, '[)')
  ) THEN
    RAISE EXCEPTION 'code: SLOT_HELD_BY_OTHER, Requested slot is currently on hold by another seeker';
  END IF;

  -- 14. Reserve the requested slot. `no_overlapping_active_holds` makes this
  --     insert itself the concurrency control: if another seeker commits a hold
  --     for the same instant first, this statement fails and the whole
  --     transaction rolls back, so there is never a PENDING request without a
  --     hold behind it.
  INSERT INTO public.slot_holds (
    mentor_id, seeker_id, gig_id, start_time, end_time, status, expires_at, created_at
  ) VALUES (
    v_booking.mentor_id, v_booking.seeker_id, v_booking.gig_id,
    p_requested_start_time, p_requested_end_time, 'ACTIVE',
    v_now + public.reschedule_request_expiry_interval(), v_now
  )
  RETURNING * INTO v_hold;

  -- 15. Record the request. The original times are snapshotted here, so the
  --     mentor always compares against what the seeker actually saw.
  INSERT INTO public.reschedule_requests (
    booking_id, seeker_id, mentor_id,
    original_start_time, original_end_time,
    requested_start_time, requested_end_time,
    hold_id, status, seeker_requested_at, expires_at, created_at, updated_at
  ) VALUES (
    v_booking.id, v_booking.seeker_id, v_booking.mentor_id,
    v_booking.start_time, v_booking.end_time,
    p_requested_start_time, p_requested_end_time,
    v_hold.id, 'PENDING', v_now, v_now + public.reschedule_request_expiry_interval(), v_now, v_now
  )
  RETURNING * INTO v_request;

  -- 16. The booking is NOT modified. It stays exactly as it was until the
  --     mentor accepts, and its slot stays blocked to other seekers meanwhile.

  -- 17. Tell the mentor, with both times in the message.
  INSERT INTO public.notifications (
    user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, created_at
  ) VALUES (
    v_booking.mentor_id,
    'Reschedule Request',
    format(
      'A seeker asked to move booking %s from %s to %s. The original time stays confirmed until you decide.',
      v_booking.booking_code,
      to_char(v_booking.start_time AT TIME ZONE v_mentor_tz, 'DD Mon, HH12:MI AM'),
      to_char(p_requested_start_time AT TIME ZONE v_mentor_tz, 'DD Mon, HH12:MI AM')
    ),
    'BOOKING',
    'MENTOR_RESCHEDULE_REQUESTED',
    'booking',
    v_booking.id::text,
    format('/mentor/booking-detail?bookingId=%s', v_booking.id),
    FALSE,
    v_now
  );

  RETURN json_build_object(
    'success', true,
    'request', json_build_object(
      'id', v_request.id,
      'booking_id', v_request.booking_id,
      'seeker_id', v_request.seeker_id,
      'mentor_id', v_request.mentor_id,
      'original_start_time', v_request.original_start_time,
      'original_end_time', v_request.original_end_time,
      'requested_start_time', v_request.requested_start_time,
      'requested_end_time', v_request.requested_end_time,
      'status', v_request.status,
      'seeker_requested_at', v_request.seeker_requested_at,
      'mentor_responded_at', v_request.mentor_responded_at,
      'mentor_response', v_request.mentor_response,
      'rejection_reason', v_request.rejection_reason,
      'expires_at', v_request.expires_at,
      'created_at', v_request.created_at,
      'updated_at', v_request.updated_at
    ),
    'hold_expires_at', v_hold.expires_at
  );
END;
$$;


ALTER FUNCTION "public"."create_reschedule_request"("p_booking_id" "uuid", "p_seeker_id" "uuid", "p_requested_start_time" timestamp with time zone, "p_requested_end_time" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_slot_hold"("p_mentor_id" "uuid", "p_scheduled_start" timestamp with time zone, "p_duration_mins" integer, "p_hold_minutes" integer DEFAULT 15) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_hold_id uuid;
  v_expires timestamptz;
  v_conflict boolean;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- Atomic availability re-check: a mentor cannot be double-booked.
  select exists (
    select 1 from public.sessions s
    where s.mentor_id = p_mentor_id
      and s.status not in ('cancelled','rejected')
      and tstzrange(p_scheduled_start, p_scheduled_start + (p_duration_mins || ' minutes')::interval)
        && tstzrange(s.scheduled_time, s.scheduled_time + (s.duration_mins || ' minutes')::interval)
    union all
    select 1 from public.booking_holds h
    where h.mentor_id = p_mentor_id
      and h.status = 'active'
      and h.expires_at > now()
      and tstzrange(p_scheduled_start, p_scheduled_start + (p_duration_mins || ' minutes')::interval)
        && tstzrange(h.scheduled_time, h.scheduled_time + (h.duration_mins || ' minutes')::interval)
  ) into v_conflict;

  if v_conflict then
    raise exception 'slot_hold_conflict';
  end if;

  -- Reject past slots.
  if p_scheduled_start <= now() then
    raise exception 'slot_hold_expired';
  end if;

  v_expires := now() + (p_hold_minutes || ' minutes')::interval;

  insert into public.booking_holds (mentor_id, student_id, scheduled_time, duration_mins, status, expires_at)
  values (p_mentor_id, auth.uid(), p_scheduled_start, p_duration_mins, 'active', v_expires)
  returning id into v_hold_id;

  return jsonb_build_object(
    'id', v_hold_id,
    'mentor_id', p_mentor_id,
    'student_id', auth.uid(),
    'scheduled_time', p_scheduled_start,
    'duration_mins', p_duration_mins,
    'status', 'active',
    'expires_at', v_expires
  );
end;
$$;


ALTER FUNCTION "public"."create_slot_hold"("p_mentor_id" "uuid", "p_scheduled_start" timestamp with time zone, "p_duration_mins" integer, "p_hold_minutes" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_support_ticket"("p_requester_id" "uuid", "p_category" "text", "p_subject" "text", "p_message" "text", "p_booking_code" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_role TEXT;
  v_booking public.bookings;
  v_payment public.payments;
  v_ticket public.support_tickets;
  v_message public.support_messages;
  v_code TEXT;
  v_subject TEXT;
  v_message_text TEXT;
  v_id UUID;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- ---- 1. Identity, re-derived from user_roles ---------------------------
  IF p_requester_id IS NULL
     OR NOT public.has_role(p_requester_id, 'admin')
        AND NOT public.has_role(p_requester_id, 'mentor')
        AND NOT public.has_role(p_requester_id, 'seeker') THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, You are not authorized to raise a support ticket';
  END IF;

  v_role := CASE
    WHEN public.has_role(p_requester_id, 'admin')  THEN 'admin'
    WHEN public.has_role(p_requester_id, 'mentor') THEN 'mentor'
    ELSE 'seeker'
  END;

  -- A live session must belong to the same account. A service-role-only caller
  -- (auth.uid() IS NULL) is allowed through, matching every other RPC here.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_requester_id THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, You are not authorized to raise a support ticket';
  END IF;

  -- ---- 2. Category is constrained by the caller's REAL role ---------------
  IF NOT (
    (v_role = 'seeker'  AND p_category IN ('BOOKING','PAYMENT','SESSION','MENTOR','ACCOUNT','TECHNICAL','OTHER')) OR
    (v_role = 'mentor'  AND p_category IN ('BOOKING','AVAILABILITY','PAYMENT','SESSION','PROFILE','TECHNICAL','OTHER')) OR
    (v_role = 'admin'   AND p_category IN ('USER','MENTOR','BOOKING','PAYMENT','SYSTEM','TECHNICAL','OTHER'))
  ) THEN
    RAISE EXCEPTION 'code: CATEGORY_NOT_ALLOWED, Choose a category available for your account type';
  END IF;

  v_subject := NULLIF(btrim(COALESCE(p_subject, '')), '');
  IF v_subject IS NULL OR length(v_subject) < 4 OR length(v_subject) > 140 THEN
    RAISE EXCEPTION 'code: SUBJECT_INVALID, The subject must be between 4 and 140 characters';
  END IF;

  v_message_text := NULLIF(btrim(COALESCE(p_message, '')), '');
  IF v_message_text IS NULL OR length(v_message_text) < 20 OR length(v_message_text) > 4000 THEN
    RAISE EXCEPTION 'code: MESSAGE_INVALID, Describe the issue in between 20 and 4000 characters';
  END IF;

  -- ---- 3. Booking linkage, resolved and ownership-checked here ------------
  IF NULLIF(btrim(COALESCE(p_booking_code, '')), '') IS NOT NULL THEN
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE upper(booking_code) = upper(btrim(p_booking_code));

    IF NOT FOUND THEN
      RAISE EXCEPTION 'code: BOOKING_NOT_FOUND, No booking matches that reference';
    END IF;

    -- A seeker links only their own booking; a mentor only a booking they are on.
    -- An admin may link any booking, which is what the admin console needs.
    IF v_role = 'seeker' AND v_booking.seeker_id <> p_requester_id THEN
      RAISE EXCEPTION 'code: FORBIDDEN_NOT_BOOKING_PARTICIPANT, That booking reference is not yours';
    END IF;
    IF v_role = 'mentor' AND v_booking.mentor_id <> p_requester_id THEN
      RAISE EXCEPTION 'code: FORBIDDEN_NOT_BOOKING_PARTICIPANT, That booking reference is not yours';
    END IF;

    -- payment_id is DERIVED here. It is not a parameter, so it cannot be set
    -- to an arbitrary payment.
    SELECT id INTO v_payment FROM public.payments WHERE booking_id = v_booking.id LIMIT 1;
  END IF;

  -- ---- 4. The ticket -----------------------------------------------------
  v_code := public.next_support_ticket_code();

  INSERT INTO public.support_tickets (
    ticket_code, requester_id, requester_role, category, subject,
    status, priority, booking_id, payment_id, created_at, updated_at, last_message_at
  ) VALUES (
    v_code, p_requester_id, v_role, p_category, v_subject,
    'OPEN', 'NORMAL', v_booking.id, v_payment.id, v_now, v_now, v_now
  )
  RETURNING * INTO v_ticket;

  -- ---- 5. The opening message is a real conversation row -----------------
  INSERT INTO public.support_messages (
    ticket_id, sender_id, sender_role, message, is_internal, created_at, updated_at
  ) VALUES (
    v_ticket.id, p_requester_id, v_role, v_message_text, FALSE, v_now, v_now
  )
  RETURNING * INTO v_message;

  INSERT INTO public.support_audit_events (ticket_id, actor_id, event_type, metadata, created_at)
  VALUES (
    v_ticket.id, p_requester_id, 'TICKET_CREATED',
    jsonb_build_object('category', p_category, 'priority', 'NORMAL', 'bookingCode', v_booking.booking_code),
    v_now
  );
  INSERT INTO public.support_audit_events (ticket_id, actor_id, event_type, metadata, created_at)
  VALUES (
    v_ticket.id, p_requester_id, 'TICKET_MESSAGE_SENT', jsonb_build_object('messageId', v_message.id), v_now
  );

  -- ---- 6. Tell the admin queue ------------------------------------------
  -- Per-recipient rows, because `notifications.user_id` is NOT NULL.
  FOR v_id IN
    SELECT u.user_id FROM public.user_roles u WHERE u.role = 'admin'
  LOOP
    INSERT INTO public.notifications (
      user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, metadata, created_at
    ) VALUES (
      v_id,
      'New support ticket ' || v_code,
      'A new ' || lower(v_role) || ' support ticket needs attention: ' || v_subject,
      'SYSTEM',
      'SUPPORT_TICKET_CREATED',
      'support_ticket',
      v_code,
      format('/admin/support?ticketCode=%s', v_code),
      FALSE,
      jsonb_build_object('ticketCode', v_code, 'category', p_category, 'priority', 'NORMAL', 'bookingCode', v_booking.booking_code),
      v_now
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'ticket', jsonb_build_object(
      'id', v_ticket.id,
      'ticketCode', v_ticket.ticket_code,
      'requesterId', v_ticket.requester_id,
      'requesterRole', v_ticket.requester_role,
      'category', v_ticket.category,
      'subject', v_ticket.subject,
      'status', v_ticket.status,
      'priority', v_ticket.priority,
      'bookingId', v_ticket.booking_id,
      'paymentId', v_ticket.payment_id,
      'assignedAdminId', v_ticket.assigned_admin_id,
      'resolution', v_ticket.resolution,
      'resolvedAt', v_ticket.resolved_at,
      'createdAt', v_ticket.created_at,
      'updatedAt', v_ticket.updated_at,
      'lastMessageAt', v_ticket.last_message_at
    ),
    'message', jsonb_build_object(
      'id', v_message.id,
      'senderId', v_message.sender_id,
      'senderRole', v_message.sender_role,
      'message', v_message.message,
      'isInternal', v_message.is_internal,
      'createdAt', v_message.created_at
    )
  );
END;
$$;


ALTER FUNCTION "public"."create_support_ticket"("p_requester_id" "uuid", "p_category" "text", "p_subject" "text", "p_message" "text", "p_booking_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_role"() RETURNS "public"."app_role"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_role app_role;
BEGIN
  SELECT role INTO v_role
  FROM public.user_roles
  WHERE user_id = auth.uid()
  ORDER BY
    CASE role
      WHEN 'admin'            THEN 0
      WHEN 'mentor'           THEN 1
      WHEN 'mentor_pending'   THEN 2
      ELSE 3
    END
  LIMIT 1;
  RETURN v_role;
END;
$$;


ALTER FUNCTION "public"."current_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_gig_topic_segment_ownership"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_gig_segment UUID;
  v_topic_segment UUID;
BEGIN
  SELECT segment_id INTO v_gig_segment FROM public.gigs WHERE id = NEW.gig_id;
  SELECT segment_id INTO v_topic_segment FROM public.segment_topics WHERE id = NEW.topic_id;

  -- The foreign keys already prevent this; the explicit guard produces a
  -- clean error instead of a NULL comparison that would silently pass.
  IF v_gig_segment IS NULL OR v_topic_segment IS NULL THEN
    RAISE EXCEPTION 'gig_topics: gig or topic does not exist'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_gig_segment <> v_topic_segment THEN
    RAISE EXCEPTION 'Topic % belongs to a different segment than gig %', NEW.topic_id, NEW.gig_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_gig_topic_segment_ownership"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_stale_holds"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  expired_count integer := 0;
BEGIN
  -- Expire ACTIVE holds where expires_at <= NOW()
  UPDATE public.slot_holds
  SET status = 'EXPIRED'
  WHERE status = 'ACTIVE'
    AND expires_at <= NOW();

  GET DIAGNOSTICS expired_count = ROW_COUNT;

  -- Cancel PAYMENT_PENDING bookings linked to now-expired holds
  UPDATE public.bookings
  SET status = 'CANCELLED',
      cancellation_reason = 'Payment window expired (slot hold elapsed without payment proof)',
      updated_at = NOW()
  WHERE status = 'PAYMENT_PENDING'
    AND hold_id IN (
      SELECT id FROM public.slot_holds WHERE status = 'EXPIRED'
    );

  -- Also expire holds that are ACTIVE but whose booking is no longer PAYMENT_PENDING
  -- (e.g., payment was submitted and booking advanced to PENDING_VERIFICATION)
  -- These should be CONVERTED or RELEASED.
  --
  -- A hold backing a PENDING reschedule request has no PAYMENT_PENDING booking
  -- by design, and the booking it belongs to is already CONFIRMED. It is
  -- deliberately skipped here and is governed by `expires_at` on the request
  -- instead, swept by `expire_stale_reschedule_requests()`.
  UPDATE public.slot_holds
  SET status = 'RELEASED'
  WHERE status = 'ACTIVE'
    AND id IN (
      SELECT hold_id FROM public.bookings
      WHERE hold_id = slot_holds.id
        AND status NOT IN ('PAYMENT_PENDING')
    )
    AND id NOT IN (
      SELECT hold_id FROM public.reschedule_requests
      WHERE hold_id IS NOT NULL
        AND status = 'PENDING'
    );

  RETURN expired_count;
END;
$$;


ALTER FUNCTION "public"."expire_stale_holds"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_stale_reschedule_requests"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  expired_count integer := 0;
BEGIN
  -- Release the slot reservations first so the freed time is bookable even if
  -- the request update below is somehow skipped.
  UPDATE public.slot_holds h
  SET status = 'EXPIRED'
  WHERE h.status = 'ACTIVE'
    AND h.id IN (
      SELECT rr.hold_id
      FROM public.reschedule_requests rr
      WHERE rr.status = 'PENDING'
        AND rr.hold_id IS NOT NULL
        AND rr.expires_at <= NOW()
    );

  UPDATE public.reschedule_requests
  SET status = 'EXPIRED',
      mentor_response = NULL,
      mentor_responded_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE status = 'PENDING'
    AND expires_at <= NOW();

  GET DIAGNOSTICS expired_count = ROW_COUNT;

  RETURN expired_count;
END;
$$;


ALTER FUNCTION "public"."expire_stale_reschedule_requests"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_admin_session_view"("p_limit" integer DEFAULT 100, "p_offset" integer DEFAULT 0, "p_status" "text" DEFAULT NULL::"text") RETURNS TABLE("session_id" "uuid", "mentor_id" "uuid", "student_id" "uuid", "scheduled_time" timestamp with time zone, "duration_mins" integer, "status" "text", "payment_status" "text", "meeting_link" "text", "meeting_link_added_at" timestamp with time zone, "meeting_link_deadline" timestamp with time zone, "meeting_link_overdue" boolean, "confirmed_at" timestamp with time zone, "completed_at" timestamp with time zone, "mentor_name" "text", "student_name" "text", "segment_name" "text", "gig_title" "text", "gig_price" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT
    s.id as session_id,
    s.mentor_id,
    s.student_id,
    s.scheduled_time,
    s.duration_mins,
    s.status,
    s.payment_status,
    s.meeting_link,
    s.meeting_link_added_at,
    s.meeting_link_deadline,
    s.meeting_link_overdue,
    s.confirmed_at,
    s.completed_at,
    pm.full_name as mentor_name,
    ps.full_name as student_name,
    seg.name as segment_name,
    g.title as gig_title,
    g.price as gig_price
  FROM sessions s
  LEFT JOIN profiles pm ON pm.id = s.mentor_id
  LEFT JOIN profiles ps ON ps.id = s.student_id
  LEFT JOIN segments seg ON seg.id = s.category_id
  LEFT JOIN gigs g ON g.mentor_id = s.mentor_id AND g.segment_id = s.category_id
  WHERE (p_status IS NULL OR s.status = p_status)
  ORDER BY s.scheduled_time DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;


ALTER FUNCTION "public"."get_admin_session_view"("p_limit" integer, "p_offset" integer, "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_all_booking_rules"() RETURNS TABLE("key" "text", "value" "text", "description" "text", "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return query
  select br.key, br.value, br.description, br.updated_at
  from public.booking_rules br
  order by br.key;
end;
$$;


ALTER FUNCTION "public"."get_all_booking_rules"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_bookable_slots"("p_mentor_id" "uuid", "p_date" "date", "p_student_timezone" "text" DEFAULT 'UTC'::"text") RETURNS TABLE("slot_start" timestamp with time zone, "slot_end" timestamp with time zone, "duration_mins" integer, "gig_id" "uuid", "segment_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_mentor_tz text;
  v_gig_record RECORD;
  v_gigs RECORD;
  v_slot RECORD;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_day_of_week text;
  v_duration integer;
  v_exception RECORD;
  v_has_booking_conflict boolean;
  v_has_hold_conflict boolean;
  v_now timestamptz := now();
  v_min_notice interval;
  v_max_window interval;
  v_gig_id uuid;
  v_segment_id uuid;
BEGIN
  -- Get mentor timezone
  SELECT timezone INTO v_mentor_tz FROM mentor_profiles WHERE user_id = p_mentor_id;
  IF v_mentor_tz IS NULL THEN
    v_mentor_tz := 'UTC';
  END IF;

  -- Get booking rules
  SELECT COALESCE(value::int, 30) * interval '1 minute' INTO v_min_notice
  FROM booking_rules WHERE key = 'minimum_booking_notice_minutes';
  
  SELECT COALESCE(value::int, 30) * interval '1 day' INTO v_max_window
  FROM booking_rules WHERE key = 'maximum_booking_days';

  -- Get day of week in mentor's timezone
  v_day_of_week := lower(to_char(p_date AT TIME ZONE v_mentor_tz, 'Day'));

  -- Get all active gigs for this mentor with their segments
  FOR v_gig_record IN
    SELECT g.id as gig_id, g.duration_mins, g.segment_id, g.is_active
    FROM gigs g
    WHERE g.mentor_id = p_mentor_id
      AND g.is_active = true
      AND g.is_archived = false
  LOOP
    v_duration := v_gig_record.duration_mins;
    v_gig_id := v_gig_record.gig_id;
    v_segment_id := v_gig_record.segment_id;

    -- Get recurring availability for this day
    FOR v_slot IN
      SELECT start_time, end_time
      FROM availability_slots
      WHERE mentor_id = p_mentor_id
        AND day_of_week = v_day_of_week
        AND is_available = true
    LOOP
      -- Check date-specific exception (overrides recurring)
      v_exception := NULL;
      SELECT * INTO v_exception
      FROM mentor_availability_exceptions
      WHERE mentor_id = p_mentor_id
        AND exception_date = p_date
      LIMIT 1;

      IF v_exception IS NOT NULL AND v_exception.is_unavailable THEN
        -- Mentor is completely unavailable this date
        CONTINUE;
      ELSIF v_exception IS NOT NULL AND v_exception.start_time IS NOT NULL THEN
        -- Exception defines custom window for this date
        v_slot_start := (p_date + v_exception.start_time) AT TIME ZONE v_mentor_tz;
        v_slot_end := (p_date + v_exception.end_time) AT TIME ZONE v_mentor_tz;
      ELSE
        -- Use recurring availability
        v_slot_start := (p_date + v_slot.start_time) AT TIME ZONE v_mentor_tz;
        v_slot_end := (p_date + v_slot.end_time) AT TIME ZONE v_mentor_tz;
      END IF;

      -- Generate slots within the availability window
      WHILE v_slot_start + (v_duration || ' minutes')::interval <= v_slot_end LOOP
        -- Check past slots (server time)
        IF v_slot_start <= v_now THEN
          v_slot_start := v_slot_start + (v_duration || ' minutes')::interval;
          CONTINUE;
        END IF;

        -- Check minimum notice
        IF v_slot_start < v_now + v_min_notice THEN
          v_slot_start := v_slot_start + (v_duration || ' minutes')::interval;
          CONTINUE;
        END IF;

        -- Check maximum booking window
        IF v_slot_start > v_now + v_max_window THEN
          EXIT;
        END IF;

        -- Check global mentor conflict (bookings)
        SELECT EXISTS(
          SELECT 1 FROM sessions s
          WHERE s.mentor_id = p_mentor_id
            AND s.status NOT IN ('cancelled', 'rejected')
            AND tstzrange(v_slot_start, v_slot_start + (v_duration || ' minutes')::interval)
              && tstzrange(s.scheduled_time, s.scheduled_time + (s.duration_mins || ' minutes')::interval)
        ) INTO v_has_booking_conflict;

        IF v_has_booking_conflict THEN
          v_slot_start := v_slot_start + (v_duration || ' minutes')::interval;
          CONTINUE;
        END IF;

        -- Check active holds
        SELECT EXISTS(
          SELECT 1 FROM booking_holds h
          WHERE h.mentor_id = p_mentor_id
            AND h.status = 'active'
            AND h.expires_at > v_now
            AND tstzrange(v_slot_start, v_slot_start + (v_duration || ' minutes')::interval)
              && tstzrange(h.scheduled_time, h.scheduled_time + (h.duration_mins || ' minutes')::interval)
        ) INTO v_has_hold_conflict;

        IF v_has_hold_conflict THEN
          v_slot_start := v_slot_start + (v_duration || ' minutes')::interval;
          CONTINUE;
        END IF;

        -- Return valid slot
        RETURN QUERY SELECT
          v_slot_start as slot_start,
          v_slot_start + (v_duration || ' minutes')::interval as slot_end,
          v_duration as duration_mins,
          v_gig_id as gig_id,
          v_segment_id as segment_id;

        v_slot_start := v_slot_start + (v_duration || ' minutes')::interval;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."get_bookable_slots"("p_mentor_id" "uuid", "p_date" "date", "p_student_timezone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_booking_rule"("p_key" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_value text;
begin
  select value into v_value
  from public.booking_rules
  where key = p_key;

  if v_value is null then
    case p_key
      when 'minimum_booking_notice_minutes' then v_value := '30';
      when 'maximum_booking_days' then v_value := '30';
      when 'slot_hold_minutes' then v_value := '10';
      when 'cancellation_window_minutes' then v_value := '60';
      when 'session_duration_minutes' then v_value := '30';
      when 'same_day_booking_enabled' then v_value := 'true';
      else v_value := '';
    end case;
  end if;

  return v_value;
end;
$$;


ALTER FUNCTION "public"."get_booking_rule"("p_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_discoverable_mentors"("p_segment_id" "uuid", "p_date" "date", "p_student_timezone" "text" DEFAULT 'UTC'::"text") RETURNS TABLE("mentor_id" "uuid", "headline" "text", "bio" "text", "rating_avg" numeric, "total_reviews" integer, "total_students" integer, "languages_taught" "text"[], "years_experience" integer, "is_verified" boolean, "timezone" "text", "avatar_url" "text", "full_name" "text", "gig_id" "uuid", "gig_title" "text", "gig_duration" integer, "gig_price" numeric, "gig_currency" "text", "earliest_slot" timestamp with time zone, "total_slots" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_mentor RECORD;
  v_slot_count integer;
  v_earliest timestamptz;
BEGIN
  FOR v_mentor IN
    SELECT mp.user_id, mp.headline, mp.bio, mp.rating_avg, mp.total_reviews,
           mp.total_students, mp.languages_taught, mp.years_experience,
           mp.is_verified, mp.timezone,
           p.avatar_url, p.full_name
    FROM mentor_profiles mp
    JOIN profiles p ON p.id = mp.user_id
    WHERE mp.is_active = true
      AND mp.is_verified = true
      AND EXISTS (
        SELECT 1 FROM mentor_segments ms
        WHERE ms.mentor_id = mp.user_id
          AND ms.segment_id = p_segment_id
      )
      AND EXISTS (
        SELECT 1 FROM gigs g
        WHERE g.mentor_id = mp.user_id
          AND g.segment_id = p_segment_id
          AND g.is_active = true
          AND g.is_archived = false
      )
  LOOP
    -- Get slots for this mentor
    SELECT count(*), min(slot_start) INTO v_slot_count, v_earliest
    FROM public.get_bookable_slots(v_mentor.user_id, p_date);
    
    IF v_slot_count > 0 THEN
      -- Get gig info
      RETURN QUERY SELECT
        v_mentor.user_id as mentor_id,
        v_mentor.headline,
        v_mentor.bio,
        v_mentor.rating_avg,
        v_mentor.total_reviews,
        v_mentor.total_students,
        v_mentor.languages_taught,
        v_mentor.years_experience,
        v_mentor.is_verified,
        v_mentor.timezone,
        v_mentor.avatar_url,
        v_mentor.full_name,
        g.id as gig_id,
        g.title as gig_title,
        g.duration_mins as gig_duration,
        g.price as gig_price,
        g.currency as gig_currency,
        v_earliest as earliest_slot,
        v_slot_count as total_slots
      FROM gigs g
      WHERE g.mentor_id = v_mentor.user_id
        AND g.segment_id = p_segment_id
        AND g.is_active = true
        AND g.is_archived = false
      LIMIT 1;
    END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."get_discoverable_mentors"("p_segment_id" "uuid", "p_date" "date", "p_student_timezone" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mentor_document_types" (
    "code" "text" NOT NULL,
    "label" "text" NOT NULL,
    "description" "text",
    "is_required" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."mentor_document_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mentor_verification_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "application_id" "uuid" NOT NULL,
    "document_type" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "original_filename" "text" NOT NULL,
    "mime_type" "text" NOT NULL,
    "size_bytes" bigint NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "admin_note" "text",
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mentor_verification_documents_size_bytes_check" CHECK ((("size_bytes" > 0) AND ("size_bytes" <= 5242880))),
    CONSTRAINT "mentor_verification_documents_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."mentor_verification_documents" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_mentor_onboarding_status"() RETURNS TABLE("application" "public"."mentor_applications", "documents" "public"."mentor_verification_documents"[], "required_types" "public"."mentor_document_types"[])
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_app   public.mentor_applications;
  v_docs  public.mentor_verification_documents[];
  v_types public.mentor_document_types[];
BEGIN
  SELECT * INTO v_app
  FROM public.mentor_applications
  WHERE user_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT 1;

  v_types := ARRAY(
    SELECT t FROM public.mentor_document_types t
    WHERE t.is_active = TRUE
    ORDER BY t.sort_order
  );

  -- No application yet: return an empty state plus the required document types.
  IF v_app.id IS NULL THEN
    RETURN QUERY SELECT
      NULL::public.mentor_applications,
      ARRAY[]::public.mentor_verification_documents[],
      COALESCE(v_types, ARRAY[]::public.mentor_document_types[]);
    RETURN;
  END IF;

  v_docs := ARRAY(
    SELECT d FROM public.mentor_verification_documents d
    WHERE d.application_id = v_app.id
  );

  RETURN QUERY SELECT
    v_app,
    COALESCE(v_docs, ARRAY[]::public.mentor_verification_documents[]),
    COALESCE(v_types, ARRAY[]::public.mentor_document_types[]);
END;
$$;


ALTER FUNCTION "public"."get_mentor_onboarding_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_mentor_pending_bookings"("p_mentor_id" "uuid" DEFAULT NULL::"uuid", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS TABLE("booking_id" "uuid", "student_id" "uuid", "mentor_id" "uuid", "scheduled_time" timestamp with time zone, "duration_mins" integer, "status" "text", "payment_status" "text", "meeting_link" "text", "meeting_link_added_at" timestamp with time zone, "meeting_link_deadline" timestamp with time zone, "meeting_link_overdue" boolean, "confirmed_at" timestamp with time zone, "completed_at" timestamp with time zone, "category_id" "uuid", "student_name" "text", "student_email" "text", "student_avatar_url" "text", "segment_name" "text", "gig_title" "text", "gig_price" numeric, "gig_currency" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_mentor uuid := COALESCE(p_mentor_id, auth.uid());
BEGIN
  RETURN QUERY
  SELECT
    s.id as booking_id,
    s.student_id,
    s.mentor_id,
    s.scheduled_time,
    s.duration_mins,
    s.status,
    s.payment_status,
    s.meeting_link,
    s.meeting_link_added_at,
    s.meeting_link_deadline,
    s.meeting_link_overdue,
    s.confirmed_at,
    s.completed_at,
    s.category_id,
    ps.full_name as student_name,
    ps.email as student_email,
    ps.avatar_url as student_avatar_url,
    seg.name as segment_name,
    g.title as gig_title,
    g.price as gig_price,
    g.currency as gig_currency
  FROM sessions s
  LEFT JOIN profiles ps ON ps.id = s.student_id
  LEFT JOIN segments seg ON seg.id = s.category_id
  LEFT JOIN gigs g ON g.mentor_id = s.mentor_id AND g.segment_id = s.category_id
  WHERE s.mentor_id = v_mentor
    AND s.status = 'mentor_pending'
    AND s.scheduled_time > now()
  ORDER BY s.scheduled_time ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;


ALTER FUNCTION "public"."get_mentor_pending_bookings"("p_mentor_id" "uuid", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_reschedule_request_for_booking"("p_booking_id" "uuid", "p_caller_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_booking public.bookings;
  v_request public.reschedule_requests;
  v_pending public.reschedule_requests;
  v_is_admin boolean;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: BOOKING_NOT_FOUND, Booking not found';
  END IF;

  v_is_admin := public.is_admin();

  IF NOT (v_is_admin OR v_booking.seeker_id = p_caller_id OR v_booking.mentor_id = p_caller_id) THEN
    RAISE EXCEPTION 'code: FORBIDDEN_NOT_BOOKING_OWNER, You are not authorized to view this booking';
  END IF;

  -- The open request, if any, wins over history: the mentor's decision UI must
  -- never be pointed at a stale row while a newer one is waiting.
  SELECT * INTO v_pending
  FROM public.reschedule_requests
  WHERE booking_id = p_booking_id AND status = 'PENDING'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_pending.id IS NOT NULL THEN
    v_request := v_pending;
  ELSE
    SELECT * INTO v_request
    FROM public.reschedule_requests
    WHERE booking_id = p_booking_id
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  IF v_request.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN json_build_object(
    'id', v_request.id,
    'booking_id', v_request.booking_id,
    'seeker_id', v_request.seeker_id,
    'mentor_id', v_request.mentor_id,
    'original_start_time', v_request.original_start_time,
    'original_end_time', v_request.original_end_time,
    'requested_start_time', v_request.requested_start_time,
    'requested_end_time', v_request.requested_end_time,
    'status', v_request.status,
    'seeker_requested_at', v_request.seeker_requested_at,
    'mentor_responded_at', v_request.mentor_responded_at,
    'mentor_response', v_request.mentor_response,
    'rejection_reason', v_request.rejection_reason,
    'expires_at', v_request.expires_at,
    'created_at', v_request.created_at,
    'updated_at', v_request.updated_at
  );
END;
$$;


ALTER FUNCTION "public"."get_reschedule_request_for_booking"("p_booking_id" "uuid", "p_caller_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_session_access"("p_booking_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_booking   public.bookings;
  v_state     text;
  v_now       timestamptz := now();
  v_sec_t5    integer;
  v_sec_start integer;
  v_sec_end   integer;
BEGIN
  SELECT * INTO v_booking FROM public.bookings
   WHERE id = p_booking_id
     AND (seeker_id = auth.uid() OR mentor_id = auth.uid() OR public.is_admin());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found (code: BOOKING_NOT_FOUND)';
  END IF;

  v_state := public.reconcile_expired_sessions(p_booking_id);
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;

  -- Fail closed: an unresolvable state must deny, never fall through to a
  -- branch that would hand out a meeting URL.
  IF v_state IS NULL OR v_state NOT IN
       ('SCHEDULED', 'ACCESS_OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') THEN
    RETURN jsonb_build_object(
      'allowed',      false,
      'reason',       'SESSION_STATE_UNAVAILABLE',
      'state',        'COMPLETED',
      'can_join',     false,
      'access_state', 'COMPLETED',
      'server_now',   v_now
    );
  END IF;

  v_sec_t5    := GREATEST(0, CEIL(EXTRACT(EPOCH FROM ((v_booking.start_time - interval '5 minutes') - v_now)))::int);
  v_sec_start := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_booking.start_time - v_now)))::int);
  v_sec_end   := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_booking.end_time   - v_now)))::int);

  IF v_state IN ('COMPLETED', 'CANCELLED') THEN
    RETURN jsonb_build_object(
      'allowed',         false,
      'reason',          CASE WHEN v_state = 'CANCELLED' THEN 'SESSION_CANCELLED' ELSE 'SESSION_ENDED' END,
      'state',           v_state,
      'can_join',        false,
      'access_state',    v_state,
      'server_now',      v_now,
      'start_time',      v_booking.start_time,
      'end_time',        v_booking.end_time,
      'actual_ended_at', v_booking.actual_ended_at,
      'booking_status',  v_booking.status,
      'seconds_until_t5',     v_sec_t5,
      'seconds_until_start',  v_sec_start,
      'seconds_until_end',    v_sec_end
    );
  END IF;

  IF v_state = 'SCHEDULED' THEN
    RETURN jsonb_build_object(
      'allowed',         false,
      'reason',          'TOO_EARLY',
      'state',           v_state,
      'can_join',        false,
      'access_state',    'BEFORE_T5',
      'server_now',      v_now,
      'start_time',      v_booking.start_time,
      'end_time',        v_booking.end_time,
      'booking_status',  v_booking.status,
      'seconds_until_t5',     v_sec_t5,
      'seconds_until_start',  v_sec_start,
      'seconds_until_end',    v_sec_end
    );
  END IF;

  IF v_booking.meeting_url IS NULL THEN
    RETURN jsonb_build_object(
      'allowed',         false,
      'reason',          'MEETING_LINK_NOT_SET',
      'state',           v_state,
      'can_join',        false,
      'access_state',    v_state,
      'server_now',      v_now,
      'start_time',      v_booking.start_time,
      'end_time',        v_booking.end_time,
      'booking_status',  v_booking.status
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed',         true,
    'reason',          'OK',
    'state',           v_state,
    'can_join',        true,
    'access_state',    CASE WHEN v_state = 'ACCESS_OPEN' THEN 'T5_WINDOW' ELSE 'IN_PROGRESS' END,
    'meeting_url',     v_booking.meeting_url,
    'server_now',      v_now,
    'start_time',      v_booking.start_time,
    'end_time',        v_booking.end_time,
    'booking_status',  v_booking.status,
    'seconds_until_end', v_sec_end
  );
END;
$$;


ALTER FUNCTION "public"."get_session_access"("p_booking_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_session_access"("p_booking_id" "uuid") IS 'Authoritative session access. Reconciles expiry first, then releases meeting_url only inside [start-5m, end). The URL is absent from every denying response.';



CREATE OR REPLACE FUNCTION "public"."get_subscription_summary"("p_user_id" "uuid") RETURNS TABLE("subscription_id" "uuid", "plan_name" "text", "status" "text", "total_slots" integer, "used_slots" integer, "remaining_slots" integer, "bonus_slots" integer, "available_slots" integer, "expires_at" timestamp with time zone, "activated_at" timestamp with time zone, "days_until_expiry" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_sub public.student_subscriptions;
begin
  select s.* into v_sub
  from public.student_subscriptions s
  where s.user_id = p_user_id
    and s.status = 'active'
  order by s.created_at desc
  limit 1;

  if v_sub.id is null then
    return;
  end if;

  return query
  select
    v_sub.id,
    p.name,
    v_sub.status,
    v_sub.total_session_slots,
    v_sub.used_session_slots,
    v_sub.current_session_slots,
    coalesce(v_sub.bonus_slots, 0),
    v_sub.current_session_slots + coalesce(v_sub.bonus_slots, 0),
    v_sub.expires_at,
    v_sub.activated_at,
    case
      when v_sub.expires_at is null then null
      else extract(day from (v_sub.expires_at - now()))::integer
    end
  from public.subscription_plans p
  where p.id = v_sub.plan_id;
end;
$$;


ALTER FUNCTION "public"."get_subscription_summary"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_support_ticket"("p_ticket_code" "text", "p_caller_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_ticket public.support_tickets;
  v_is_admin boolean;
  -- Two scalars, not `public.profiles`. Selecting a couple of columns INTO a
  -- composite variable makes Postgres fill that variable's attributes
  -- positionally, so `full_name` lands in `profiles.id` (a uuid) and the cast
  -- fails on every ticket read with `22P02: invalid input syntax for type uuid`.
  -- Found against a live database; no source-level check can see it. Separate
  -- text variables cannot drift that way.
  v_requester_name TEXT;
  v_requester_email TEXT;
  v_booking jsonb;
  v_payment jsonb;
  v_messages jsonb;
  v_attachments jsonb;
  v_audit jsonb;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  SELECT * INTO v_ticket
  FROM public.support_tickets
  WHERE ticket_code = upper(btrim(p_ticket_code));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: TICKET_NOT_FOUND, Support ticket not found';
  END IF;

  v_is_admin := public.has_role(p_caller_id, 'admin');

  IF NOT (v_is_admin OR v_ticket.requester_id = p_caller_id) THEN
    RAISE EXCEPTION 'code: FORBIDDEN_NOT_TICKET_OWNER, You are not authorized to view this support ticket';
  END IF;

  SELECT p.full_name, p.email INTO v_requester_name, v_requester_email
  FROM public.profiles p WHERE p.id = v_ticket.requester_id;

  -- ---- conversation ------------------------------------------------------
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id,
           'senderId', m.sender_id,
           'senderRole', m.sender_role,
           'message', m.message,
           'isInternal', m.is_internal,
           'createdAt', m.created_at
         ) ORDER BY m.created_at, m.id), '[]'::jsonb)
    INTO v_messages
  FROM public.support_messages m
  WHERE m.ticket_id = v_ticket.id
    -- A non-admin simply never sees internal rows. Not filtered afterwards in
    -- JavaScript, so it cannot be bypassed by a different caller shape.
    AND (v_is_admin OR m.is_internal = FALSE);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', a.id,
           'messageId', a.message_id,
           'uploadedBy', a.uploaded_by,
           'fileName', a.file_name,
           'mimeType', a.mime_type,
           'fileSize', a.file_size,
           'createdAt', a.created_at
         ) ORDER BY a.created_at, a.id), '[]'::jsonb)
    INTO v_attachments
  FROM public.support_attachments a
  WHERE a.ticket_id = v_ticket.id;

  -- ---- admin-only history ------------------------------------------------
  IF v_is_admin THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', e.id,
             'actorId', e.actor_id,
             'eventType', e.event_type,
             'metadata', e.metadata,
             'createdAt', e.created_at
           ) ORDER BY e.created_at DESC, e.id), '[]'::jsonb)
      INTO v_audit
    FROM public.support_audit_events e
    WHERE e.ticket_id = v_ticket.id;
  ELSE
    v_audit := '[]'::jsonb;
  END IF;

  -- ---- booking context (no meeting link) ---------------------------------
  IF v_ticket.booking_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'bookingCode', b.booking_code,
      'status', b.status,
      'startTime', b.start_time,
      'amountInr', b.amount_inr
    ) INTO v_booking
    FROM public.bookings b WHERE b.id = v_ticket.booking_id;
  ELSE
    v_booking := NULL;
  END IF;

  -- ---- payment context: READ ONLY, credentials excluded ------------------
  IF v_ticket.payment_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'amountInr', pay.amount_inr,
      'status', pay.status,
      'gateway', pay.gateway,
      'refundStatus', pay.refund_status,
      'refundAmountInr', CASE WHEN pay.refund_amount_paise IS NULL THEN NULL ELSE pay.refund_amount_paise / 100.0 END,
      'refundedAt', pay.refunded_at,
      'refundMethod', pay.refund_method,
      'manualRefundRequired', pay.manual_refund_required
    ) INTO v_payment
    FROM public.payments pay WHERE pay.id = v_ticket.payment_id;
  ELSE
    v_payment := NULL;
  END IF;

  RETURN jsonb_build_object(
    'ticket', jsonb_build_object(
      'id', v_ticket.id,
      'ticketCode', v_ticket.ticket_code,
      'requesterId', v_ticket.requester_id,
      'requesterRole', v_ticket.requester_role,
'requesterName', v_requester_name,
      'requesterEmail', v_requester_email,
      'category', v_ticket.category,
      'subject', v_ticket.subject,
      'status', v_ticket.status,
      'priority', v_ticket.priority,
      'bookingId', v_ticket.booking_id,
      'paymentId', v_ticket.payment_id,
      'assignedAdminId', v_ticket.assigned_admin_id,
      'resolution', v_ticket.resolution,
      'resolvedAt', v_ticket.resolved_at,
      'closedAt', v_ticket.closed_at,
      'createdAt', v_ticket.created_at,
      'updatedAt', v_ticket.updated_at,
      'lastMessageAt', v_ticket.last_message_at
    ),
    'messages', v_messages,
    'attachments', v_attachments,
    'auditEvents', v_audit,
    'booking', v_booking,
    'payment', v_payment,
    'viewerIsAdmin', v_is_admin
  );
END;
$$;


ALTER FUNCTION "public"."get_support_ticket"("p_ticket_code" "text", "p_caller_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_role"("user_uuid" "uuid") RETURNS "public"."app_role"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_role app_role;
BEGIN
  SELECT role INTO v_role FROM user_roles
  WHERE user_id = user_uuid
  ORDER BY
    CASE role
      WHEN 'admin' THEN 1
      WHEN 'mentor' THEN 2
      WHEN 'mentor_pending' THEN 3
      WHEN 'seeker' THEN 4
      ELSE 5
    END
  LIMIT 1;
  RETURN v_role;
END;
$$;


ALTER FUNCTION "public"."get_user_role"("user_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_roles"("check_user_id" "uuid") RETURNS TABLE("role" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT ur.role FROM public.user_roles ur
  WHERE ur.user_id = check_user_id;
$$;


ALTER FUNCTION "public"."get_user_roles"("check_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_sessions"("p_user_id" "uuid" DEFAULT NULL::"uuid", "p_limit" integer DEFAULT 100) RETURNS TABLE("session_id" "uuid", "mentor_id" "uuid", "student_id" "uuid", "scheduled_time" timestamp with time zone, "duration_mins" integer, "status" "text", "payment_status" "text", "meeting_link" "text", "confirmed_at" timestamp with time zone, "completed_at" timestamp with time zone, "meeting_link_deadline" timestamp with time zone, "meeting_link_overdue" boolean, "can_join" boolean, "join_reason" "text", "mentor_name" "text", "mentor_avatar_url" "text", "student_name" "text", "student_avatar_url" "text", "segment_name" "text", "gig_title" "text", "gig_price" numeric, "gig_currency" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id uuid := COALESCE(p_user_id, auth.uid());
  v_now timestamptz := now();
BEGIN
  RETURN QUERY
  SELECT
    s.id as session_id,
    s.mentor_id,
    s.student_id,
    s.scheduled_time,
    s.duration_mins,
    s.status,
    s.payment_status,
    s.meeting_link,
    s.confirmed_at,
    s.completed_at,
    s.meeting_link_deadline,
    s.meeting_link_overdue,
    -- T-5 window check (server authoritative)
    CASE
      WHEN s.status = 'confirmed'
        AND s.meeting_link IS NOT NULL
        AND v_now >= s.scheduled_time - interval '5 minutes'
        AND v_now < s.scheduled_time + (s.duration_mins || ' minutes')::interval
      THEN true
      ELSE false
    END as can_join,
    CASE
      WHEN s.status <> 'confirmed' THEN 'Session not confirmed'
      WHEN s.meeting_link IS NULL THEN 'Meeting link not set'
      WHEN v_now < s.scheduled_time - interval '5 minutes' THEN 'Session starts in 5 minutes'
      WHEN v_now >= s.scheduled_time + (s.duration_mins || ' minutes')::interval THEN 'Session has ended'
      ELSE 'OK'
    END as join_reason,
    m.full_name as mentor_name,
    m.avatar_url as mentor_avatar_url,
    st.full_name as student_name,
    st.avatar_url as student_avatar_url,
    seg.name as segment_name,
    g.title as gig_title,
    g.price as gig_price,
    g.currency as gig_currency
  FROM sessions s
  LEFT JOIN profiles m ON m.id = s.mentor_id
  LEFT JOIN profiles st ON st.id = s.student_id
  LEFT JOIN segments seg ON seg.id = s.category_id
  LEFT JOIN gigs g ON g.mentor_id = s.mentor_id AND g.segment_id = s.category_id
  WHERE (s.mentor_id = v_user_id OR s.student_id = v_user_id)
  ORDER BY s.scheduled_time DESC
  LIMIT p_limit;
END;
$$;


ALTER FUNCTION "public"."get_user_sessions"("p_user_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_role TEXT;
  v_full_name TEXT;
  v_timezone TEXT;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));
  v_timezone := COALESCE(NEW.raw_user_meta_data->>'timezone', 'Asia/Kolkata');

  INSERT INTO public.profiles (id, email, full_name, timezone, created_at, updated_at)
  VALUES (NEW.id, NEW.email, v_full_name, v_timezone, NOW(), NOW())
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      updated_at = NOW();

  -- Prevent arbitrary self-assignment of 'admin' through signup metadata.
  v_role := LOWER(COALESCE(NEW.raw_user_meta_data->>'requested_role', 'seeker'));
  IF v_role NOT IN ('seeker', 'mentor') THEN
    v_role := 'seeker';
  END IF;

  INSERT INTO public.user_roles (user_id, role, created_at)
  VALUES (NEW.id, v_role, NOW())
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_role"("check_user_id" "uuid", "check_role" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = check_user_id AND role = check_role
  );
$$;


ALTER FUNCTION "public"."has_role"("check_user_id" "uuid", "check_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."hold_duration_interval"() RETURNS interval
    LANGUAGE "sql" STABLE
    AS $$
  SELECT make_interval(
    mins => COALESCE(
      (SELECT hold_duration_minutes FROM public.platform_config WHERE id = 1),
      5
    )
  );
$$;


ALTER FUNCTION "public"."hold_duration_interval"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor_user_id" "uuid",
    "actor_role" "text",
    "action" "text" NOT NULL,
    "entity_type" "text",
    "entity_id" "text",
    "request_id" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_audit_log"("p_actor_user_id" "uuid", "p_actor_role" "text", "p_action" "text", "p_entity_type" "text" DEFAULT NULL::"text", "p_entity_id" "text" DEFAULT NULL::"text", "p_request_id" "text" DEFAULT NULL::"text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "public"."audit_logs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_log public.audit_logs;
BEGIN
  INSERT INTO public.audit_logs (
    actor_user_id, actor_role, action, entity_type, entity_id, request_id, metadata
  ) VALUES (
    p_actor_user_id, p_actor_role, p_action, p_entity_type, p_entity_id,
    p_request_id, COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING * INTO v_log;
  RETURN v_log;
END;
$$;


ALTER FUNCTION "public"."insert_audit_log"("p_actor_user_id" "uuid", "p_actor_role" "text", "p_action" "text", "p_entity_type" "text", "p_entity_id" "text", "p_request_id" "text", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_notification"("p_user_id" "uuid", "p_title" "text", "p_body" "text" DEFAULT NULL::"text", "p_category" "text" DEFAULT 'general'::"text", "p_kind" "text" DEFAULT 'system'::"text", "p_related_id" "uuid" DEFAULT NULL::"uuid", "p_link" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.notifications (
    user_id, title, body, category, kind, related_id, link, read, created_at
  ) VALUES (
    p_user_id, p_title, p_body, p_category, p_kind, p_related_id, p_link, false, now()
  );
END;
$$;


ALTER FUNCTION "public"."insert_notification"("p_user_id" "uuid", "p_title" "text", "p_body" "text", "p_category" "text", "p_kind" "text", "p_related_id" "uuid", "p_link" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "request_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "level" "text" NOT NULL,
    "category" "text" NOT NULL,
    "method" "text",
    "path" "text",
    "status_code" integer,
    "duration_ms" integer,
    "user_id" "uuid",
    "role" "text",
    "error_code" "text",
    "message" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "system_logs_category_check" CHECK (("category" = ANY (ARRAY['api_request'::"text", 'api_error'::"text", 'auth'::"text", 'db'::"text", 'business'::"text", 'system'::"text"]))),
    CONSTRAINT "system_logs_level_check" CHECK (("level" = ANY (ARRAY['debug'::"text", 'info'::"text", 'warn'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."system_logs" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_system_log"("p_request_id" "text", "p_level" "text", "p_category" "text", "p_method" "text" DEFAULT NULL::"text", "p_path" "text" DEFAULT NULL::"text", "p_status_code" integer DEFAULT NULL::integer, "p_duration_ms" integer DEFAULT NULL::integer, "p_user_id" "uuid" DEFAULT NULL::"uuid", "p_role" "text" DEFAULT NULL::"text", "p_error_code" "text" DEFAULT NULL::"text", "p_message" "text" DEFAULT NULL::"text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "public"."system_logs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_log public.system_logs;
BEGIN
  INSERT INTO public.system_logs (
    request_id, level, category, method, path, status_code,
    duration_ms, user_id, role, error_code, message, metadata
  ) VALUES (
    p_request_id, p_level, p_category, p_method, p_path, p_status_code,
    p_duration_ms, p_user_id, p_role, p_error_code, p_message,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING * INTO v_log;
  RETURN v_log;
END;
$$;


ALTER FUNCTION "public"."insert_system_log"("p_request_id" "text", "p_level" "text", "p_category" "text", "p_method" "text", "p_path" "text", "p_status_code" integer, "p_duration_ms" integer, "p_user_id" "uuid", "p_role" "text", "p_error_code" "text", "p_message" "text", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_account_suspended"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_status TEXT;
  v_until  TIMESTAMPTZ;
BEGIN
  SELECT account_status, suspended_until INTO v_status, v_until
  FROM public.profiles WHERE id = p_user_id;

  IF v_status IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_status = 'deactivated' THEN
    RETURN TRUE;
  END IF;

  IF v_status = 'suspended' THEN
    -- A suspension with an expiry lapses automatically SERVER-SIDE once
    -- now >= suspended_until. No frontend timer is involved.
    IF v_until IS NOT NULL AND NOW() >= v_until THEN
      RETURN FALSE;
    END IF;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;


ALTER FUNCTION "public"."is_account_suspended"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_current_user_suspended"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT public.is_account_suspended(auth.uid());
$$;


ALTER FUNCTION "public"."is_current_user_suspended"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_mentor"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT public.has_role(auth.uid(), 'mentor');
$$;


ALTER FUNCTION "public"."is_mentor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_mentor_discoverable"("p_mentor_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_ok BOOLEAN := FALSE;
BEGIN
  IF to_regclass('public.mentor_profiles') IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT TRUE INTO v_ok
  FROM public.mentor_profiles mp
  WHERE mp.id = p_mentor_id
    AND mp.is_approved     = TRUE
    AND mp.is_active       = TRUE
    AND mp.approval_status = 'approved'
    AND NOT public.is_account_suspended(mp.id)
  LIMIT 1;

  IF NOT COALESCE(v_ok, FALSE) THEN
    RETURN FALSE;
  END IF;

  IF to_regclass('public.gigs') IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM public.gigs g
                   WHERE g.mentor_id = p_mentor_id AND g.is_active = TRUE);
  END IF;

  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."is_mentor_discoverable"("p_mentor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_mentor_discoverable"("p_mentor_id" "uuid", "p_segment_id" "uuid", "p_date" "date") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_mentor_active boolean;
  v_has_gig boolean;
  v_has_slot boolean;
BEGIN
  -- Check mentor approved and active
  SELECT is_active AND is_verified INTO v_mentor_active
  FROM mentor_profiles WHERE user_id = p_mentor_id;
  
  IF NOT v_mentor_active THEN
    RETURN false;
  END IF;

  -- Check mentor has active gig for this segment
  SELECT EXISTS(
    SELECT 1 FROM gigs g
    JOIN mentor_segments ms ON g.segment_id = ms.segment_id
    WHERE g.mentor_id = p_mentor_id
      AND g.segment_id = p_segment_id
      AND g.is_active = true
      AND g.is_archived = false
  ) INTO v_has_gig;
  
  IF NOT v_has_gig THEN
    RETURN false;
  END IF;

  -- Check mentor has at least one valid bookable slot on this date
  SELECT EXISTS(
    SELECT 1 FROM public.get_bookable_slots(p_mentor_id, p_date)
  ) INTO v_has_slot;
  
  RETURN v_has_slot;
END;
$$;


ALTER FUNCTION "public"."is_mentor_discoverable"("p_mentor_id" "uuid", "p_segment_id" "uuid", "p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_support_ticket_replyable"("p_status" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT p_status IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER');
$$;


ALTER FUNCTION "public"."is_support_ticket_replyable"("p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_valid_support_transition"("p_from" "text", "p_to" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT CASE p_from
    WHEN 'OPEN'           THEN p_to IN ('IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED')
    WHEN 'IN_PROGRESS'    THEN p_to IN ('WAITING_FOR_USER', 'RESOLVED', 'CLOSED')
    WHEN 'WAITING_FOR_USER' THEN p_to IN ('IN_PROGRESS', 'RESOLVED', 'CLOSED')
    WHEN 'RESOLVED'       THEN p_to IN ('OPEN', 'CLOSED')
    WHEN 'CLOSED'         THEN FALSE
    ELSE FALSE
  END;
$$;


ALTER FUNCTION "public"."is_valid_support_transition"("p_from" "text", "p_to" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."issue_auth_otp_hashed"("p_email" "text", "p_purpose" "text", "p_otp_hash" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_normalized text;
  v_last_created timestamptz;
  v_otp_id uuid;
BEGIN
  IF p_email IS NULL OR btrim(p_email) = '' THEN
    RAISE EXCEPTION 'email required';
  END IF;
  IF p_purpose NOT IN ('signup', 'password_reset', 'reset_token') THEN
    RAISE EXCEPTION 'invalid purpose';
  END IF;
  IF p_otp_hash IS NULL OR btrim(p_otp_hash) = '' THEN
    RAISE EXCEPTION 'otp_hash required';
  END IF;

  v_normalized := lower(btrim(p_email));

  -- 60-second resend cooldown (not enforced for reset_token rows).
  IF p_purpose <> 'reset_token' THEN
    SELECT created_at INTO v_last_created
    FROM public.auth_otps
    WHERE email = v_normalized AND purpose = p_purpose
    ORDER BY created_at DESC LIMIT 1;

    IF v_last_created IS NOT NULL
       AND now() - v_last_created < interval '60 seconds' THEN
      RAISE EXCEPTION 'cooldown';
    END IF;
  END IF;

  -- Invalidate any previous unverified OTPs for this email+purpose.
  UPDATE public.auth_otps
  SET verified = true
  WHERE email = v_normalized
    AND purpose = p_purpose
    AND verified = false;

  INSERT INTO public.auth_otps (email, otp_hash, purpose, expires_at)
  VALUES (v_normalized, p_otp_hash, p_purpose, now() + interval '10 minutes')
  RETURNING id INTO v_otp_id;

  RETURN v_otp_id;
END;
$$;


ALTER FUNCTION "public"."issue_auth_otp_hashed"("p_email" "text", "p_purpose" "text", "p_otp_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_active_login_threats"("p_limit" integer DEFAULT 50) RETURNS TABLE("identifier_key" "text", "consecutive_failures" integer, "first_failed_at" timestamp with time zone, "last_failed_at" timestamp with time zone, "last_failure_reason" "text", "alerted_at" timestamp with time zone, "alert_count" integer)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT t.identifier_key, t.consecutive_failures, t.first_failed_at, t.last_failed_at,
         t.last_failure_reason, t.alerted_at, t.alert_count
  FROM public.login_failure_trackers t
  WHERE t.consecutive_failures > 0
  ORDER BY t.consecutive_failures DESC, t.last_failed_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));
$$;


ALTER FUNCTION "public"."list_active_login_threats"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_all_payments"("p_status" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 100, "p_offset" integer DEFAULT 0) RETURNS TABLE("payment_id" "uuid", "booking_id" "uuid", "student_id" "uuid", "mentor_id" "uuid", "amount" numeric, "currency" "text", "payment_method" "text", "proof_storage_path" "text", "proof_uploaded_at" timestamp with time zone, "submitted_at" timestamp with time zone, "status" "text", "reviewed_by" "uuid", "reviewed_at" timestamp with time zone, "admin_notes" "text", "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "student_name" "text", "student_email" "text", "mentor_name" "text", "scheduled_time" timestamp with time zone, "session_status" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT
    p.id as payment_id,
    p.booking_id,
    p.student_id,
    p.mentor_id,
    p.amount,
    p.currency,
    p.payment_method,
    p.proof_storage_path,
    p.proof_uploaded_at,
    p.submitted_at,
    p.status,
    p.reviewed_by,
    p.reviewed_at,
    p.admin_notes,
    p.created_at,
    p.updated_at,
    ps.full_name as student_name,
    ps.email as student_email,
    pm.full_name as mentor_name,
    s.scheduled_time,
    s.status as session_status
  FROM public.payments p
  JOIN public.sessions s ON s.id = p.booking_id
  LEFT JOIN public.profiles ps ON ps.id = p.student_id
  LEFT JOIN public.profiles pm ON pm.id = p.mentor_id
  WHERE (p_status IS NULL OR p.status = p_status)
  ORDER BY p.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;


ALTER FUNCTION "public"."list_all_payments"("p_status" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_pending_payments"("p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS TABLE("payment_id" "uuid", "booking_id" "uuid", "student_id" "uuid", "mentor_id" "uuid", "amount" numeric, "currency" "text", "payment_method" "text", "proof_storage_path" "text", "proof_uploaded_at" timestamp with time zone, "submitted_at" timestamp with time zone, "admin_notes" "text", "created_at" timestamp with time zone, "student_name" "text", "student_email" "text", "mentor_name" "text", "mentor_avatar_url" "text", "scheduled_time" timestamp with time zone, "session_status" "text", "segment_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT
    p.id as payment_id,
    p.booking_id,
    p.student_id,
    p.mentor_id,
    p.amount,
    p.currency,
    p.payment_method,
    p.proof_storage_path,
    p.proof_uploaded_at,
    p.submitted_at,
    p.admin_notes,
    p.created_at,
    ps.full_name as student_name,
    ps.email as student_email,
    pm.full_name as mentor_name,
    pm.avatar_url as mentor_avatar_url,
    s.scheduled_time,
    s.status as session_status,
    s.category_id as segment_id
  FROM public.payments p
  JOIN public.sessions s ON s.id = p.booking_id
  LEFT JOIN public.profiles ps ON ps.id = p.student_id
  LEFT JOIN public.profiles pm ON pm.id = p.mentor_id
  WHERE p.status = 'pending'
  ORDER BY p.submitted_at DESC NULLS LAST, p.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;


ALTER FUNCTION "public"."list_pending_payments"("p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_support_tickets"("p_caller_id" "uuid", "p_scope" "text" DEFAULT 'USER'::"text", "p_status" "text" DEFAULT NULL::"text", "p_priority" "text" DEFAULT NULL::"text", "p_category" "text" DEFAULT NULL::"text", "p_requester_role" "text" DEFAULT NULL::"text", "p_assigned_admin_id" "uuid" DEFAULT NULL::"uuid", "p_search" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 100, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_is_admin boolean;
  v_rows jsonb;
  v_total integer;
BEGIN
  IF p_caller_id IS NULL THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, Authentication required';
  END IF;

  v_is_admin := public.has_role(p_caller_id, 'admin');

  -- An admin asking for the ADMIN queue. Anything else is scoped to the
  -- caller, which is the point: there is no argument that can widen it.
  IF p_scope = 'ADMIN' AND NOT v_is_admin THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, Only an admin can list the support queue';
  END IF;

  WITH filtered AS (
    SELECT t.*
    FROM public.support_tickets t
    WHERE (
      -- The admin queue, or - for everyone else, including an admin who asked
      -- for USER scope - their own tickets. There is no third case, so no
      -- argument can widen this.
      CASE WHEN p_scope = 'ADMIN' AND v_is_admin THEN TRUE
           ELSE t.requester_id = p_caller_id
      END
    )
      AND (p_status IS NULL OR t.status = p_status)
      AND (p_priority IS NULL OR t.priority = p_priority)
      AND (p_category IS NULL OR t.category = p_category)
      AND (p_requester_role IS NULL OR t.requester_role = p_requester_role)
      AND (p_assigned_admin_id IS NULL OR t.assigned_admin_id = p_assigned_admin_id)
      AND (
        p_search IS NULL
        OR NULLIF(btrim(p_search), '') IS NULL
        OR t.ticket_code ILIKE '%' || btrim(p_search) || '%'
        OR t.subject ILIKE '%' || btrim(p_search) || '%'
        OR EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = t.requester_id
            AND (p.full_name ILIKE '%' || btrim(p_search) || '%'
                 OR p.email ILIKE '%' || btrim(p_search) || '%')
        )
      )
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'ticketCode', x.ticket_code,
      'requesterId', x.requester_id,
      'requesterRole', x.requester_role,
      'requesterName', x.requester_name,
      'requesterEmail', x.requester_email,
      'category', x.category,
      'subject', x.subject,
      'status', x.status,
      'priority', x.priority,
      'bookingId', x.booking_id,
      'paymentId', x.payment_id,
      'assignedAdminId', x.assigned_admin_id,
      'resolution', x.resolution,
      'createdAt', x.created_at,
      'updatedAt', x.updated_at,
      'lastMessageAt', x.last_message_at
    ) ORDER BY x.updated_at DESC), '[]'::jsonb),
    count(*)
  INTO v_rows, v_total
  FROM (
    SELECT f.*, pr.full_name AS requester_name, pr.email AS requester_email
    FROM filtered f
    JOIN public.profiles pr ON pr.id = f.requester_id
    ORDER BY f.updated_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ) x;

  RETURN jsonb_build_object(
    'success', TRUE,
    'scope', CASE WHEN p_scope = 'ADMIN' AND v_is_admin THEN 'ADMIN' ELSE 'USER' END,
    'total', v_total,
    'tickets', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;


ALTER FUNCTION "public"."list_support_tickets"("p_caller_id" "uuid", "p_scope" "text", "p_status" "text", "p_priority" "text", "p_category" "text", "p_requester_role" "text", "p_assigned_admin_id" "uuid", "p_search" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_all_notifications_as_read"("p_user_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.notifications
  SET is_read = TRUE,
      read_at = NOW()
  WHERE user_id = p_user_id
    AND is_read = FALSE;
  
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;


ALTER FUNCTION "public"."mark_all_notifications_as_read"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_notification_as_read"("p_notification_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.notifications
  SET is_read = TRUE,
      read_at = NOW()
  WHERE id = p_notification_id
    AND (user_id = p_user_id OR public.is_admin());
  
  RETURN FOUND;
END;
$$;


ALTER FUNCTION "public"."mark_notification_as_read"("p_notification_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mentor_accept_booking_atomic"("p_request_id" "uuid", "p_mentor_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_request      public.mentor_session_requests;
  v_session_req  public.session_requests;
  v_session_id   uuid;
begin
  -- Fetch and lock the mentor session request
  select * into v_request
  from public.mentor_session_requests
  where id = p_request_id and mentor_id = p_mentor_id
  for update;

  if v_request.id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'request_not_found_or_not_yours'
    );
  end if;

  -- Only accept pending requests
  if v_request.status not in ('accepted', 'pending') then
    return jsonb_build_object(
      'success', false,
      'error', 'request_already_handled'
    );
  end if;

  -- Check if the response window has not expired
  if v_request.response_deadline < now() then
    return jsonb_build_object(
      'success', false,
      'error', 'response_deadline_expired'
    );
  end if;

  -- Fetch the parent session_request with lock
  select * into v_session_req
  from public.session_requests
  where id = v_request.booking_id
  for update;

  if v_session_req.id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'session_request_not_found'
    );
  end if;

  -- Accept the mentor session request
  update public.mentor_session_requests
  set status = 'accepted',
      updated_at = now()
  where id = p_request_id;

  -- If a sessions row hasn't been created yet, create it now.
  if v_session_req.session_id is null then
    insert into public.sessions (
      student_id, mentor_id, scheduled_time, duration_mins,
      status, payment_status, language
    ) values (
      v_session_req.student_id, v_request.mentor_id,
      v_session_req.scheduled_time,
      coalesce(v_request.duration_mins, v_session_req.duration_mins, 30),
      'confirmed', 'pending', v_session_req.language
    )
    returning id into v_session_id;

    -- Link the session back to the session_request
    update public.session_requests
    set booking_status = 'confirmed',
        assigned_mentor = p_mentor_id,
        session_id = v_session_id,
        confirmed_at = now(),
        mentor_response_at = now(),
        status = 'confirmed'
    where id = v_request.booking_id;
  else
    -- Session already exists; just update statuses
    update public.session_requests
    set booking_status = 'confirmed',
        assigned_mentor = p_mentor_id,
        confirmed_at = now(),
        mentor_response_at = now(),
        status = 'confirmed'
    where id = v_request.booking_id;

    v_session_id := v_session_req.session_id;

    -- Update the session status if it exists
    update public.sessions
    set status = 'confirmed',
        mentor_id = p_mentor_id
    where id = v_session_id;
  end if;

  -- Insert a timeline entry
  insert into public.booking_timeline (
    booking_id, actor_id, actor_role, action, description, metadata
  ) values (
    v_request.booking_id, p_mentor_id, 'mentor',
    'accepted', 'Mentor accepted the session request',
    jsonb_build_object('request_id', p_request_id, 'session_id', v_session_id)
  );

  return jsonb_build_object(
    'success', true,
    'booking_id', v_session_id,
    'request_id', p_request_id
  );
end;
$$;


ALTER FUNCTION "public"."mentor_accept_booking_atomic"("p_request_id" "uuid", "p_mentor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mentor_cancel_booking"("p_booking_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_booking RECORD;
  v_mentor_id uuid := auth.uid();
BEGIN
  SELECT * INTO v_booking FROM sessions WHERE id = p_booking_id;
  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'booking_not_found';
  END IF;
  
  IF v_booking.mentor_id <> v_mentor_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  UPDATE sessions SET status = 'cancelled' WHERE id = p_booking_id;

  UPDATE booking_holds
  SET status = 'released', released_at = now()
  WHERE booking_id = p_booking_id AND status = 'active';

  -- Notify seeker and admin
  INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
  VALUES (v_booking.student_id, 'mentor_cancelled', 'Session cancelled by mentor',
          'The mentor has cancelled the session. Reason: ' || COALESCE(p_reason, 'Not specified'),
          'booking', p_booking_id);

  INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
  SELECT user_id, 'mentor_cancelled', 'Mentor cancelled session',
         'A mentor cancelled a session with a seeker.', 'booking', p_booking_id
  FROM user_roles WHERE role = 'admin';

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id);
END;
$$;


ALTER FUNCTION "public"."mentor_cancel_booking"("p_booking_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mentor_confirm_booking"("p_booking_id" "uuid", "p_meeting_link" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_booking RECORD;
  v_mentor_id uuid := auth.uid();
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_booking FROM sessions WHERE id = p_booking_id;
  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'booking_not_found';
  END IF;

  IF v_booking.mentor_id <> v_mentor_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_booking.status <> 'mentor_pending' THEN
    RAISE EXCEPTION 'booking_not_mentor_pending';
  END IF;

  IF v_booking.payment_status <> 'approved' THEN
    RAISE EXCEPTION 'payment_not_approved';
  END IF;

  IF v_booking.status IN ('cancelled', 'rejected') THEN
    RAISE EXCEPTION 'booking_cancelled';
  END IF;

  IF v_booking.scheduled_time <= v_now THEN
    RAISE EXCEPTION 'session_already_started';
  END IF;

  IF p_meeting_link IS NULL OR p_meeting_link = '' THEN
    RAISE EXCEPTION 'meeting_link_required';
  END IF;

  -- Validate HTTPS URL
  IF NOT p_meeting_link ~* '^https://' THEN
    RAISE EXCEPTION 'invalid_meeting_link';
  END IF;

  -- Atomically set meeting link + confirm + timestamps
  UPDATE sessions
  SET meeting_link = p_meeting_link,
      meeting_link_added_at = v_now,
      meeting_link_deadline = scheduled_time - interval '2 hours',
      confirmed_at = v_now,
      status = 'confirmed'
  WHERE id = p_booking_id;

  -- Mark meeting link NOT overdue (it was just added)
  UPDATE sessions
  SET meeting_link_overdue = false
  WHERE id = p_booking_id AND meeting_link_overdue = true;

  -- Notify seeker
  INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
  VALUES (v_booking.student_id, 'mentor_confirmed', 'Session confirmed',
          'Your mentor has confirmed the session. Meeting link will be available 5 minutes before start.',
          'booking', p_booking_id);

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'status', 'confirmed'
  );
END;
$$;


ALTER FUNCTION "public"."mentor_confirm_booking"("p_booking_id" "uuid", "p_meeting_link" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mentor_decline_booking_atomic"("p_request_id" "uuid", "p_mentor_id" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_request      public.mentor_session_requests;
begin
  -- Fetch and lock the mentor session request
  select * into v_request
  from public.mentor_session_requests
  where id = p_request_id and mentor_id = p_mentor_id
  for update;

  if v_request.id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'request_not_found_or_not_yours'
    );
  end if;

  -- Only decline pending or accepted requests
  if v_request.status not in ('pending', 'accepted') then
    return jsonb_build_object(
      'success', false,
      'error', 'request_already_handled'
    );
  end if;

  -- Mark the mentor request as declined
  update public.mentor_session_requests
  set status = 'declined',
      updated_at = now()
  where id = p_request_id;

  -- Reset the session_request back to awaiting_mentor for re-assignment
  update public.session_requests
  set booking_status = 'awaiting_mentor',
      assigned_mentor = null,
      updated_at = now()
  where id = v_request.booking_id
    and booking_status = 'mentor_assigned';

  -- Insert a timeline entry
  insert into public.booking_timeline (
    booking_id, actor_id, actor_role, action, description, metadata
  ) values (
    v_request.booking_id, p_mentor_id, 'mentor',
    'declined', 'Mentor declined the session request',
    jsonb_build_object('request_id', p_request_id, 'reason', p_reason)
  );

  return jsonb_build_object(
    'success', true,
    'request_id', p_request_id
  );
end;
$$;


ALTER FUNCTION "public"."mentor_decline_booking_atomic"("p_request_id" "uuid", "p_mentor_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mentor_is_publicly_visible"("p_mentor_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE((
    SELECT (
      mp.is_approved = TRUE
      AND mp.approval_status = 'approved'
      AND mp.is_active = TRUE
      AND NOT public.is_account_suspended(mp.id)
    )
    FROM public.mentor_profiles mp
    WHERE mp.id = p_mentor_id
  ), FALSE);
$$;


ALTER FUNCTION "public"."mentor_is_publicly_visible"("p_mentor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_support_ticket_code"() RETURNS "text"
    LANGUAGE "sql"
    AS $$
  SELECT 'SK-'
    || to_char(clock_timestamp() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD')
    || '-'
    || lpad(nextval('public.support_ticket_code_seq')::TEXT, 6, '0');
$$;


ALTER FUNCTION "public"."next_support_ticket_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prune_login_failure_trackers"("p_older_than_minutes" integer DEFAULT 1440) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  WITH removed AS (
    DELETE FROM public.login_failure_trackers
    WHERE last_failed_at < NOW() - (GREATEST(1, COALESCE(p_older_than_minutes, 1440)) || ' minutes')::INTERVAL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deleted FROM removed;
  RETURN v_deleted;
END;
$$;


ALTER FUNCTION "public"."prune_login_failure_trackers"("p_older_than_minutes" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prune_system_logs"("p_retention_days" integer DEFAULT NULL::integer) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_retention INTEGER;
  v_deleted INTEGER;
BEGIN
  SELECT COALESCE(p_retention_days, retention_days) INTO v_retention
  FROM public.system_log_retention WHERE id = 1;

  IF v_retention IS NULL THEN
    v_retention := 30;
  END IF;

  WITH deleted AS (
    DELETE FROM public.system_logs
    WHERE created_at < NOW() - (v_retention || ' days')::INTERVAL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deleted FROM deleted;

  RETURN v_deleted;
END;
$$;


ALTER FUNCTION "public"."prune_system_logs"("p_retention_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purge_expired_auth_otps"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.auth_otps
  WHERE expires_at < now() - interval '1 hour';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."purge_expired_auth_otps"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purge_expired_pending_signups"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.pending_signups
  WHERE expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."purge_expired_pending_signups"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_expired_bookings"("p_booking_ids" "uuid"[]) RETURNS "uuid"[]
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_done uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_booking_ids IS NULL OR array_length(p_booking_ids, 1) IS NULL THEN
    RETURN v_done;
  END IF;

  -- service_role only. The caller supplies ids it has already authorised, and
  -- the companion single-row function keeps the participant check for anything
  -- that arrives with a real end-user session.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN v_done;
  END IF;

  -- A CTE, not ARRAY(UPDATE ...): a data-modifying statement is not allowed
  -- inside an ARRAY() constructor.
  WITH transitioned AS (
    UPDATE public.bookings b
       SET status          = 'COMPLETED',
           actual_ended_at = b.end_time,
           updated_at      = now()
     WHERE b.id = ANY(p_booking_ids)
       AND b.status = 'CONFIRMED'
       AND b.end_time IS NOT NULL
       AND b.end_time <= now()
    RETURNING b.id
  )
  SELECT COALESCE(array_agg(t.id), ARRAY[]::uuid[])
    INTO v_done
    FROM transitioned t;

  RETURN v_done;
END;
$$;


ALTER FUNCTION "public"."reconcile_expired_bookings"("p_booking_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reconcile_expired_bookings"("p_booking_ids" "uuid"[]) IS 'Service-role only. Bulk variant of reconcile_expired_sessions(uuid) for list endpoints: completes elapsed CONFIRMED rows among the given ids, setting actual_ended_at to each row''s own end_time. Returns the ids actually transitioned.';



CREATE OR REPLACE FUNCTION "public"."reconcile_expired_sessions"("p_booking_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_state text;
BEGIN
  IF p_booking_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- service_role is the server's own key: it has already authorised the request
  -- upstream and deliberately carries no end-user uid, so requiring
  -- auth.uid() here made the function a no-op on every real call. Anyone else
  -- must still be a participant on the row.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.bookings b
       WHERE b.id = p_booking_id
         AND auth.uid() IN (b.seeker_id, b.mentor_id)
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  UPDATE public.bookings b
     SET status          = 'COMPLETED',
         -- The scheduled end, not the moment we noticed, so the recorded
         -- instant is identical no matter which path completed the row.
         actual_ended_at = b.end_time,
         updated_at      = now()
   WHERE b.id = p_booking_id
     AND b.status = 'CONFIRMED'
     AND b.end_time IS NOT NULL
     AND b.end_time <= now();

  SELECT public.resolve_session_state(b.status, b.start_time, b.end_time, b.actual_ended_at)
    INTO v_state
    FROM public.bookings b
   WHERE b.id = p_booking_id;

  RETURN v_state;
END;
$$;


ALTER FUNCTION "public"."reconcile_expired_sessions"("p_booking_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reconcile_expired_sessions"("p_booking_id" "uuid") IS 'Reconciles one authorized booking to COMPLETED if its window has closed, then returns the resolved session state. Returns NULL when the caller may not see the booking; NULL means "unknown" and must never be rendered as a business state.';



CREATE OR REPLACE FUNCTION "public"."record_login_failure"("p_identifier_key" "text", "p_failure_reason" "text" DEFAULT NULL::"text") RETURNS TABLE("consecutive_failures" integer, "should_alert" boolean, "alert_raised" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
#variable_conflict use_column
DECLARE
  v_threshold INTEGER;
  v_window_minutes INTEGER;
  v_streak INTEGER;
  v_alert_raised BOOLEAN := FALSE;
  v_previous_alert TIMESTAMPTZ;
  v_last_failed_at TIMESTAMPTZ;
  v_tracker public.login_failure_trackers;
BEGIN
  IF p_identifier_key IS NULL OR length(p_identifier_key) < 8 THEN
    RAISE EXCEPTION 'invalid identifier key';
  END IF;

  SELECT c.failure_threshold, c.window_minutes
  INTO v_threshold, v_window_minutes
  FROM public.login_failure_config c WHERE c.id = 1;

  v_threshold := COALESCE(v_threshold, 5);
  v_window_minutes := COALESCE(v_window_minutes, 15);

  SELECT t.consecutive_failures, t.last_failed_at, t.alerted_at
  INTO v_streak, v_last_failed_at, v_previous_alert
  FROM public.login_failure_trackers t
  WHERE t.identifier_key = p_identifier_key
  FOR UPDATE;

  -- No existing streak, or the previous failure fell outside the window:
  -- this is a brand new run of attempts, so the streak restarts at 1.
  IF v_streak IS NULL
     OR v_last_failed_at < NOW() - (v_window_minutes || ' minutes')::INTERVAL THEN
    v_streak := 1;
  ELSE
    v_streak := v_streak + 1;
  END IF;

  INSERT INTO public.login_failure_trackers (
    identifier_key, consecutive_failures, first_failed_at, last_failed_at,
    last_failure_reason
  ) VALUES (
    p_identifier_key, v_streak, NOW(), NOW(),
    left(COALESCE(p_failure_reason, 'UNKNOWN'), 120)
  )
  ON CONFLICT (identifier_key) DO UPDATE SET
    consecutive_failures = EXCLUDED.consecutive_failures,
    first_failed_at = CASE
      WHEN EXCLUDED.consecutive_failures = 1 THEN EXCLUDED.first_failed_at
      ELSE public.login_failure_trackers.first_failed_at
    END,
    last_failed_at = EXCLUDED.last_failed_at,
    last_failure_reason = EXCLUDED.last_failure_reason
  RETURNING * INTO v_tracker;

  -- Alert once per streak, not on every subsequent failure: re-arm only after
  -- the streak has been cleared (alerted_at is reset by reset_login_failures).
  IF v_streak >= v_threshold AND v_previous_alert IS NULL THEN
    v_alert_raised := TRUE;

    UPDATE public.login_failure_trackers
    SET alerted_at = NOW(), alert_count = alert_count + 1
    WHERE identifier_key = p_identifier_key;

    PERFORM public.insert_system_log(
      p_request_id := 'sec_login',
      p_level := 'error',
      p_category := 'auth',
      p_method := 'POST',
      p_path := '/api/auth/login-failure',
      p_status_code := 401,
      p_error_code := 'LOGIN_BRUTE_FORCE_SUSPECTED',
      p_message := 'LOGIN_BRUTE_FORCE_SUSPECTED',
      p_metadata := jsonb_build_object(
        'consecutive_failures', v_streak,
        'threshold', v_threshold,
        'window_minutes', v_window_minutes,
        'identifier_key_prefix', left(p_identifier_key, 12),
        'last_failure_reason', left(COALESCE(p_failure_reason, 'UNKNOWN'), 120),
        'first_failed_at', v_tracker.first_failed_at
      )
    );
  END IF;

  consecutive_failures := v_streak;
  should_alert := v_streak >= v_threshold;
  alert_raised := v_alert_raised;
  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."record_login_failure"("p_identifier_key" "text", "p_failure_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_mentor_document"("p_application_id" "uuid", "p_document_type" "text", "p_storage_path" "text", "p_original_filename" "text", "p_mime_type" "text", "p_size_bytes" bigint) RETURNS "public"."mentor_verification_documents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_doc public.mentor_verification_documents;
BEGIN
  -- Ownership + status gate, row-locked to stop a concurrent submit racing us.
  PERFORM 1 FROM public.mentor_applications
  WHERE id = p_application_id AND user_id = auth.uid()
    AND status IN ('draft','rejected')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found or not editable';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.mentor_document_types
                 WHERE code = p_document_type AND is_active = TRUE) THEN
    RAISE EXCEPTION 'Invalid document type';
  END IF;

  IF p_mime_type NOT IN ('image/jpeg','image/png','image/webp','application/pdf') THEN
    RAISE EXCEPTION 'Unsupported file type';
  END IF;

  IF p_size_bytes <= 0 OR p_size_bytes > 5242880 THEN
    RAISE EXCEPTION 'File size exceeds 5MB limit';
  END IF;

  INSERT INTO public.mentor_verification_documents
    (application_id, document_type, storage_path, original_filename,
     mime_type, size_bytes, status, updated_at)
  VALUES
    (p_application_id, p_document_type, p_storage_path, p_original_filename,
     p_mime_type, p_size_bytes, 'pending', NOW())
  ON CONFLICT (application_id, document_type) DO UPDATE
    SET storage_path       = EXCLUDED.storage_path,
        original_filename  = EXCLUDED.original_filename,
        mime_type          = EXCLUDED.mime_type,
        size_bytes         = EXCLUDED.size_bytes,
        status             = 'pending',
        admin_note         = NULL,
        reviewed_at        = NULL,
        reviewed_by        = NULL,
        updated_at         = NOW()
  RETURNING * INTO v_doc;

  PERFORM public._log_mentor_app_audit(
    p_application_id, 'document_uploaded', NULL, NULL,
    jsonb_build_object('document_type', p_document_type, 'document_id', v_doc.id));

  RETURN v_doc;
END;
$$;


ALTER FUNCTION "public"."register_mentor_document"("p_application_id" "uuid", "p_document_type" "text", "p_storage_path" "text", "p_original_filename" "text", "p_mime_type" "text", "p_size_bytes" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_mentor_application"("p_application_id" "uuid", "p_rejection_reason" "text") RETURNS "public"."mentor_applications"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_app public.mentor_applications;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  IF COALESCE(btrim(p_rejection_reason), '') = '' THEN
    RAISE EXCEPTION 'A rejection reason is required';
  END IF;

  SELECT * INTO v_app
  FROM public.mentor_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found';
  END IF;

  UPDATE public.mentor_applications
  SET status           = 'rejected',
      reviewed_at      = NOW(),
      reviewed_by      = auth.uid(),
      rejection_reason = btrim(p_rejection_reason),
      updated_at       = NOW()
  WHERE id = v_app.id
  RETURNING * INTO v_app;

  PERFORM public._log_mentor_app_audit(
    v_app.id, 'rejected', auth.uid(), btrim(p_rejection_reason), '{}'::jsonb);

  IF to_regclass('public.notifications') IS NOT NULL THEN
    BEGIN
      INSERT INTO public.notifications
        (user_id, title, message, type, event_type, entity_type, entity_id, link)
      VALUES
        (v_app.user_id,
         'Mentor application rejected',
         'Your mentor application was not approved: ' || btrim(p_rejection_reason),
         'error', 'mentor_application_rejected', 'mentor_application', v_app.id,
         '/mentor/verification');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN v_app;
END;
$$;


ALTER FUNCTION "public"."reject_mentor_application"("p_application_id" "uuid", "p_rejection_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."release_slot_hold"("p_hold_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_student uuid;
begin
  select student_id into v_student
  from public.booking_holds where id = p_hold_id and status = 'active';
  if v_student is null or v_student <> auth.uid() then
    raise exception 'not_authorized';
  end if;

  update public.booking_holds
  set status = 'released', released_at = now()
  where id = p_hold_id and status = 'active';
  return true;
end;
$$;


ALTER FUNCTION "public"."release_slot_hold"("p_hold_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_coupon_from_booking"("p_booking_id" "uuid", "p_seeker_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_booking public.bookings;
BEGIN
  -- A NULL seeker_id makes the ownership comparison below evaluate to NULL,
  -- which is not TRUE, so without this an unauthenticated caller would fall
  -- straight through it. The server always supplies the authenticated id; this
  -- keeps the function safe on its own terms too.
  IF p_seeker_id IS NULL THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, Sign in to use a coupon';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: BOOKING_NOT_FOUND, Booking not found';
  END IF;

  IF v_booking.seeker_id <> p_seeker_id THEN
    RAISE EXCEPTION 'code: FORBIDDEN_NOT_BOOKING_OWNER, This booking belongs to someone else';
  END IF;

  -- Only a payable booking can be repriced, for the same reason apply cannot
  -- reprice a moved-on booking: the amount is already committed.
  IF v_booking.status <> 'PAYMENT_PENDING' THEN
    RAISE EXCEPTION 'code: COUPON_BOOKING_NOT_PAYABLE, The coupon on this booking can no longer be changed';
  END IF;

  -- The same in-flight freeze apply enforces. Removing a code raises the amount
  -- back to base, so it would strand a live Razorpay order or an admin's
  -- pending proof just as badly as lowering it would.
  IF EXISTS (
    SELECT 1 FROM public.payments
    WHERE booking_id = v_booking.id
      AND status NOT IN ('FAILED', 'REJECTED')
  ) THEN
    RAISE EXCEPTION 'code: COUPON_PAYMENT_IN_FLIGHT, A payment for this booking is already in progress';
  END IF;

  UPDATE public.coupon_usage
  SET status = 'RELEASED',
      released_at = clock_timestamp(),
      release_reason = 'REMOVED_BY_SEEKER'
  WHERE booking_id = v_booking.id
    AND status = 'RESERVED';

  UPDATE public.bookings
  SET amount_inr = v_booking.base_amount_inr,
      discount_amount_inr = 0,
      coupon_id = NULL,
      coupon_code = NULL,
      updated_at = clock_timestamp()
  WHERE id = v_booking.id;

  RETURN jsonb_build_object(
    'success', true,
    'coupon_code', NULL,
    'discount_amount_inr', 0,
    'base_amount_inr', v_booking.base_amount_inr,
    'amount_inr', v_booking.base_amount_inr,
    'original_amount_inr', v_booking.original_amount_inr
  );
END;
$$;


ALTER FUNCTION "public"."remove_coupon_from_booking"("p_booking_id" "uuid", "p_seeker_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reopen_support_ticket"("p_ticket_code" "text", "p_actor_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_ticket public.support_tickets;
  v_role TEXT;
  v_text TEXT;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_id UUID;
BEGIN
  IF p_actor_id IS NULL
     OR NOT public.has_role(p_actor_id, 'admin')
        AND NOT public.has_role(p_actor_id, 'mentor')
        AND NOT public.has_role(p_actor_id, 'seeker') THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, You are not authorized to reopen this ticket';
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, You are not authorized to reopen this ticket';
  END IF;

  v_role := CASE
    WHEN public.has_role(p_actor_id, 'admin')  THEN 'admin'
    WHEN public.has_role(p_actor_id, 'mentor') THEN 'mentor'
    ELSE 'seeker'
  END;

  v_text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  IF v_text IS NULL OR length(v_text) > 4000 THEN
    RAISE EXCEPTION 'code: MESSAGE_INVALID, The reason must be between 1 and 4000 characters';
  END IF;

  SELECT * INTO v_ticket
  FROM public.support_tickets
  WHERE ticket_code = upper(btrim(p_ticket_code))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: TICKET_NOT_FOUND, Support ticket not found';
  END IF;

  IF v_role <> 'admin' AND v_ticket.requester_id <> p_actor_id THEN
    RAISE EXCEPTION 'code: FORBIDDEN_NOT_TICKET_OWNER, You are not authorized to view this support ticket';
  END IF;

  IF v_ticket.status = 'CLOSED' THEN
    RAISE EXCEPTION 'code: TICKET_CLOSED, This ticket is closed. Please raise a new support ticket.';
  END IF;
  IF v_ticket.status <> 'RESOLVED' THEN
    RAISE EXCEPTION 'code: INVALID_TRANSITION, Only a resolved ticket can be reopened';
  END IF;

  INSERT INTO public.support_messages (
    ticket_id, sender_id, sender_role, message, is_internal, created_at, updated_at
  ) VALUES (
    v_ticket.id, p_actor_id, v_role, v_text, FALSE, v_now, v_now
  );

  UPDATE public.support_tickets
  SET status = 'OPEN',
      resolution = NULL,
      resolved_at = NULL,
      resolved_by = NULL,
      last_message_at = v_now,
      updated_at = v_now
  WHERE id = v_ticket.id;

  INSERT INTO public.support_audit_events (ticket_id, actor_id, event_type, metadata, created_at)
  VALUES (v_ticket.id, p_actor_id, 'TICKET_REOPENED',
          jsonb_build_object('from', 'RESOLVED', 'to', 'OPEN'), v_now);

  -- Whichever side did not reopen it gets told.
  IF v_role = 'admin' THEN
    INSERT INTO public.notifications (
      user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, metadata, created_at
    ) VALUES (
      v_ticket.requester_id,
      'Support ticket reopened',
      'Support reopened your ticket ' || v_ticket.ticket_code || '.',
      'SYSTEM', 'SUPPORT_TICKET_REOPENED', 'support_ticket', v_ticket.ticket_code,
      format('/seeker/support?ticketCode=%s', v_ticket.ticket_code),
      FALSE, jsonb_build_object('ticketCode', v_ticket.ticket_code), v_now
    );
  ELSE
    FOR v_id IN SELECT u.user_id FROM public.user_roles u WHERE u.role = 'admin' LOOP
      INSERT INTO public.notifications (
        user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, metadata, created_at
      ) VALUES (
        v_id,
        'Support ticket reopened',
        v_ticket.requester_role || ' reopened support ticket ' || v_ticket.ticket_code || '.',
        'SYSTEM', 'SUPPORT_TICKET_REOPENED', 'support_ticket', v_ticket.ticket_code,
        format('/admin/support?ticketCode=%s', v_ticket.ticket_code),
        FALSE, jsonb_build_object('ticketCode', v_ticket.ticket_code), v_now
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'status', 'OPEN');
END;
$$;


ALTER FUNCTION "public"."reopen_support_ticket"("p_ticket_code" "text", "p_actor_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reschedule_booking"("p_booking_id" "uuid", "p_new_start" timestamp with time zone, "p_new_duration" integer DEFAULT NULL::integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_booking RECORD;
  v_user_id uuid := auth.uid();
  v_duration integer;
  v_conflict boolean;
BEGIN
  SELECT * INTO v_booking FROM sessions WHERE id = p_booking_id;
  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'booking_not_found';
  END IF;

  IF v_booking.student_id <> v_user_id AND v_booking.mentor_id <> v_user_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_booking.scheduled_time <= now() + interval '24 hours' THEN
    RAISE EXCEPTION 'reschedule_not_allowed';
  END IF;

  IF v_booking.status NOT IN ('payment_pending', 'mentor_pending', 'confirmed') THEN
    RAISE EXCEPTION 'reschedule_not_allowed';
  END IF;

  v_duration := COALESCE(p_new_duration, v_booking.duration_mins);

  -- Check new slot is valid (future, no conflicts)
  IF p_new_start <= now() THEN
    RAISE EXCEPTION 'past_slot';
  END IF;

  -- Global conflict check
  SELECT EXISTS(
    SELECT 1 FROM sessions s
    WHERE s.mentor_id = v_booking.mentor_id
      AND s.id <> p_booking_id
      AND s.status NOT IN ('cancelled', 'rejected')
      AND tstzrange(p_new_start, p_new_start + (v_duration || ' minutes')::interval)
        && tstzrange(s.scheduled_time, s.scheduled_time + (s.duration_mins || ' minutes')::interval)
  ) INTO v_conflict;

  IF v_conflict THEN
    RAISE EXCEPTION 'slot_conflict';
  END IF;

  -- Check active holds
  SELECT EXISTS(
    SELECT 1 FROM booking_holds h
    WHERE h.mentor_id = v_booking.mentor_id
      AND h.status = 'active'
      AND h.expires_at > now()
      AND tstzrange(p_new_start, p_new_start + (v_duration || ' minutes')::interval)
        && tstzrange(h.scheduled_time, h.scheduled_time + (h.duration_mins || ' minutes')::interval)
  ) INTO v_conflict;

  IF v_conflict THEN
    RAISE EXCEPTION 'slot_held';
  END IF;

  UPDATE sessions
  SET scheduled_time = p_new_start,
      duration_mins = v_duration
  WHERE id = p_booking_id;

  -- Notify both parties
  INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
  VALUES (v_booking.student_id, 'booking_rescheduled', 'Session rescheduled',
          'Your session has been rescheduled.', 'booking', p_booking_id);

  INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
  VALUES (v_booking.mentor_id, 'booking_rescheduled', 'Session rescheduled',
          'A session has been rescheduled.', 'booking', p_booking_id);

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id);
END;
$$;


ALTER FUNCTION "public"."reschedule_booking"("p_booking_id" "uuid", "p_new_start" timestamp with time zone, "p_new_duration" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reschedule_request_expiry_interval"() RETURNS interval
    LANGUAGE "sql" STABLE
    AS $$
  SELECT make_interval(
    hours => COALESCE(
      (SELECT reschedule_request_expiry_hours FROM public.platform_config WHERE id = 1),
      24
    )
  );
$$;


ALTER FUNCTION "public"."reschedule_request_expiry_interval"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reschedule_window_interval"() RETURNS interval
    LANGUAGE "sql" STABLE
    AS $$
  SELECT make_interval(
    mins => COALESCE(
      (SELECT reschedule_window_minutes FROM public.platform_config WHERE id = 1),
      10
    )
  );
$$;


ALTER FUNCTION "public"."reschedule_window_interval"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reset_login_failures"("p_identifier_key" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_previous_streak INTEGER;
BEGIN
  SELECT consecutive_failures INTO v_previous_streak
  FROM public.login_failure_trackers
  WHERE identifier_key = p_identifier_key;

  IF v_previous_streak IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM public.login_failure_trackers WHERE identifier_key = p_identifier_key;
  RETURN v_previous_streak;
END;
$$;


ALTER FUNCTION "public"."reset_login_failures"("p_identifier_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_session_state"("p_status" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_actual_ended_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_now" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    AS $$
DECLARE
  v_now   timestamptz := COALESCE(p_now, now());
  v_t5    timestamptz;
BEGIN
  -- Terminal non-attendable states win over every clock rule. A cancelled
  -- session must not read as "in progress" just because the clock says so.
  IF p_status IN ('CANCELLED', 'REJECTED') THEN
    RETURN 'CANCELLED';
  END IF;

  -- Fail closed on unusable timestamps. An unreadable window is never treated as
  -- "probably still open".
  IF p_start_time IS NULL OR p_end_time IS NULL
     OR NOT isfinite(p_start_time) OR NOT isfinite(p_end_time) THEN
    RETURN 'COMPLETED';
  END IF;

  -- A manual end is terminal regardless of the clock: a participant ended the
  -- room, so access is revoked immediately even if end_time is still ahead.
  IF p_actual_ended_at IS NOT NULL AND isfinite(p_actual_ended_at) THEN
    RETURN 'COMPLETED';
  END IF;

  IF p_status = 'COMPLETED' THEN
    RETURN 'COMPLETED';
  END IF;

  v_t5 := p_start_time - interval '5 minutes';

  -- After end_time. This branch is what makes a stale CONFIRMED row read as
  -- COMPLETED: the stored status is advisory, the clock is authoritative.
  IF v_now >= p_end_time THEN
    RETURN 'COMPLETED';
  END IF;

  -- From T-5 onwards access is open; the session is live only past its start.
  IF v_now >= v_t5 THEN
    IF v_now >= p_start_time THEN
      RETURN 'IN_PROGRESS';
    END IF;
    RETURN 'ACCESS_OPEN';
  END IF;

  RETURN 'SCHEDULED';
END;
$$;


ALTER FUNCTION "public"."resolve_session_state"("p_status" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_actual_ended_at" timestamp with time zone, "p_now" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."resolve_session_state"("p_status" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_actual_ended_at" timestamp with time zone, "p_now" timestamp with time zone) IS 'Single source of truth for session lifecycle. Derives SCHEDULED / ACCESS_OPEN / IN_PROGRESS / COMPLETED / CANCELLED from server time plus the booking window. Never called with a client-supplied clock in production.';



CREATE OR REPLACE FUNCTION "public"."resolve_support_ticket"("p_ticket_code" "text", "p_admin_id" "uuid", "p_resolution" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_ticket public.support_tickets;
  v_text TEXT;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_admin_id IS NULL OR NOT public.has_role(p_admin_id, 'admin') THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, Only an admin can resolve a support ticket';
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_admin_id THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, Only an admin can resolve a support ticket';
  END IF;

  v_text := NULLIF(btrim(COALESCE(p_resolution, '')), '');
  IF v_text IS NULL OR length(v_text) < 5 OR length(v_text) > 4000 THEN
    RAISE EXCEPTION 'code: RESOLUTION_REQUIRED, Write a resolution message for the user (5 to 4000 characters)';
  END IF;

  SELECT * INTO v_ticket
  FROM public.support_tickets
  WHERE ticket_code = upper(btrim(p_ticket_code))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: TICKET_NOT_FOUND, Support ticket not found';
  END IF;
  IF NOT public.is_valid_support_transition(v_ticket.status, 'RESOLVED') THEN
    RAISE EXCEPTION 'code: INVALID_TRANSITION, A % ticket cannot be resolved', v_ticket.status;
  END IF;

  INSERT INTO public.support_messages (
    ticket_id, sender_id, sender_role, message, is_internal, created_at, updated_at
  ) VALUES (
    v_ticket.id, p_admin_id, 'admin', v_text, FALSE, v_now, v_now
  );

  UPDATE public.support_tickets
  SET status = 'RESOLVED',
      resolution = v_text,
      resolved_at = v_now,
      resolved_by = p_admin_id,
      last_message_at = v_now,
      updated_at = v_now
  WHERE id = v_ticket.id;

  INSERT INTO public.support_audit_events (ticket_id, actor_id, event_type, metadata, created_at)
  VALUES (v_ticket.id, p_admin_id, 'TICKET_RESOLVED',
          jsonb_build_object('from', v_ticket.status, 'to', 'RESOLVED'), v_now);

  INSERT INTO public.notifications (
    user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, metadata, created_at
  ) VALUES (
    v_ticket.requester_id,
    'Support ticket resolved',
    'Your support ticket ' || v_ticket.ticket_code || ' has been resolved.',
    'SYSTEM', 'SUPPORT_TICKET_RESOLVED', 'support_ticket', v_ticket.ticket_code,
    format('/seeker/support?ticketCode=%s', v_ticket.ticket_code),
    FALSE, jsonb_build_object('ticketCode', v_ticket.ticket_code, 'resolution', v_text), v_now
  );

  RETURN jsonb_build_object('success', TRUE, 'status', 'RESOLVED', 'resolvedAt', v_now);
END;
$$;


ALTER FUNCTION "public"."resolve_support_ticket"("p_ticket_code" "text", "p_admin_id" "uuid", "p_resolution" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."respond_to_reschedule_request"("p_request_id" "uuid", "p_mentor_id" "uuid", "p_decision" "text", "p_reason" "text" DEFAULT NULL::"text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_request public.reschedule_requests;
  v_booking public.bookings;
  v_updated_booking public.bookings;
  v_mentor_tz TEXT;
  v_now timestamp with time zone;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'code: INVALID_DECISION, Decision must be either APPROVED or REJECTED';
  END IF;

  v_now := clock_timestamp();

  -- 1. Ownership. Only the mentor attached to this request may answer it.
  SELECT * INTO v_request
  FROM public.reschedule_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: RESCHEDULE_REQUEST_NOT_FOUND, Reschedule request not found';
  END IF;

  IF v_request.mentor_id <> p_mentor_id THEN
    RAISE EXCEPTION 'code: FORBIDDEN_NOT_BOOKING_OWNER, You are not authorized to respond to this reschedule request';
  END IF;

  -- 2. Open, and not already answered or expired.
  IF v_request.status <> 'PENDING' THEN
    RAISE EXCEPTION 'code: RESCHEDULE_REQUEST_CLOSED, This reschedule request has already been closed';
  END IF;

  IF v_request.expires_at <= v_now THEN
    UPDATE public.reschedule_requests
    SET status = 'EXPIRED', mentor_responded_at = v_now, updated_at = v_now
    WHERE id = v_request.id;

    UPDATE public.slot_holds
    SET status = 'EXPIRED'
    WHERE id = v_request.hold_id AND status = 'ACTIVE';

    RAISE EXCEPTION 'code: RESCHEDULE_REQUEST_EXPIRED, This reschedule request expired before it was answered';
  END IF;

  -- 3. Serialize on the mentor row so approval cannot race another booking.
  PERFORM 1 FROM public.profiles WHERE id = v_request.mentor_id FOR UPDATE;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_request.booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: BOOKING_NOT_FOUND, Booking not found';
  END IF;

  SELECT timezone INTO v_mentor_tz FROM public.profiles WHERE id = v_request.mentor_id;
  v_mentor_tz := COALESCE(v_mentor_tz, 'Asia/Kolkata');

  IF p_decision = 'REJECTED' THEN
    -- 4a. Release the requested slot so somebody else can take it. The
    --     booking is not read into any UPDATE.
    UPDATE public.slot_holds
    SET status = 'RELEASED'
    WHERE id = v_request.hold_id AND status = 'ACTIVE';

    UPDATE public.reschedule_requests
    SET status = 'REJECTED',
        mentor_response = 'REJECTED',
        rejection_reason = NULLIF(TRIM(COALESCE(p_reason, '')), ''),
        mentor_responded_at = v_now,
        updated_at = v_now
    WHERE id = v_request.id
    RETURNING * INTO v_request;

    INSERT INTO public.notifications (
      user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, created_at
    ) VALUES (
      v_request.seeker_id,
      'Reschedule request declined',
      CASE
        WHEN NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NOT NULL
          THEN format('Your mentor declined the requested time for booking %s. Reason: %s. Your original time is unchanged.',
                      v_booking.booking_code, TRIM(p_reason))
        ELSE format('Your mentor declined the requested time for booking %s. Your original time is unchanged.',
                    v_booking.booking_code)
      END,
      'BOOKING',
      'RESCHEDULE_REJECTED',
      'booking',
      v_booking.id::text,
      format('/seeker/booking-detail?bookingId=%s', v_booking.id),
      FALSE,
      v_now
    );

    RETURN json_build_object(
      'success', true,
      'decision', 'REJECTED',
      'request_id', v_request.id,
      'booking', json_build_object(
        'id', v_booking.id,
        'start_time', v_booking.start_time,
        'end_time', v_booking.end_time,
        'status', v_booking.status
      )
    );
  END IF;

  -- 5. APPROVED. The booking must still be the row the request was made
  --    against; a cancelled or completed booking cannot be moved.
  IF v_booking.status NOT IN ('MENTOR_PENDING', 'CONFIRMED') THEN
    UPDATE public.reschedule_requests
    SET status = 'CANCELLED', mentor_responded_at = v_now, updated_at = v_now
    WHERE id = v_request.id;

    UPDATE public.slot_holds
    SET status = 'RELEASED'
    WHERE id = v_request.hold_id AND status = 'ACTIVE';

    RAISE EXCEPTION 'code: BOOKING_NOT_RESCHEDULABLE, This booking is no longer in a reschedulable state';
  END IF;

  -- 6. The requested slot must still be free apart from this request's own
  --    hold. The request's hold is excluded: it is the reservation being
  --    converted, not a competing one.
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE mentor_id = v_request.mentor_id
      AND id <> v_booking.id
      AND status NOT IN ('CANCELLED', 'REJECTED')
      AND tstzrange(start_time, end_time, '[)') && tstzrange(v_request.requested_start_time, v_request.requested_end_time, '[)')
  ) THEN
    RAISE EXCEPTION 'code: SLOT_ALREADY_BOOKED, The requested slot has since been booked by someone else';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.slot_holds
    WHERE mentor_id = v_request.mentor_id
      AND id IS DISTINCT FROM v_request.hold_id
      AND status = 'ACTIVE'
      AND expires_at > v_now
      AND tstzrange(start_time, end_time, '[)') && tstzrange(v_request.requested_start_time, v_request.requested_end_time, '[)')
  ) THEN
    RAISE EXCEPTION 'code: SLOT_HELD_BY_OTHER, The requested slot is currently on hold by another seeker';
  END IF;

  -- 7. Release the old slot first, so the old reservation cannot survive a
  --    failure partway through this transaction. It is a separate row, so
  --    releasing it cannot affect the new one.
  IF v_booking.hold_id IS NOT NULL THEN
    UPDATE public.slot_holds
    SET status = 'RELEASED'
    WHERE id = v_booking.hold_id AND status = 'ACTIVE';
  END IF;

  -- 8. Convert this request's hold. CONVERTED is outside the
  --    `no_overlapping_active_holds` predicate, so the booking below is free
  --    to occupy exactly this interval.
  UPDATE public.slot_holds
  SET status = 'CONVERTED'
  WHERE id = v_request.hold_id AND status = 'ACTIVE';

  -- 9. Move the booking. mentor_id, segment_id, gig_id, amount_inr and status
  --    are deliberately absent: a reschedule is a time change and nothing else.
  UPDATE public.bookings
  SET start_time = v_request.requested_start_time,
      end_time = v_request.requested_end_time,
      hold_id = NULL,
      updated_at = v_now
  WHERE id = v_booking.id
  RETURNING * INTO v_updated_booking;

  UPDATE public.reschedule_requests
  SET status = 'APPROVED',
      mentor_response = 'ACCEPTED',
      rejection_reason = NULL,
      mentor_responded_at = v_now,
      updated_at = v_now
  WHERE id = v_request.id
  RETURNING * INTO v_request;

  INSERT INTO public.notifications (
    user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, created_at
  ) VALUES (
    v_request.seeker_id,
    'Reschedule approved',
    format('Your mentor moved booking %s to %s. Your original time has been released.',
           v_booking.booking_code,
           to_char(v_request.requested_start_time AT TIME ZONE v_mentor_tz, 'DD Mon, HH12:MI AM')),
    'BOOKING',
    'RESCHEDULE_APPROVED',
    'booking',
    v_booking.id::text,
    format('/seeker/booking-detail?bookingId=%s', v_booking.id),
    FALSE,
    v_now
  );

  RETURN json_build_object(
    'success', true,
    'decision', 'APPROVED',
    'request_id', v_request.id,
    'booking', json_build_object(
      'id', v_updated_booking.id,
      'mentor_id', v_updated_booking.mentor_id,
      'segment_id', v_updated_booking.segment_id,
      'gig_id', v_updated_booking.gig_id,
      'start_time', v_updated_booking.start_time,
      'end_time', v_updated_booking.end_time,
      'status', v_updated_booking.status
    )
  );
END;
$$;


ALTER FUNCTION "public"."respond_to_reschedule_request"("p_request_id" "uuid", "p_mentor_id" "uuid", "p_decision" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_mentor_document"("p_document_id" "uuid", "p_status" "text", "p_admin_note" "text" DEFAULT NULL::"text") RETURNS "public"."mentor_verification_documents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_doc public.mentor_verification_documents;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  IF p_status NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'Invalid status %', p_status;
  END IF;

  UPDATE public.mentor_verification_documents
  SET status = p_status, admin_note = p_admin_note,
      reviewed_at = NOW(), reviewed_by = auth.uid(), updated_at = NOW()
  WHERE id = p_document_id
  RETURNING * INTO v_doc;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document not found';
  END IF;

  PERFORM public._log_mentor_app_audit(
    v_doc.application_id, 'document_reviewed', auth.uid(), p_admin_note,
    jsonb_build_object('document_id', v_doc.id,
                       'document_type', v_doc.document_type,
                       'status', p_status));

  RETURN v_doc;
END;
$$;


ALTER FUNCTION "public"."review_mentor_document"("p_document_id" "uuid", "p_status" "text", "p_admin_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_payment"("p_payment_id" "uuid", "p_approve" boolean, "p_rejection_reason" "text" DEFAULT NULL::"text", "p_admin_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_payment public.payments;
  v_booking public.bookings;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_admin_id IS NULL OR NOT public.has_role(p_admin_id, 'admin')
    OR (auth.uid() IS NOT NULL AND auth.uid() <> p_admin_id) THEN
    RAISE EXCEPTION 'Unauthorized (code: UNAUTHORIZED)';
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found (code: PAYMENT_NOT_FOUND)'; END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_payment.booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found (code: BOOKING_NOT_FOUND)'; END IF;

  IF v_payment.status <> 'PENDING_VERIFICATION'
     OR v_booking.status NOT IN ('PAYMENT_PENDING', 'PENDING_VERIFICATION') THEN
    RAISE EXCEPTION 'Payment was already processed (code: PAYMENT_ALREADY_PROCESSED)';
  END IF;

  IF p_approve THEN
    UPDATE public.payments
    SET status = 'VERIFIED', verified_by = p_admin_id, verified_at = v_now, updated_at = v_now
    WHERE id = v_payment.id;
    UPDATE public.bookings SET status = 'MENTOR_PENDING', updated_at = v_now WHERE id = v_booking.id;
    INSERT INTO public.notifications
      (user_id, title, message, type, event_type, entity_type, entity_id, link, metadata)
    VALUES
      (v_booking.seeker_id, 'Payment approved',
       'Your payment was approved. The mentor will now confirm your session.',
       'PAYMENT', 'PAYMENT_APPROVED', 'booking', v_booking.id::text,
       '/seeker/bookings?bookingId=' || v_booking.id::text,
       jsonb_build_object('bookingId', v_booking.id, 'bookingCode', v_booking.booking_code)),
      (v_booking.mentor_id, 'New booking to confirm',
       'Payment for booking ' || v_booking.booking_code || ' was verified. Please add your meeting link.',
       'BOOKING', 'NEW_BOOKING', 'booking', v_booking.id::text,
       '/mentor/booking-detail?bookingId=' || v_booking.id::text,
       jsonb_build_object('bookingId', v_booking.id, 'bookingCode', v_booking.booking_code));
  ELSE
    UPDATE public.payments
    SET status = 'REJECTED',
        rejection_reason = COALESCE(NULLIF(trim(p_rejection_reason), ''), 'Payment proof was rejected.'),
        verified_by = p_admin_id, verified_at = v_now, updated_at = v_now
    WHERE id = v_payment.id;
    UPDATE public.bookings SET status = 'REJECTED', updated_at = v_now WHERE id = v_booking.id;
    IF v_booking.hold_id IS NOT NULL THEN
      UPDATE public.slot_holds SET status = 'RELEASED'
      WHERE id = v_booking.hold_id AND status IN ('ACTIVE', 'CONVERTED');
    END IF;
    INSERT INTO public.notifications
      (user_id, title, message, type, event_type, entity_type, entity_id, link, metadata)
    VALUES
      (v_booking.seeker_id, 'Payment rejected',
       'Your payment proof was rejected. Please create a new booking after reviewing the reason.',
       'PAYMENT', 'PAYMENT_REJECTED', 'booking', v_booking.id::text,
       '/seeker/bookings?bookingId=' || v_booking.id::text,
       jsonb_build_object(
         'bookingId', v_booking.id,
         'bookingCode', v_booking.booking_code,
         'rejectionReason', COALESCE(NULLIF(trim(p_rejection_reason), ''), 'Payment proof was rejected.')));
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'payment_id', v_payment.id,
    'booking_id', v_booking.id,
    'approved', p_approve
  );
END;
$$;


ALTER FUNCTION "public"."review_payment"("p_payment_id" "uuid", "p_approve" boolean, "p_rejection_reason" "text", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_mentor_application"("p_full_name" "text", "p_bio" "text", "p_headline" "text" DEFAULT NULL::"text", "p_years_of_experience" integer DEFAULT NULL::integer, "p_timezone" "text" DEFAULT 'Asia/Kolkata'::"text", "p_requested_segment_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS "public"."mentor_applications"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_app public.mentor_applications;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF COALESCE(btrim(p_full_name), '') = '' THEN
    RAISE EXCEPTION 'Full name is required';
  END IF;

  IF p_years_of_experience IS NOT NULL
     AND (p_years_of_experience < 0 OR p_years_of_experience > 80) THEN
    RAISE EXCEPTION 'Years of experience must be between 0 and 80';
  END IF;

  SELECT * INTO v_app
  FROM public.mentor_applications
  WHERE user_id = auth.uid()
  FOR UPDATE;

  -- Already approved: a live mentor edits mentor_profiles, not the application.
  IF v_app.id IS NOT NULL AND v_app.status = 'approved' THEN
    RAISE EXCEPTION 'Application already approved; edit your mentor profile instead';
  END IF;

  -- Already in the review queue: it is locked until an admin responds.
  IF v_app.id IS NOT NULL AND v_app.status = 'pending_review' THEN
    RAISE EXCEPTION 'Application is under review and cannot be edited';
  END IF;

  IF v_app.id IS NULL THEN
    INSERT INTO public.mentor_applications
      (user_id, status, full_name, headline, bio,
       years_of_experience, timezone, requested_segment_ids)
    VALUES
      (auth.uid(), 'draft', btrim(p_full_name), NULLIF(btrim(COALESCE(p_headline,'')), ''),
       COALESCE(p_bio, ''), p_years_of_experience, COALESCE(p_timezone,'Asia/Kolkata'),
       p_requested_segment_ids)
    RETURNING * INTO v_app;
  ELSE
    UPDATE public.mentor_applications
    SET full_name            = btrim(p_full_name),
        headline             = NULLIF(btrim(COALESCE(p_headline,'')), ''),
        bio                  = COALESCE(p_bio, ''),
        years_of_experience  = p_years_of_experience,
        timezone             = COALESCE(p_timezone,'Asia/Kolkata'),
        requested_segment_ids= p_requested_segment_ids,
        -- A resubmission clears the old rejection reason.
        rejection_reason     = NULL
    WHERE id = v_app.id
    RETURNING * INTO v_app;
  END IF;

  RETURN v_app;
END;
$$;


ALTER FUNCTION "public"."save_mentor_application"("p_full_name" "text", "p_bio" "text", "p_headline" "text", "p_years_of_experience" integer, "p_timezone" "text", "p_requested_segment_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seeker_cancel_booking"("p_booking_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_booking RECORD;
  v_student_id uuid := auth.uid();
BEGIN
  SELECT * INTO v_booking FROM sessions WHERE id = p_booking_id;
  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'booking_not_found';
  END IF;
  
  IF v_booking.student_id <> v_student_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_booking.scheduled_time <= now() + interval '24 hours' THEN
    RAISE EXCEPTION 'cancellation_not_allowed';
  END IF;

  IF v_booking.status NOT IN ('payment_pending', 'mentor_pending') THEN
    RAISE EXCEPTION 'cancellation_not_allowed';
  END IF;

  UPDATE sessions SET status = 'cancelled' WHERE id = p_booking_id;

  UPDATE booking_holds
  SET status = 'released', released_at = now()
  WHERE booking_id = p_booking_id AND status = 'active';

  -- Notify mentor and admin
  INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
  VALUES (v_booking.mentor_id, 'seeker_cancelled', 'Session cancelled by seeker',
          'The seeker has cancelled the session.', 'booking', p_booking_id);

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id);
END;
$$;


ALTER FUNCTION "public"."seeker_cancel_booking"("p_booking_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_meeting_link"("p_booking_id" "uuid", "p_meeting_link" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_booking RECORD;
  v_mentor_id uuid := auth.uid();
BEGIN
  SELECT * INTO v_booking FROM sessions WHERE id = p_booking_id;
  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'booking_not_found';
  END IF;

  IF v_booking.mentor_id <> v_mentor_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_booking.status NOT IN ('mentor_pending') THEN
    RAISE EXCEPTION 'booking_not_mentor_pending';
  END IF;

  IF v_booking.status IN ('cancelled', 'rejected') THEN
    RAISE EXCEPTION 'booking_cancelled';
  END IF;

  IF p_meeting_link IS NULL OR p_meeting_link = '' THEN
    RAISE EXCEPTION 'meeting_link_required';
  END IF;

  IF NOT p_meeting_link ~* '^https://' THEN
    RAISE EXCEPTION 'invalid_meeting_link';
  END IF;

  UPDATE sessions
  SET meeting_link = p_meeting_link,
      meeting_link_added_at = now(),
      meeting_link_overdue = false
  WHERE id = p_booking_id;

  -- Notify seeker that meeting link was added
  INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
  VALUES (v_booking.student_id, 'meeting_link_added', 'Meeting link added',
          'Your mentor has added a meeting link. It will be visible 5 minutes before the session.',
          'booking', p_booking_id);

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id);
END;
$$;


ALTER FUNCTION "public"."set_meeting_link"("p_booking_id" "uuid", "p_meeting_link" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_mentor_application"() RETURNS "public"."mentor_applications"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_app          public.mentor_applications;
  v_missing      TEXT;
  v_was_rejected BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_app
  FROM public.mentor_applications
  WHERE user_id = auth.uid()
  FOR UPDATE;

  IF v_app.id IS NULL THEN
    RAISE EXCEPTION 'No application found. Save a draft first.';
  END IF;

  IF v_app.status NOT IN ('draft','rejected') THEN
    RAISE EXCEPTION 'Application cannot be submitted from status %', v_app.status;
  END IF;

  IF COALESCE(btrim(v_app.full_name), '') = '' THEN
    RAISE EXCEPTION 'Full name is required';
  END IF;

  IF COALESCE(btrim(v_app.bio), '') = '' THEN
    RAISE EXCEPTION 'Bio is required';
  END IF;

  SELECT string_agg(t.code, ', ' ORDER BY t.sort_order) INTO v_missing
  FROM public.mentor_document_types t
  WHERE t.is_active = TRUE AND t.is_required = TRUE
    AND NOT EXISTS (
      SELECT 1 FROM public.mentor_verification_documents d
      WHERE d.application_id = v_app.id AND d.document_type = t.code
    );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing required document(s): %', v_missing;
  END IF;

  v_was_rejected := (v_app.status = 'rejected');

  UPDATE public.mentor_applications
  SET status            = 'pending_review',
      submitted_at      = NOW(),
      rejection_reason  = NULL,
      updated_at        = NOW()
  WHERE id = v_app.id
  RETURNING * INTO v_app;

  PERFORM public._log_mentor_app_audit(
    v_app.id, 'submitted_for_review', NULL, NULL,
    jsonb_build_object('resubmission', v_was_rejected));

  RETURN v_app;
END;
$$;


ALTER FUNCTION "public"."submit_mentor_application"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_mentor_application"("p_application_id" "uuid") RETURNS "public"."mentor_applications"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_app public.mentor_applications;
  v_required_types TEXT[];
  v_uploaded_types TEXT[];
BEGIN
  -- Lock application row
  SELECT * INTO v_app
  FROM public.mentor_applications
  WHERE id = p_application_id AND user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found or not authorized';
  END IF;

  IF v_app.status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'Application cannot be submitted from status: %', v_app.status;
  END IF;

  -- Validate required info
  IF v_app.full_name IS NULL OR v_app.full_name = '' THEN
    RAISE EXCEPTION 'Full name is required';
  END IF;

  -- Check required document types exist (at least one document per required type)
  SELECT array_agg(code) INTO v_required_types
  FROM public.mentor_document_types
  WHERE is_required = TRUE AND is_active = TRUE;

  IF v_required_types IS NOT NULL AND array_length(v_required_types, 1) > 0 THEN
    SELECT array_agg(DISTINCT document_type) INTO v_uploaded_types
    FROM public.mentor_verification_documents
    WHERE application_id = p_application_id
      AND status IN ('pending', 'approved');

    IF v_uploaded_types IS NULL OR NOT (v_required_types <@ v_uploaded_types) THEN
      RAISE EXCEPTION 'All required documents must be uploaded before submission';
    END IF;
  END IF;

  -- Update status
  UPDATE public.mentor_applications
  SET status = 'pending_review',
      submitted_at = NOW(),
      updated_at = NOW(),
      rejection_reason = NULL -- clear previous rejection reason on resubmit
  WHERE id = p_application_id
  RETURNING * INTO v_app;

  -- Log audit
  PERFORM public._log_mentor_app_audit(v_app.id, 'submitted', NULL, NULL, jsonb_build_object('previous_status', 'draft_or_rejected'));

  -- Notifications
  -- Applicant
  INSERT INTO public.notifications (user_id, title, message, type, event_type, entity_type, entity_id, link)
  VALUES (
    v_app.user_id,
    'Verification Submitted',
    'Your mentor application has been submitted successfully. Our Admin team will review your information and documents.',
    'SYSTEM',
    'MENTOR_APPLICATION_SUBMITTED',
    'mentor_application',
    v_app.id::text,
    '/mentor/verification'
  );

  -- Admins
  INSERT INTO public.notifications (user_id, title, message, type, event_type, entity_type, entity_id, link)
  SELECT ur.user_id,
    'New Mentor Verification Submitted',
    'A new mentor application from ' || v_app.full_name || ' requires review.',
    'ADMIN',
    'ADMIN_MENTOR_APPLICATION_SUBMITTED',
    'mentor_application',
    v_app.id::text,
    '/admin/mentor-verification/' || v_app.id
  FROM public.user_roles ur
  WHERE ur.role = 'admin';

  RETURN v_app;
END;
$$;


ALTER FUNCTION "public"."submit_mentor_application"("p_application_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."support_ticket_metrics"("p_caller_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- `p_caller_id` is the verified actor passed by the server, not `auth.uid()`.
  -- The Express layer calls RPCs with the service-role client, where `auth.uid()`
  -- is always NULL, so an auth.uid()-based check here would reject every real
  -- admin while passing for nobody.
  IF p_caller_id IS NULL OR NOT public.has_role(p_caller_id, 'admin') THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, Only an admin can read support metrics';
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'open',        (SELECT count(*) FROM public.support_tickets WHERE status = 'OPEN'),
    'inProgress',  (SELECT count(*) FROM public.support_tickets WHERE status = 'IN_PROGRESS'),
    'waitingForUser', (SELECT count(*) FROM public.support_tickets WHERE status = 'WAITING_FOR_USER'),
    'urgent',      (SELECT count(*) FROM public.support_tickets WHERE priority = 'URGENT' AND status NOT IN ('RESOLVED','CLOSED')),
    'unassigned',  (SELECT count(*) FROM public.support_tickets WHERE assigned_admin_id IS NULL AND status NOT IN ('RESOLVED','CLOSED')),
    'resolvedToday', (
      SELECT count(*) FROM public.support_tickets
      WHERE status = 'RESOLVED' AND resolved_at >= date_trunc('day', now())
    )
  );
END;
$$;


ALTER FUNCTION "public"."support_ticket_metrics"("p_caller_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_coupon_usage_for_booking"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- A trigger function must return `NEW` (or NULL) for every path; a bare
  -- RETURN is only legal for a `RETURNS void` function, which this is not.
  -- `NEW` keeps the updated row exactly as written by the caller.
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- PAID -> the reservation becomes a permanent redemption.
  IF NEW.status = 'MENTOR_PENDING' THEN
    UPDATE public.coupon_usage
    SET status = 'REDEEMED',
        redeemed_at = COALESCE(redeemed_at, clock_timestamp()),
        release_reason = NULL
    WHERE booking_id = NEW.id
      AND status = 'RESERVED';
    RETURN NEW;
  END IF;

  -- DEAD END -> the claim on the coupon is given back.
  IF NEW.status IN ('CANCELLED', 'REJECTED') THEN
    UPDATE public.coupon_usage
    SET status = 'RELEASED',
        released_at = COALESCE(released_at, clock_timestamp()),
        release_reason = COALESCE(release_reason, 'BOOKING_' || NEW.status)
    WHERE booking_id = NEW.id
      AND status = 'RESERVED';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_coupon_usage_for_booking"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_availability_slots_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."update_availability_slots_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_booking_capacity_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."update_booking_capacity_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_booking_rules_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."update_booking_rules_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_categories_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."update_categories_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_payment_orders_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."update_payment_orders_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_sessions_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."update_sessions_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_support_ticket"("p_ticket_code" "text", "p_admin_id" "uuid", "p_status" "text" DEFAULT NULL::"text", "p_priority" "text" DEFAULT NULL::"text", "p_assigned_admin_id" "uuid" DEFAULT NULL::"uuid", "p_unassign" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_ticket public.support_tickets;
  v_before TEXT;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_admin_id IS NULL OR NOT public.has_role(p_admin_id, 'admin') THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, Only an admin can change a support ticket';
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_admin_id THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, Only an admin can change a support ticket';
  END IF;

  SELECT * INTO v_ticket
  FROM public.support_tickets
  WHERE ticket_code = upper(btrim(p_ticket_code))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: TICKET_NOT_FOUND, Support ticket not found';
  END IF;

  IF p_status IS NULL AND p_priority IS NULL AND p_assigned_admin_id IS NULL AND NOT p_unassign THEN
    RAISE EXCEPTION 'code: NO_CHANGES, No changes were requested';
  END IF;

  -- ---- status ------------------------------------------------------------
  IF p_status IS NOT NULL THEN
    IF p_status NOT IN ('OPEN','IN_PROGRESS','WAITING_FOR_USER','RESOLVED','CLOSED') THEN
      RAISE EXCEPTION 'code: STATUS_INVALID, Unknown ticket status';
    END IF;
    IF p_status = 'RESOLVED' THEN
      RAISE EXCEPTION 'code: USE_RESOLVE_ENDPOINT, Resolving a ticket requires a resolution message';
    END IF;
    IF NOT public.is_valid_support_transition(v_ticket.status, p_status) THEN
      RAISE EXCEPTION 'code: INVALID_TRANSITION, A % ticket cannot move to %', v_ticket.status, p_status;
    END IF;

    v_before := v_ticket.status;

    UPDATE public.support_tickets
    SET status = p_status,
        closed_at  = CASE WHEN p_status = 'CLOSED' THEN v_now ELSE closed_at END,
        closed_by  = CASE WHEN p_status = 'CLOSED' THEN p_admin_id ELSE closed_by END,
        updated_at = v_now
    WHERE id = v_ticket.id
    RETURNING * INTO v_ticket;

    INSERT INTO public.support_audit_events (ticket_id, actor_id, event_type, metadata, created_at)
    VALUES (v_ticket.id, p_admin_id, 'TICKET_STATUS_CHANGED',
            jsonb_build_object('from', v_before, 'to', p_status), v_now);

    -- "We need more information from you" is the one admin status change the
    -- user must act on, so it is the one that notifies them.
    IF p_status = 'WAITING_FOR_USER' THEN
      INSERT INTO public.notifications (
        user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, metadata, created_at
      ) VALUES (
        v_ticket.requester_id,
        'Support needs more information',
        'Support is waiting for information from you on ticket ' || v_ticket.ticket_code || '.',
        'SYSTEM', 'SUPPORT_TICKET_WAITING_FOR_USER', 'support_ticket', v_ticket.ticket_code,
        format('/seeker/support?ticketCode=%s', v_ticket.ticket_code),
        FALSE, jsonb_build_object('ticketCode', v_ticket.ticket_code), v_now
      );
    END IF;
  END IF;

  -- ---- priority ----------------------------------------------------------
  IF p_priority IS NOT NULL THEN
    IF p_priority NOT IN ('LOW','NORMAL','HIGH','URGENT') THEN
      RAISE EXCEPTION 'code: PRIORITY_INVALID, Unknown ticket priority';
    END IF;
    v_before := v_ticket.priority;
    UPDATE public.support_tickets SET priority = p_priority, updated_at = v_now WHERE id = v_ticket.id
    RETURNING * INTO v_ticket;
    INSERT INTO public.support_audit_events (ticket_id, actor_id, event_type, metadata, created_at)
    VALUES (v_ticket.id, p_admin_id, 'TICKET_PRIORITY_CHANGED',
            jsonb_build_object('from', v_before, 'to', p_priority), v_now);
  END IF;

  -- ---- assignment --------------------------------------------------------
  IF p_assigned_admin_id IS NOT NULL OR p_unassign THEN
    IF p_assigned_admin_id IS NOT NULL AND NOT public.has_role(p_assigned_admin_id, 'admin') THEN
      RAISE EXCEPTION 'code: ASSIGNEE_NOT_ADMIN, A ticket can only be assigned to an admin';
    END IF;

    v_before := v_ticket.assigned_admin_id::TEXT;

    UPDATE public.support_tickets
    SET assigned_admin_id = CASE WHEN p_unassign THEN NULL ELSE p_assigned_admin_id END,
        updated_at = v_now
    WHERE id = v_ticket.id
    RETURNING * INTO v_ticket;

    INSERT INTO public.support_audit_events (ticket_id, actor_id, event_type, metadata, created_at)
    VALUES (v_ticket.id, p_admin_id, 'TICKET_ASSIGNED',
            jsonb_build_object('from', v_before, 'to', v_ticket.assigned_admin_id::TEXT), v_now);

    IF v_ticket.assigned_admin_id IS NOT NULL THEN
      INSERT INTO public.notifications (
        user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, metadata, created_at
      ) VALUES (
        v_ticket.assigned_admin_id,
        'Support ticket assigned to you',
        'Support ticket ' || v_ticket.ticket_code || ' has been assigned to you.',
        'SYSTEM', 'SUPPORT_TICKET_ASSIGNED', 'support_ticket', v_ticket.ticket_code,
        format('/admin/support?ticketCode=%s', v_ticket.ticket_code),
        FALSE, jsonb_build_object('ticketCode', v_ticket.ticket_code), v_now
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'status', v_ticket.status,
    'priority', v_ticket.priority,
    'assignedAdminId', v_ticket.assigned_admin_id,
    'updatedAt', v_ticket.updated_at
  );
END;
$$;


ALTER FUNCTION "public"."update_support_ticket"("p_ticket_code" "text", "p_admin_id" "uuid", "p_status" "text", "p_priority" "text", "p_assigned_admin_id" "uuid", "p_unassign" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upload_payment_proof"("p_payment_id" "uuid", "p_storage_path" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_payment RECORD;
  v_student_id uuid := auth.uid();
  v_hold_expired boolean;
BEGIN
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;
  IF v_payment IS NULL THEN
    RAISE EXCEPTION 'payment_not_found';
  END IF;

  IF v_payment.student_id <> v_student_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_payment.status <> 'pending' THEN
    RAISE EXCEPTION 'payment_not_pending';
  END IF;

  -- Check that the associated hold is still active (not expired/released)
  SELECT EXISTS(
    SELECT 1 FROM booking_holds h
    WHERE h.booking_id = v_payment.booking_id
      AND h.status = 'active'
      AND h.expires_at > now()
  ) INTO v_hold_expired;

  IF NOT v_hold_expired THEN
    RAISE EXCEPTION 'slot_hold_expired';
  END IF;

  UPDATE payments
  SET proof_storage_path = p_storage_path,
      proof_uploaded_at = now(),
      submitted_at = now()
  WHERE id = p_payment_id;

  -- Notify admins that proof is ready for review
  INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
  SELECT user_id, 'payment_proof_submitted', 'Payment proof submitted',
         'A student has submitted payment proof for review.',
         'payment', p_payment_id
  FROM user_roles WHERE role = 'admin';

  RETURN jsonb_build_object('success', true, 'payment_id', p_payment_id);
END;
$$;


ALTER FUNCTION "public"."upload_payment_proof"("p_payment_id" "uuid", "p_storage_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_mentor_document"("p_application_id" "uuid", "p_document_type" "text", "p_storage_path" "text", "p_original_filename" "text", "p_mime_type" "text", "p_size_bytes" bigint) RETURNS "public"."mentor_verification_documents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_doc public.mentor_verification_documents;
  v_app public.mentor_applications;
BEGIN
  -- Verify ownership and app status
  SELECT * INTO v_app
  FROM public.mentor_applications
  WHERE id = p_application_id AND user_id = auth.uid() AND status IN ('draft', 'rejected')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found or not editable';
  END IF;

  -- Validate document type exists
  IF NOT EXISTS (SELECT 1 FROM public.mentor_document_types WHERE code = p_document_type AND is_active = TRUE) THEN
    RAISE EXCEPTION 'Invalid document type';
  END IF;

  -- Validate MIME type
  IF p_mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') THEN
    RAISE EXCEPTION 'Unsupported file type';
  END IF;

  -- Validate size (5MB)
  IF p_size_bytes > 5242880 THEN
    RAISE EXCEPTION 'File size exceeds 5MB limit';
  END IF;

  -- Upsert document
  INSERT INTO public.mentor_verification_documents (application_id, document_type, storage_path, original_filename, mime_type, size_bytes, status, updated_at)
  VALUES (p_application_id, p_document_type, p_storage_path, p_original_filename, p_mime_type, p_size_bytes, 'pending', NOW())
  ON CONFLICT (application_id, document_type) DO UPDATE
    SET storage_path = EXCLUDED.storage_path,
        original_filename = EXCLUDED.original_filename,
        mime_type = EXCLUDED.mime_type,
        size_bytes = EXCLUDED.size_bytes,
        status = 'pending',
        updated_at = NOW()
  RETURNING * INTO v_doc;

  PERFORM public._log_mentor_app_audit(p_application_id, 'document_uploaded', NULL, NULL, jsonb_build_object('document_type', p_document_type, 'document_id', v_doc.id));

  RETURN v_doc;
END;
$$;


ALTER FUNCTION "public"."upsert_mentor_document"("p_application_id" "uuid", "p_document_type" "text", "p_storage_path" "text", "p_original_filename" "text", "p_mime_type" "text", "p_size_bytes" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_auth_otp"("p_otp_id" "uuid", "p_otp" "text", "p_otp_hash" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_row public.auth_otps%ROWTYPE;
BEGIN
  IF p_otp_id IS NULL OR p_otp IS NULL OR p_otp !~ '^[0-9]{6}$' THEN
    RETURN false;
  END IF;
  IF p_otp_hash IS NULL OR p_otp_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;

  SELECT * INTO v_row
  FROM public.auth_otps
  WHERE id = p_otp_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_row.verified THEN
    RETURN false;
  END IF;
  IF v_row.expires_at < now() THEN
    RETURN false;
  END IF;
  IF v_row.attempts >= 5 THEN
    RETURN false;
  END IF;

  IF v_row.otp_hash <> p_otp_hash THEN
    UPDATE public.auth_otps SET attempts = attempts + 1 WHERE id = p_otp_id;
    RETURN false;
  END IF;

  UPDATE public.auth_otps
  SET verified = true, attempts = attempts + 1
  WHERE id = p_otp_id;

  RETURN true;
END;
$_$;


ALTER FUNCTION "public"."verify_auth_otp"("p_otp_id" "uuid", "p_otp" "text", "p_otp_hash" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "mvp"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid",
    "details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "mvp"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "mvp"."bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mentor_id" "uuid" NOT NULL,
    "seeker_id" "uuid" NOT NULL,
    "segment_id" "uuid" NOT NULL,
    "gig_id" "uuid",
    "slot_start" timestamp with time zone NOT NULL,
    "slot_end" timestamp with time zone NOT NULL,
    "status" "mvp"."booking_status" DEFAULT 'payment_pending'::"mvp"."booking_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "mvp"."bookings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "mvp"."gigs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mentor_id" "uuid" NOT NULL,
    "segment_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "duration_minutes" integer DEFAULT 60 NOT NULL,
    "price" numeric(10,2) DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'INR'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "mvp"."gigs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "mvp"."mentor_availability" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mentor_id" "uuid" NOT NULL,
    "day_of_week" "mvp"."availability_day" NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "mvp"."mentor_availability" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "mvp"."mentor_availability_exceptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mentor_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "status" "mvp"."segment_status" DEFAULT 'active'::"mvp"."segment_status" NOT NULL,
    "start_time" time without time zone,
    "end_time" time without time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "mvp"."mentor_availability_exceptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "mvp"."mentor_profiles" (
    "user_id" "uuid" NOT NULL,
    "display_name" "text" DEFAULT ''::"text" NOT NULL,
    "profile_photo" "text",
    "short_bio" "text",
    "timezone" "text" DEFAULT 'UTC'::"text",
    "approval_status" "mvp"."mentor_approval_status" DEFAULT 'pending'::"mvp"."mentor_approval_status" NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "mvp"."mentor_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "mvp"."mentor_segments" (
    "mentor_id" "uuid" NOT NULL,
    "segment_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "mvp"."mentor_segments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "mvp"."mentor_time_reservations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mentor_id" "uuid" NOT NULL,
    "slot_start" timestamp with time zone NOT NULL,
    "slot_end" timestamp with time zone NOT NULL,
    "source_type" "text" NOT NULL,
    "source_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "mvp"."mentor_time_reservations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "mvp"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text",
    "related_entity_type" "text",
    "related_entity_id" "uuid",
    "is_read" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "mvp"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "mvp"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "status" "mvp"."payment_status" DEFAULT 'pending'::"mvp"."payment_status" NOT NULL,
    "amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'INR'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "mvp"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "mvp"."profiles" (
    "id" "uuid" NOT NULL,
    "display_name" "text" DEFAULT ''::"text" NOT NULL,
    "profile_photo" "text",
    "short_bio" "text",
    "timezone" "text" DEFAULT 'UTC'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "mvp"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "mvp"."seeker_profiles" (
    "user_id" "uuid" NOT NULL,
    "display_name" "text" DEFAULT ''::"text" NOT NULL,
    "profile_photo" "text",
    "short_bio" "text",
    "timezone" "text" DEFAULT 'UTC'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "mvp"."seeker_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "mvp"."segments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "is_active" "mvp"."segment_status" DEFAULT 'active'::"mvp"."segment_status" NOT NULL,
    "priority" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "mvp"."segments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "mvp"."session_workspaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "mentor_notes" "text",
    "key_takeaways" "text",
    "suggestions" "text",
    "next_steps" "text",
    "follow_up_recommendation" "text",
    "follow_up_timeframe" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "mvp"."session_workspaces" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "mvp"."slot_holds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mentor_id" "uuid" NOT NULL,
    "seeker_id" "uuid" NOT NULL,
    "slot_start" timestamp with time zone NOT NULL,
    "slot_end" timestamp with time zone NOT NULL,
    "status" "mvp"."hold_status" DEFAULT 'active'::"mvp"."hold_status" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "released_at" timestamp with time zone,
    "booking_id" "uuid",
    CONSTRAINT "slot_holds_check" CHECK (("expires_at" = ("created_at" + '00:15:00'::interval)))
);


ALTER TABLE "mvp"."slot_holds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "mvp"."user_roles" (
    "user_id" "uuid" NOT NULL,
    "role" "mvp"."app_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "mvp"."user_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coupon_usage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coupon_id" "uuid" NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "seeker_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'RESERVED'::"text" NOT NULL,
    "discount_amount_inr" integer NOT NULL,
    "reserved_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "redeemed_at" timestamp with time zone,
    "released_at" timestamp with time zone,
    "release_reason" "text",
    CONSTRAINT "coupon_usage_discount_amount_inr_check" CHECK (("discount_amount_inr" > 0)),
    CONSTRAINT "coupon_usage_release_reason_check" CHECK ((("release_reason" IS NULL) OR ("length"("release_reason") <= 200))),
    CONSTRAINT "coupon_usage_status_check" CHECK (("status" = ANY (ARRAY['RESERVED'::"text", 'REDEEMED'::"text", 'RELEASED'::"text"])))
);


ALTER TABLE "public"."coupon_usage" OWNER TO "postgres";


COMMENT ON COLUMN "public"."coupon_usage"."status" IS 'RESERVED holds a place in the coupon limit and is released if the seeker never pays. REDEEMED is permanent. Only RESERVED and REDEEMED count against max_total_uses / max_uses_per_user.';



CREATE TABLE IF NOT EXISTS "public"."coupons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "description" "text",
    "discount_type" "text" NOT NULL,
    "discount_value" integer NOT NULL,
    "max_discount_inr" integer,
    "min_order_amount_inr" integer DEFAULT 0 NOT NULL,
    "segment_id" "uuid",
    "mentor_id" "uuid",
    "max_total_uses" integer,
    "max_uses_per_user" integer,
    "starts_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "status" "text" DEFAULT 'ACTIVE'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_coupon_not_fully_scoped" CHECK ((NOT (("segment_id" IS NOT NULL) AND ("mentor_id" IS NOT NULL)))),
    CONSTRAINT "coupons_check" CHECK ((("discount_value" > 0) AND (("discount_type" = 'FIXED'::"text") OR ("discount_value" <= 100)))),
    CONSTRAINT "coupons_check1" CHECK ((("max_discount_inr" IS NULL) OR (("max_discount_inr" > 0) AND ("discount_type" = 'PERCENTAGE'::"text")))),
    CONSTRAINT "coupons_check2" CHECK ((("expires_at" IS NULL) OR ("expires_at" > "starts_at"))),
    CONSTRAINT "coupons_code_check" CHECK (("code" ~ '^[A-Z0-9_]{4,24}$'::"text")),
    CONSTRAINT "coupons_description_check" CHECK ((("description" IS NULL) OR ("length"("description") <= 300))),
    CONSTRAINT "coupons_discount_type_check" CHECK (("discount_type" = ANY (ARRAY['PERCENTAGE'::"text", 'FIXED'::"text"]))),
    CONSTRAINT "coupons_max_total_uses_check" CHECK ((("max_total_uses" IS NULL) OR ("max_total_uses" > 0))),
    CONSTRAINT "coupons_max_uses_per_user_check" CHECK ((("max_uses_per_user" IS NULL) OR ("max_uses_per_user" > 0))),
    CONSTRAINT "coupons_min_order_amount_inr_check" CHECK (("min_order_amount_inr" >= 0)),
    CONSTRAINT "coupons_status_check" CHECK (("status" = ANY (ARRAY['ACTIVE'::"text", 'INACTIVE'::"text", 'ARCHIVED'::"text"])))
);


ALTER TABLE "public"."coupons" OWNER TO "postgres";


COMMENT ON TABLE "public"."coupons" IS 'Admin-authored discount codes. Targeting is OR: a coupon with only segment_id applies to every mentor in that segment, and with only mentor_id to every gig of that mentor.';



CREATE TABLE IF NOT EXISTS "public"."gig_topics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "gig_id" "uuid" NOT NULL,
    "topic_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."gig_topics" OWNER TO "postgres";


COMMENT ON TABLE "public"."gig_topics" IS 'Many-to-many link between a gig and the segment topics it covers. Names live on segment_topics, never duplicated here.';



CREATE TABLE IF NOT EXISTS "public"."gigs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mentor_id" "uuid" NOT NULL,
    "segment_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "duration_minutes" integer NOT NULL,
    "price_inr" integer NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "original_price_inr" integer,
    CONSTRAINT "gigs_check" CHECK ((("original_price_inr" IS NULL) OR (("original_price_inr" > "price_inr") AND ("original_price_inr" <= 10000000)))),
    CONSTRAINT "gigs_duration_minutes_check" CHECK (("duration_minutes" = ANY (ARRAY[30, 45, 60, 90, 120]))),
    CONSTRAINT "gigs_price_inr_check" CHECK (("price_inr" >= 0))
);

ALTER TABLE ONLY "public"."gigs" REPLICA IDENTITY FULL;


ALTER TABLE "public"."gigs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."gigs"."original_price_inr" IS 'Pre-discount list price in INR. NULL when the gig has never been reduced, which is the only case in which no original price is shown.';



CREATE OR REPLACE VIEW "public"."inconsistent_bookings" AS
 SELECT "b"."id",
    "b"."booking_code",
    "b"."mentor_id",
    "b"."segment_id",
    "b"."gig_id",
    "g"."segment_id" AS "gig_segment_id",
    ("g"."mentor_id" IS DISTINCT FROM "b"."mentor_id") AS "mentor_mismatch",
    ("g"."segment_id" IS DISTINCT FROM "b"."segment_id") AS "segment_mismatch"
   FROM ("public"."bookings" "b"
     LEFT JOIN "public"."gigs" "g" ON (("g"."id" = "b"."gig_id")))
  WHERE (("g"."id" IS NOT NULL) AND (("g"."mentor_id" IS DISTINCT FROM "b"."mentor_id") OR ("g"."segment_id" IS DISTINCT FROM "b"."segment_id")));


ALTER VIEW "public"."inconsistent_bookings" OWNER TO "postgres";


COMMENT ON VIEW "public"."inconsistent_bookings" IS 'Bookings whose gig belongs to a different mentor and/or segment than the booking names. Never auto-repaired: gigs.segment_id is the authority and overwriting a booking would destroy the evidence. Reported so an operator can decide.';



CREATE TABLE IF NOT EXISTS "public"."session_workspaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "mentor_id" "uuid" NOT NULL,
    "seeker_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "summary" "text" DEFAULT ''::"text" NOT NULL,
    "takeaways" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "action_items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "resources" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "mentor_notes" "text" DEFAULT ''::"text" NOT NULL,
    "suggestions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "next_steps" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "follow_up_recommendation" "jsonb",
    CONSTRAINT "session_workspaces_status_check" CHECK (("status" = ANY (ARRAY['PENDING'::"text", 'PUBLISHED'::"text"])))
);


ALTER TABLE "public"."session_workspaces" OWNER TO "postgres";


COMMENT ON TABLE "public"."session_workspaces" IS 'Mentor-authored content is written server-side only: POST /api/workspaces is the sole writer and uses the service-role client, so no browser code writes this table. Client roles retain a narrow per-column UPDATE grant on summary, takeaways, action_items and resources as defence-in-depth. Workflow state (status, published_at) and participant identity (booking_id, mentor_id, seeker_id) are service-role only. RLS remains the ownership layer: mentor_id = auth.uid() OR is_admin(). Phase 37 adds trg_session_workspaces_participant_identity, so mentor_id and seeker_id cannot diverge from the booking they belong to - the columns RLS reads are now guaranteed to describe the same two people as the booking.';



COMMENT ON COLUMN "public"."session_workspaces"."mentor_notes" IS 'Mentor-authored session notes. Server-written only; identical content to summary.';



COMMENT ON COLUMN "public"."session_workspaces"."suggestions" IS 'Mentor-authored suggestions as a JSONB array. Server-written only.';



COMMENT ON COLUMN "public"."session_workspaces"."next_steps" IS 'Mentor-authored next steps as a JSONB array. Server-written only.';



COMMENT ON COLUMN "public"."session_workspaces"."follow_up_recommendation" IS 'Mentor follow-up recommendation, object or string or null. Server-written only.';



CREATE OR REPLACE VIEW "public"."inconsistent_session_workspaces" AS
 SELECT "w"."id",
    "w"."booking_id",
    "w"."mentor_id",
    "b"."mentor_id" AS "booking_mentor_id",
    "w"."seeker_id",
    "b"."seeker_id" AS "booking_seeker_id",
    "w"."status",
    ("w"."mentor_id" IS DISTINCT FROM "b"."mentor_id") AS "mentor_mismatch",
    ("w"."seeker_id" IS DISTINCT FROM "b"."seeker_id") AS "seeker_mismatch"
   FROM ("public"."session_workspaces" "w"
     LEFT JOIN "public"."bookings" "b" ON (("b"."id" = "w"."booking_id")))
  WHERE (("b"."id" IS NULL) OR ("w"."mentor_id" IS DISTINCT FROM "b"."mentor_id") OR ("w"."seeker_id" IS DISTINCT FROM "b"."seeker_id"));


ALTER VIEW "public"."inconsistent_session_workspaces" OWNER TO "postgres";


COMMENT ON VIEW "public"."inconsistent_session_workspaces" IS 'Workspace rows whose denormalised participants disagree with their booking, or whose booking is gone. The seeker SELECT policy keys on seeker_id, so a row listed here is simultaneously hidden from the rightful seeker and visible to the wrong one. Never auto-repaired; reported for operator decision.';



CREATE TABLE IF NOT EXISTS "public"."login_failure_config" (
    "id" integer NOT NULL,
    "failure_threshold" integer DEFAULT 5 NOT NULL,
    "window_minutes" integer DEFAULT 15 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    CONSTRAINT "login_failure_config_failure_threshold_check" CHECK ((("failure_threshold" >= 2) AND ("failure_threshold" <= 100))),
    CONSTRAINT "login_failure_config_id_check" CHECK (("id" = 1)),
    CONSTRAINT "login_failure_config_window_minutes_check" CHECK ((("window_minutes" >= 1) AND ("window_minutes" <= 1440)))
);


ALTER TABLE "public"."login_failure_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."login_failure_trackers" (
    "identifier_key" "text" NOT NULL,
    "consecutive_failures" integer DEFAULT 0 NOT NULL,
    "first_failed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_failed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_failure_reason" "text",
    "alerted_at" timestamp with time zone,
    "alert_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."login_failure_trackers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mentor_application_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "application_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "admin_user_id" "uuid",
    "rejection_reason" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mentor_application_audit_action_check" CHECK (("action" = ANY (ARRAY['created'::"text", 'updated'::"text", 'submitted'::"text", 'approved'::"text", 'rejected'::"text", 'resubmitted'::"text", 'document_uploaded'::"text", 'document_reviewed'::"text"])))
);


ALTER TABLE "public"."mentor_application_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mentor_availability" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mentor_id" "uuid" NOT NULL,
    "day_of_week" smallint NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "timezone" "text" DEFAULT 'Asia/Kolkata'::"text" NOT NULL,
    "is_enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_availability_time" CHECK (("start_time" < "end_time")),
    CONSTRAINT "mentor_availability_day_of_week_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6)))
);

ALTER TABLE ONLY "public"."mentor_availability" REPLICA IDENTITY FULL;


ALTER TABLE "public"."mentor_availability" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mentor_availability_exceptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mentor_id" "uuid" NOT NULL,
    "exception_date" "date" NOT NULL,
    "is_available" boolean DEFAULT false NOT NULL,
    "start_time" time without time zone,
    "end_time" time without time zone,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_exception_times" CHECK ((("is_available" = false) OR (("start_time" IS NOT NULL) AND ("end_time" IS NOT NULL) AND ("start_time" < "end_time"))))
);

ALTER TABLE ONLY "public"."mentor_availability_exceptions" REPLICA IDENTITY FULL;


ALTER TABLE "public"."mentor_availability_exceptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mentor_profiles" (
    "id" "uuid" NOT NULL,
    "headline" "text" DEFAULT ''::"text" NOT NULL,
    "about" "text",
    "experience_years" integer DEFAULT 0 NOT NULL,
    "languages" "text"[] DEFAULT ARRAY['English'::"text", 'Hindi'::"text"] NOT NULL,
    "rating" numeric(3,2) DEFAULT 5.00 NOT NULL,
    "review_count" integer DEFAULT 0 NOT NULL,
    "session_count" integer DEFAULT 0 NOT NULL,
    "is_approved" boolean DEFAULT true NOT NULL,
    "is_featured" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "approval_status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "expertise" "text"[],
    "created_via" "text",
    CONSTRAINT "chk_mentor_profiles_approval_status" CHECK (("approval_status" = ANY (ARRAY['draft'::"text", 'pending_review'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "chk_mentor_profiles_created_via" CHECK ((("created_via" IS NULL) OR ("created_via" = ANY (ARRAY['public_signup'::"text", 'admin_direct'::"text"])))),
    CONSTRAINT "mentor_profiles_approval_status_check" CHECK (("approval_status" = ANY (ARRAY['draft'::"text", 'pending_review'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "mentor_profiles_experience_years_check" CHECK (("experience_years" >= 0)),
    CONSTRAINT "mentor_profiles_rating_check" CHECK ((("rating" >= (0)::numeric) AND ("rating" <= 5.00))),
    CONSTRAINT "mentor_profiles_review_count_check" CHECK (("review_count" >= 0)),
    CONSTRAINT "mentor_profiles_session_count_check" CHECK (("session_count" >= 0))
);


ALTER TABLE "public"."mentor_profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."mentor_profiles" IS 'UPDATE is limited to headline, about, experience_years, expertise and languages. Verification and moderation fields (is_approved, approval_status, is_active, is_featured, rating, review_count, session_count) are service-role only: granting them let a mentor self-approve and become publicly bookable, because the public SELECT policy keys on mentor_is_publicly_visible().';



COMMENT ON COLUMN "public"."mentor_profiles"."expertise" IS 'Mentor areas of expertise as free-form tags. NULL until an Admin or the mentor sets them.';



COMMENT ON COLUMN "public"."mentor_profiles"."created_via" IS 'How this mentor joined: public_signup | admin_direct. NULL = a legacy row written before this column existed; the server then falls back to the MENTOR_CREATED_BY_ADMIN audit record, and finally to application presence.';



CREATE TABLE IF NOT EXISTS "public"."mentor_segments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mentor_id" "uuid" NOT NULL,
    "segment_id" "uuid" NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."mentor_segments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "type" "text" DEFAULT 'SYSTEM'::"text" NOT NULL,
    "link" "text",
    "is_read" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event_type" "text",
    "entity_type" "text",
    "entity_id" "text",
    "read_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payment_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "gateway" "text",
    "gateway_payment_id" "text",
    "amount_inr" integer,
    "reason" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payment_events_amount_inr_check" CHECK (("amount_inr" >= 0))
);


ALTER TABLE "public"."payment_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "seeker_id" "uuid" NOT NULL,
    "amount_inr" integer NOT NULL,
    "status" "text" DEFAULT 'PENDING_VERIFICATION'::"text" NOT NULL,
    "proof_storage_path" "text",
    "transaction_reference" "text",
    "verified_by" "uuid",
    "verified_at" timestamp with time zone,
    "rejection_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "gateway" "text" DEFAULT 'manual'::"text",
    "razorpay_order_id" "text",
    "razorpay_payment_id" "text",
    "razorpay_signature" "text",
    "captured_at" timestamp with time zone,
    "refund_id" "text",
    "refund_status" "text",
    "failure_reason" "text",
    "gateway_payload" "jsonb",
    "refund_amount_paise" integer,
    "refunded_at" timestamp with time zone,
    "refund_reason" "text",
    "manual_refund_required" boolean DEFAULT false NOT NULL,
    "refund_reference" "text",
    "refund_method" "text",
    "refund_proof_storage_path" "text",
    "refund_admin_note" "text",
    "refunded_by" "uuid",
    CONSTRAINT "payments_amount_inr_check" CHECK (("amount_inr" >= 0)),
    CONSTRAINT "payments_gateway_check" CHECK (("gateway" = ANY (ARRAY['manual'::"text", 'razorpay'::"text"]))),
    CONSTRAINT "payments_refund_admin_note_check" CHECK ((("refund_admin_note" IS NULL) OR ("length"("refund_admin_note") <= 500))),
    CONSTRAINT "payments_refund_amount_paise_check" CHECK ((("refund_amount_paise" IS NULL) OR ("refund_amount_paise" >= 0))),
    CONSTRAINT "payments_refund_method_check" CHECK ((("refund_method" IS NULL) OR ("refund_method" = ANY (ARRAY['UPI'::"text", 'BANK_TRANSFER'::"text"])))),
    CONSTRAINT "payments_refund_proof_storage_path_check" CHECK ((("refund_proof_storage_path" IS NULL) OR ("refund_proof_storage_path" ~~ 'refunds/%'::"text"))),
    CONSTRAINT "payments_refund_reason_check" CHECK ((("refund_reason" IS NULL) OR ("refund_reason" = ANY (ARRAY['seeker_cancellation_within_window'::"text", 'seeker_cancellation_outside_window'::"text", 'mentor_cancellation'::"text", 'mentor_rejection'::"text", 'admin_refund'::"text", 'manual_payment_refund'::"text"])))),
    CONSTRAINT "payments_refund_reference_check" CHECK ((("refund_reference" IS NULL) OR (("length"("btrim"("refund_reference")) >= 1) AND ("length"("btrim"("refund_reference")) <= 64)))),
    CONSTRAINT "payments_refund_status_check" CHECK ((("refund_status" IS NULL) OR ("refund_status" = ANY (ARRAY['PENDING'::"text", 'FAILED'::"text", 'REFUNDED'::"text"])))),
    CONSTRAINT "payments_status_check" CHECK (("status" = ANY (ARRAY['PENDING_VERIFICATION'::"text", 'VERIFIED'::"text", 'REJECTED'::"text", 'PAYMENT_PENDING'::"text", 'PAYMENT_PROCESSING'::"text", 'FAILED'::"text", 'REFUNDED'::"text", 'REFUND_FAILED'::"text"])))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platform_config" (
    "id" integer NOT NULL,
    "upi_id" "text",
    "qr_image_storage_path" "text",
    "payment_instructions" "text",
    "currency" "text" DEFAULT 'INR'::"text",
    "payment_account_name" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    "hold_duration_minutes" integer DEFAULT 15 NOT NULL,
    "reschedule_request_expiry_hours" integer DEFAULT 24 NOT NULL,
    "reschedule_window_minutes" integer DEFAULT 10 NOT NULL,
    "normal_cancellation_window_minutes" integer DEFAULT 10 NOT NULL,
    CONSTRAINT "platform_config_currency_supported" CHECK ((("currency" IS NULL) OR ("currency" = 'INR'::"text"))),
    CONSTRAINT "platform_config_id_check" CHECK (("id" = 1))
);


ALTER TABLE "public"."platform_config" OWNER TO "postgres";


COMMENT ON TABLE "public"."platform_config" IS 'Payment and booking-window configuration (single row, id = 1). Server-written only via admin routes using the service-role client. RLS restricts every operation to admins: no browser code reads or writes this table. Absent RLS, the table-level authenticated grants would let any signed-in user rewrite upi_id and redirect payments.';



CREATE TABLE IF NOT EXISTS "public"."razorpay_unmatched_captures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "gateway" "text" DEFAULT 'razorpay'::"text" NOT NULL,
    "event_id" "text" NOT NULL,
    "last_event_id" "text",
    "event_type" "text" NOT NULL,
    "razorpay_payment_id" "text" NOT NULL,
    "razorpay_order_id" "text",
    "amount_paise" integer,
    "currency" "text",
    "received_at" timestamp with time zone NOT NULL,
    "reason" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "reconciliation_status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "delivery_count" integer DEFAULT 1 NOT NULL,
    "last_received_at" timestamp with time zone,
    "resolved_payment_id" "uuid",
    "resolved_at" timestamp with time zone,
    "resolved_by" "uuid",
    "resolution_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "razorpay_unmatched_captures_gateway_check" CHECK (("gateway" = 'razorpay'::"text")),
    CONSTRAINT "razorpay_unmatched_captures_reconciliation_status_check" CHECK (("reconciliation_status" = ANY (ARRAY['PENDING'::"text", 'RESOLVED'::"text", 'CONFLICT'::"text"])))
);


ALTER TABLE "public"."razorpay_unmatched_captures" OWNER TO "postgres";


COMMENT ON TABLE "public"."razorpay_unmatched_captures" IS 'Exception ledger for Razorpay captures that could not be matched to a local payments row (audit P0-1). A row here means money moved and the platform has no confirmed payment for it. It is never a confirmed payment and never advances a booking. Rows are written only by the service role on a correctly signed webhook, are unique per captured gateway payment, and are resolved by an explicit operator reconciliation.';



CREATE TABLE IF NOT EXISTS "public"."reschedule_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "seeker_id" "uuid" NOT NULL,
    "mentor_id" "uuid" NOT NULL,
    "original_start_time" timestamp with time zone NOT NULL,
    "original_end_time" timestamp with time zone NOT NULL,
    "requested_start_time" timestamp with time zone NOT NULL,
    "requested_end_time" timestamp with time zone NOT NULL,
    "hold_id" "uuid",
    "status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "mentor_response" "text",
    "rejection_reason" "text",
    "seeker_requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "mentor_responded_at" timestamp with time zone,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_reschedule_expiry_after_creation" CHECK (("expires_at" > "created_at")),
    CONSTRAINT "chk_reschedule_mentor_responded" CHECK (((("status" = 'PENDING'::"text") AND ("mentor_responded_at" IS NULL)) OR (("status" <> 'PENDING'::"text") AND ("mentor_responded_at" IS NOT NULL)))),
    CONSTRAINT "chk_reschedule_original_interval" CHECK (("original_start_time" < "original_end_time")),
    CONSTRAINT "chk_reschedule_requested_interval" CHECK (("requested_start_time" < "requested_end_time")),
    CONSTRAINT "reschedule_requests_mentor_response_check" CHECK (("mentor_response" = ANY (ARRAY['ACCEPTED'::"text", 'REJECTED'::"text"]))),
    CONSTRAINT "reschedule_requests_status_check" CHECK (("status" = ANY (ARRAY['PENDING'::"text", 'APPROVED'::"text", 'REJECTED'::"text", 'EXPIRED'::"text", 'CANCELLED'::"text"])))
);


ALTER TABLE "public"."reschedule_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."seeker_profiles" (
    "id" "uuid" NOT NULL,
    "preferred_language" "text" DEFAULT 'English'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."seeker_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."segment_topics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "segment_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "priority" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "segment_topics_description_check" CHECK ((("description" IS NULL) OR ("length"("description") <= 200))),
    CONSTRAINT "segment_topics_name_check" CHECK ((("length"("btrim"("name")) >= 1) AND ("length"("btrim"("name")) <= 80))),
    CONSTRAINT "segment_topics_slug_check" CHECK (("slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::"text"))
);


ALTER TABLE "public"."segment_topics" OWNER TO "postgres";


COMMENT ON TABLE "public"."segment_topics" IS 'Admin-managed topic taxonomy for a segment. Powers the seeker topic bar and per-gig topic selection. Scoped to exactly one segment.';



CREATE TABLE IF NOT EXISTS "public"."segments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "priority" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "experience_config" "jsonb" DEFAULT '{}'::"jsonb"
);

ALTER TABLE ONLY "public"."segments" REPLICA IDENTITY FULL;


ALTER TABLE "public"."segments" OWNER TO "postgres";


COMMENT ON TABLE "public"."segments" IS 'Advisory segments. Experience/branding config lives in experience_config; the row is replicated via supabase_realtime so admin edits reach open seeker pages. Public SELECT is limited to is_active = TRUE by RLS.';



COMMENT ON COLUMN "public"."segments"."experience_config" IS 'MVP per-segment experience configuration rendered on the seeker side.';



CREATE TABLE IF NOT EXISTS "public"."support_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ticket_id" "uuid" NOT NULL,
    "message_id" "uuid",
    "uploaded_by" "uuid" NOT NULL,
    "storage_path" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "mime_type" "text" NOT NULL,
    "file_size" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "support_attachments_file_name_check" CHECK ((("length"("btrim"("file_name")) >= 1) AND ("length"("btrim"("file_name")) <= 255))),
    CONSTRAINT "support_attachments_file_size_check" CHECK ((("file_size" > 0) AND ("file_size" <= 5242880))),
    CONSTRAINT "support_attachments_mime_type_check" CHECK (("mime_type" = ANY (ARRAY['image/png'::"text", 'image/jpeg'::"text", 'image/webp'::"text", 'application/pdf'::"text"]))),
    CONSTRAINT "support_attachments_storage_path_check" CHECK (("storage_path" ~ '^support/[0-9a-f-]{36}/[0-9A-Za-z._-]+$'::"text")),
    CONSTRAINT "support_attachments_storage_path_check1" CHECK ((("storage_path" !~ '\.\.'::"text") AND ("storage_path" !~ '\\'::"text")))
);


ALTER TABLE "public"."support_attachments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."support_audit_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ticket_id" "uuid" NOT NULL,
    "actor_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "support_audit_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['TICKET_CREATED'::"text", 'TICKET_MESSAGE_SENT'::"text", 'TICKET_INTERNAL_NOTE_ADDED'::"text", 'TICKET_STATUS_CHANGED'::"text", 'TICKET_PRIORITY_CHANGED'::"text", 'TICKET_ASSIGNED'::"text", 'TICKET_RESOLVED'::"text", 'TICKET_REOPENED'::"text", 'ATTACHMENT_ADDED'::"text", 'REFUND_REQUESTED'::"text", 'REFUND_STATUS_CHANGED'::"text"])))
);


ALTER TABLE "public"."support_audit_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."support_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ticket_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "sender_role" "text" NOT NULL,
    "message" "text" NOT NULL,
    "is_internal" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "support_messages_message_check" CHECK ((("length"("btrim"("message")) >= 1) AND ("length"("btrim"("message")) <= 4000))),
    CONSTRAINT "support_messages_sender_role_check" CHECK (("sender_role" = ANY (ARRAY['seeker'::"text", 'mentor'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."support_messages" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."support_ticket_code_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."support_ticket_code_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."support_tickets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ticket_code" "text" NOT NULL,
    "requester_id" "uuid" NOT NULL,
    "requester_role" "text" NOT NULL,
    "category" "text" NOT NULL,
    "subject" "text" NOT NULL,
    "status" "text" DEFAULT 'OPEN'::"text" NOT NULL,
    "priority" "text" DEFAULT 'NORMAL'::"text" NOT NULL,
    "booking_id" "uuid",
    "payment_id" "uuid",
    "assigned_admin_id" "uuid",
    "resolution" "text",
    "resolved_at" timestamp with time zone,
    "resolved_by" "uuid",
    "closed_at" timestamp with time zone,
    "closed_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_message_at" timestamp with time zone,
    CONSTRAINT "chk_support_resolution_presence" CHECK (((("status" = 'RESOLVED'::"text") AND ("resolution" IS NOT NULL)) OR ("status" <> 'RESOLVED'::"text"))),
    CONSTRAINT "support_tickets_category_check" CHECK (("category" = ANY (ARRAY['BOOKING'::"text", 'PAYMENT'::"text", 'SESSION'::"text", 'MENTOR'::"text", 'AVAILABILITY'::"text", 'PROFILE'::"text", 'ACCOUNT'::"text", 'USER'::"text", 'SYSTEM'::"text", 'TECHNICAL'::"text", 'OTHER'::"text"]))),
    CONSTRAINT "support_tickets_priority_check" CHECK (("priority" = ANY (ARRAY['LOW'::"text", 'NORMAL'::"text", 'HIGH'::"text", 'URGENT'::"text"]))),
    CONSTRAINT "support_tickets_requester_role_check" CHECK (("requester_role" = ANY (ARRAY['seeker'::"text", 'mentor'::"text", 'admin'::"text"]))),
    CONSTRAINT "support_tickets_resolution_check" CHECK ((("resolution" IS NULL) OR ("length"("resolution") <= 4000))),
    CONSTRAINT "support_tickets_status_check" CHECK (("status" = ANY (ARRAY['OPEN'::"text", 'IN_PROGRESS'::"text", 'WAITING_FOR_USER'::"text", 'RESOLVED'::"text", 'CLOSED'::"text"]))),
    CONSTRAINT "support_tickets_subject_check" CHECK ((("length"("btrim"("subject")) >= 4) AND ("length"("btrim"("subject")) <= 140))),
    CONSTRAINT "support_tickets_ticket_code_check" CHECK (("ticket_code" ~ '^SK-[0-9]{8}-[0-9]{6}$'::"text"))
);


ALTER TABLE "public"."support_tickets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_log_retention" (
    "id" integer NOT NULL,
    "retention_days" integer DEFAULT 30 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    CONSTRAINT "system_log_retention_id_check" CHECK (("id" = 1)),
    CONSTRAINT "system_log_retention_retention_days_check" CHECK ((("retention_days" >= 1) AND ("retention_days" <= 365)))
);


ALTER TABLE "public"."system_log_retention" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_roles_role_check" CHECK (("role" = ANY (ARRAY['seeker'::"text", 'mentor'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."webhook_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "gateway" "text" NOT NULL,
    "event_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "processed" boolean DEFAULT false NOT NULL,
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."webhook_events" OWNER TO "postgres";


ALTER TABLE ONLY "mvp"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "mvp"."bookings"
    ADD CONSTRAINT "bookings_mentor_id_tstzrange_excl" EXCLUDE USING "gist" ("mentor_id" WITH =, "tstzrange"("slot_start", "slot_end") WITH &&) WHERE (("status" = ANY (ARRAY['payment_pending'::"mvp"."booking_status", 'mentor_pending'::"mvp"."booking_status", 'confirmed'::"mvp"."booking_status", 'in_progress'::"mvp"."booking_status"])));



ALTER TABLE ONLY "mvp"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "mvp"."gigs"
    ADD CONSTRAINT "gigs_mentor_id_segment_id_key" UNIQUE ("mentor_id", "segment_id");



ALTER TABLE ONLY "mvp"."gigs"
    ADD CONSTRAINT "gigs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "mvp"."mentor_availability_exceptions"
    ADD CONSTRAINT "mentor_availability_exceptions_mentor_id_date_key" UNIQUE ("mentor_id", "date");



ALTER TABLE ONLY "mvp"."mentor_availability_exceptions"
    ADD CONSTRAINT "mentor_availability_exceptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "mvp"."mentor_availability"
    ADD CONSTRAINT "mentor_availability_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "mvp"."mentor_profiles"
    ADD CONSTRAINT "mentor_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "mvp"."mentor_segments"
    ADD CONSTRAINT "mentor_segments_pkey" PRIMARY KEY ("mentor_id", "segment_id");



ALTER TABLE ONLY "mvp"."mentor_time_reservations"
    ADD CONSTRAINT "mentor_time_reservations_mentor_id_tstzrange_excl" EXCLUDE USING "gist" ("mentor_id" WITH =, "tstzrange"("slot_start", "slot_end") WITH &&) WHERE (("status" = 'active'::"text"));



ALTER TABLE ONLY "mvp"."mentor_time_reservations"
    ADD CONSTRAINT "mentor_time_reservations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "mvp"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "mvp"."payments"
    ADD CONSTRAINT "payments_booking_id_key" UNIQUE ("booking_id");



ALTER TABLE ONLY "mvp"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "mvp"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "mvp"."seeker_profiles"
    ADD CONSTRAINT "seeker_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "mvp"."segments"
    ADD CONSTRAINT "segments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "mvp"."segments"
    ADD CONSTRAINT "segments_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "mvp"."session_workspaces"
    ADD CONSTRAINT "session_workspaces_booking_id_key" UNIQUE ("booking_id");



ALTER TABLE ONLY "mvp"."session_workspaces"
    ADD CONSTRAINT "session_workspaces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "mvp"."slot_holds"
    ADD CONSTRAINT "slot_holds_mentor_id_tstzrange_excl" EXCLUDE USING "gist" ("mentor_id" WITH =, "tstzrange"("slot_start", "slot_end") WITH &&) WHERE (("status" = 'active'::"mvp"."hold_status"));



ALTER TABLE ONLY "mvp"."slot_holds"
    ADD CONSTRAINT "slot_holds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "mvp"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id", "role");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_booking_code_key" UNIQUE ("booking_code");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coupon_usage"
    ADD CONSTRAINT "coupon_usage_booking_id_key" UNIQUE ("booking_id");



ALTER TABLE ONLY "public"."coupon_usage"
    ADD CONSTRAINT "coupon_usage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coupons"
    ADD CONSTRAINT "coupons_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."coupons"
    ADD CONSTRAINT "coupons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gig_topics"
    ADD CONSTRAINT "gig_topics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gigs"
    ADD CONSTRAINT "gigs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."login_failure_config"
    ADD CONSTRAINT "login_failure_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."login_failure_trackers"
    ADD CONSTRAINT "login_failure_trackers_pkey" PRIMARY KEY ("identifier_key");



ALTER TABLE ONLY "public"."mentor_application_audit"
    ADD CONSTRAINT "mentor_application_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mentor_applications"
    ADD CONSTRAINT "mentor_applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mentor_availability_exceptions"
    ADD CONSTRAINT "mentor_availability_exceptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mentor_availability"
    ADD CONSTRAINT "mentor_availability_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mentor_document_types"
    ADD CONSTRAINT "mentor_document_types_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."mentor_profiles"
    ADD CONSTRAINT "mentor_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mentor_segments"
    ADD CONSTRAINT "mentor_segments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mentor_verification_documents"
    ADD CONSTRAINT "mentor_verification_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."slot_holds"
    ADD CONSTRAINT "no_overlapping_active_holds" EXCLUDE USING "gist" ("mentor_id" WITH =, "tstzrange"("start_time", "end_time", '[)'::"text") WITH &&) WHERE (("status" = 'ACTIVE'::"text"));



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "no_overlapping_mentor_bookings" EXCLUDE USING "gist" ("mentor_id" WITH =, "tstzrange"("start_time", "end_time", '[)'::"text") WITH &&) WHERE (("status" <> ALL (ARRAY['CANCELLED'::"text", 'REJECTED'::"text"])));



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_events"
    ADD CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_config"
    ADD CONSTRAINT "platform_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."razorpay_unmatched_captures"
    ADD CONSTRAINT "razorpay_unmatched_captures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reschedule_requests"
    ADD CONSTRAINT "reschedule_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seeker_profiles"
    ADD CONSTRAINT "seeker_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."segment_topics"
    ADD CONSTRAINT "segment_topics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."segments"
    ADD CONSTRAINT "segments_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."segments"
    ADD CONSTRAINT "segments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."segments"
    ADD CONSTRAINT "segments_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."session_workspaces"
    ADD CONSTRAINT "session_workspaces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."slot_holds"
    ADD CONSTRAINT "slot_holds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."support_attachments"
    ADD CONSTRAINT "support_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."support_audit_events"
    ADD CONSTRAINT "support_audit_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."support_messages"
    ADD CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_ticket_code_key" UNIQUE ("ticket_code");



ALTER TABLE ONLY "public"."system_log_retention"
    ADD CONSTRAINT "system_log_retention_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_logs"
    ADD CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gig_topics"
    ADD CONSTRAINT "uq_gig_topics_gig_topic" UNIQUE ("gig_id", "topic_id");



ALTER TABLE ONLY "public"."gigs"
    ADD CONSTRAINT "uq_gigs_mentor_segment" UNIQUE ("mentor_id", "segment_id");



ALTER TABLE ONLY "public"."mentor_applications"
    ADD CONSTRAINT "uq_mentor_applications_user" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."mentor_availability"
    ADD CONSTRAINT "uq_mentor_availability_slot" UNIQUE ("mentor_id", "day_of_week", "start_time", "end_time");



ALTER TABLE ONLY "public"."mentor_availability_exceptions"
    ADD CONSTRAINT "uq_mentor_date_exception" UNIQUE ("mentor_id", "exception_date");



ALTER TABLE ONLY "public"."mentor_segments"
    ADD CONSTRAINT "uq_mentor_segment" UNIQUE ("mentor_id", "segment_id");



ALTER TABLE ONLY "public"."mentor_verification_documents"
    ADD CONSTRAINT "uq_mentor_verification_doc_app_type" UNIQUE ("application_id", "document_type");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "uq_payment_booking" UNIQUE ("booking_id");



ALTER TABLE ONLY "public"."segment_topics"
    ADD CONSTRAINT "uq_segment_topics_segment_slug" UNIQUE ("segment_id", "slug");



ALTER TABLE ONLY "public"."razorpay_unmatched_captures"
    ADD CONSTRAINT "uq_unmatched_capture_financial" UNIQUE ("gateway", "razorpay_payment_id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "uq_user_roles_user_role" UNIQUE ("user_id", "role");



ALTER TABLE ONLY "public"."webhook_events"
    ADD CONSTRAINT "uq_webhook_gateway_event" UNIQUE ("gateway", "event_id");



ALTER TABLE ONLY "public"."session_workspaces"
    ADD CONSTRAINT "uq_workspace_booking" UNIQUE ("booking_id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."webhook_events"
    ADD CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_mvp_audit_actor" ON "mvp"."audit_logs" USING "btree" ("actor_id");



CREATE INDEX "idx_mvp_audit_created" ON "mvp"."audit_logs" USING "btree" ("created_at");



CREATE INDEX "idx_mvp_audit_entity" ON "mvp"."audit_logs" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_mvp_bookings_gig" ON "mvp"."bookings" USING "btree" ("gig_id");



CREATE INDEX "idx_mvp_bookings_mentor" ON "mvp"."bookings" USING "btree" ("mentor_id");



CREATE INDEX "idx_mvp_bookings_seeker" ON "mvp"."bookings" USING "btree" ("seeker_id");



CREATE INDEX "idx_mvp_bookings_segment" ON "mvp"."bookings" USING "btree" ("segment_id");



CREATE INDEX "idx_mvp_bookings_slot" ON "mvp"."bookings" USING "btree" ("slot_start", "slot_end");



CREATE INDEX "idx_mvp_bookings_status" ON "mvp"."bookings" USING "btree" ("status");



CREATE INDEX "idx_mvp_gigs_active" ON "mvp"."gigs" USING "btree" ("is_active");



CREATE INDEX "idx_mvp_gigs_mentor" ON "mvp"."gigs" USING "btree" ("mentor_id");



CREATE INDEX "idx_mvp_gigs_segment" ON "mvp"."gigs" USING "btree" ("segment_id");



CREATE INDEX "idx_mvp_mentor_avail_active" ON "mvp"."mentor_availability" USING "btree" ("is_active");



CREATE INDEX "idx_mvp_mentor_avail_mentor" ON "mvp"."mentor_availability" USING "btree" ("mentor_id");



CREATE INDEX "idx_mvp_mentor_exc_mentor" ON "mvp"."mentor_availability_exceptions" USING "btree" ("mentor_id");



CREATE INDEX "idx_mvp_mentor_profiles_active" ON "mvp"."mentor_profiles" USING "btree" ("is_active");



CREATE INDEX "idx_mvp_mentor_profiles_approval" ON "mvp"."mentor_profiles" USING "btree" ("approval_status");



CREATE INDEX "idx_mvp_notifications_unread" ON "mvp"."notifications" USING "btree" ("user_id", "is_read");



CREATE INDEX "idx_mvp_notifications_user" ON "mvp"."notifications" USING "btree" ("user_id");



CREATE INDEX "idx_mvp_payments_booking" ON "mvp"."payments" USING "btree" ("booking_id");



CREATE INDEX "idx_mvp_payments_status" ON "mvp"."payments" USING "btree" ("status");



CREATE INDEX "idx_mvp_profiles_timezone" ON "mvp"."profiles" USING "btree" ("timezone");



CREATE INDEX "idx_mvp_reservations_active" ON "mvp"."mentor_time_reservations" USING "btree" ("status");



CREATE INDEX "idx_mvp_reservations_mentor" ON "mvp"."mentor_time_reservations" USING "btree" ("mentor_id");



CREATE INDEX "idx_mvp_segments_active_priority" ON "mvp"."segments" USING "btree" ("is_active", "priority");



CREATE UNIQUE INDEX "idx_mvp_segments_slug" ON "mvp"."segments" USING "btree" ("slug");



CREATE INDEX "idx_mvp_slot_holds_expires" ON "mvp"."slot_holds" USING "btree" ("expires_at");



CREATE INDEX "idx_mvp_slot_holds_mentor" ON "mvp"."slot_holds" USING "btree" ("mentor_id");



CREATE INDEX "idx_mvp_slot_holds_seeker" ON "mvp"."slot_holds" USING "btree" ("seeker_id");



CREATE INDEX "idx_mvp_slot_holds_status" ON "mvp"."slot_holds" USING "btree" ("status");



CREATE UNIQUE INDEX "idx_mvp_user_roles_one_per_user" ON "mvp"."user_roles" USING "btree" ("user_id");



CREATE INDEX "idx_audit_logs_action" ON "public"."audit_logs" USING "btree" ("action");



CREATE INDEX "idx_audit_logs_actor_user_id" ON "public"."audit_logs" USING "btree" ("actor_user_id");



CREATE INDEX "idx_audit_logs_created_action" ON "public"."audit_logs" USING "btree" ("created_at" DESC, "action");



CREATE INDEX "idx_audit_logs_created_at" ON "public"."audit_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_logs_entity_type" ON "public"."audit_logs" USING "btree" ("entity_type");



CREATE INDEX "idx_audit_logs_request_id" ON "public"."audit_logs" USING "btree" ("request_id");



CREATE INDEX "idx_bookings_actual_ended_at" ON "public"."bookings" USING "btree" ("actual_ended_at") WHERE ("actual_ended_at" IS NOT NULL);



CREATE INDEX "idx_bookings_code" ON "public"."bookings" USING "btree" ("booking_code");



CREATE INDEX "idx_bookings_ended_by_role" ON "public"."bookings" USING "btree" ("ended_by_role") WHERE ("ended_by_role" IS NOT NULL);



CREATE INDEX "idx_bookings_mentor_interval" ON "public"."bookings" USING "btree" ("mentor_id", "start_time", "end_time") WHERE ("status" <> ALL (ARRAY['CANCELLED'::"text", 'REJECTED'::"text"]));



CREATE INDEX "idx_bookings_mentor_status" ON "public"."bookings" USING "btree" ("mentor_id", "status");



CREATE INDEX "idx_bookings_mentor_status_completed" ON "public"."bookings" USING "btree" ("mentor_id", "status", "actual_ended_at") WHERE (("status" = 'CONFIRMED'::"text") AND ("actual_ended_at" IS NULL));



CREATE INDEX "idx_bookings_open_end_time" ON "public"."bookings" USING "btree" ("end_time") WHERE ("status" = 'CONFIRMED'::"text");



CREATE INDEX "idx_bookings_seeker_status" ON "public"."bookings" USING "btree" ("seeker_id", "status");



CREATE INDEX "idx_bookings_start_time" ON "public"."bookings" USING "btree" ("start_time");



CREATE INDEX "idx_bookings_status_end_time" ON "public"."bookings" USING "btree" ("status", "end_time");



CREATE INDEX "idx_coupon_usage_coupon_status" ON "public"."coupon_usage" USING "btree" ("coupon_id", "status");



CREATE INDEX "idx_coupon_usage_coupon_user_status" ON "public"."coupon_usage" USING "btree" ("coupon_id", "seeker_id", "status");



CREATE INDEX "idx_coupon_usage_reserved" ON "public"."coupon_usage" USING "btree" ("reserved_at") WHERE ("status" = 'RESERVED'::"text");



CREATE INDEX "idx_coupons_mentor" ON "public"."coupons" USING "btree" ("mentor_id") WHERE ("mentor_id" IS NOT NULL);



CREATE INDEX "idx_coupons_segment" ON "public"."coupons" USING "btree" ("segment_id") WHERE ("segment_id" IS NOT NULL);



CREATE INDEX "idx_coupons_status_window" ON "public"."coupons" USING "btree" ("status", "starts_at", "expires_at");



CREATE INDEX "idx_gig_topics_gig_id" ON "public"."gig_topics" USING "btree" ("gig_id");



CREATE INDEX "idx_gig_topics_topic_id" ON "public"."gig_topics" USING "btree" ("topic_id");



CREATE INDEX "idx_gigs_active" ON "public"."gigs" USING "btree" ("is_active");



CREATE INDEX "idx_gigs_mentor_id" ON "public"."gigs" USING "btree" ("mentor_id");



CREATE INDEX "idx_gigs_segment_id" ON "public"."gigs" USING "btree" ("segment_id");



CREATE INDEX "idx_login_failure_trackers_alerted" ON "public"."login_failure_trackers" USING "btree" ("alerted_at" DESC) WHERE ("alerted_at" IS NOT NULL);



CREATE INDEX "idx_login_failure_trackers_last_failed" ON "public"."login_failure_trackers" USING "btree" ("last_failed_at" DESC);



CREATE INDEX "idx_mentor_app_audit_app" ON "public"."mentor_application_audit" USING "btree" ("application_id");



CREATE INDEX "idx_mentor_app_audit_application" ON "public"."mentor_application_audit" USING "btree" ("application_id", "created_at" DESC);



CREATE INDEX "idx_mentor_app_audit_created" ON "public"."mentor_application_audit" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_mentor_applications_review_queue" ON "public"."mentor_applications" USING "btree" ("submitted_at") WHERE ("status" = 'pending_review'::"text");



CREATE INDEX "idx_mentor_applications_status" ON "public"."mentor_applications" USING "btree" ("status");



CREATE INDEX "idx_mentor_applications_submitted" ON "public"."mentor_applications" USING "btree" ("submitted_at" DESC);



CREATE INDEX "idx_mentor_applications_user" ON "public"."mentor_applications" USING "btree" ("user_id");



CREATE INDEX "idx_mentor_audit_application" ON "public"."mentor_application_audit" USING "btree" ("application_id", "created_at" DESC);



CREATE INDEX "idx_mentor_availability_lookup" ON "public"."mentor_availability" USING "btree" ("mentor_id", "day_of_week", "is_enabled");



CREATE INDEX "idx_mentor_docs_application" ON "public"."mentor_verification_documents" USING "btree" ("application_id");



CREATE INDEX "idx_mentor_docs_status" ON "public"."mentor_verification_documents" USING "btree" ("status");



CREATE INDEX "idx_mentor_document_types_active" ON "public"."mentor_document_types" USING "btree" ("is_active", "sort_order");



CREATE INDEX "idx_mentor_documents_application" ON "public"."mentor_verification_documents" USING "btree" ("application_id");



CREATE INDEX "idx_mentor_exceptions_lookup" ON "public"."mentor_availability_exceptions" USING "btree" ("mentor_id", "exception_date");



CREATE INDEX "idx_mentor_profiles_active" ON "public"."mentor_profiles" USING "btree" ("is_active");



CREATE INDEX "idx_mentor_profiles_approval" ON "public"."mentor_profiles" USING "btree" ("approval_status");



CREATE INDEX "idx_mentor_profiles_approved" ON "public"."mentor_profiles" USING "btree" ("is_approved");



CREATE INDEX "idx_mentor_profiles_created_via" ON "public"."mentor_profiles" USING "btree" ("created_via");



CREATE INDEX "idx_mentor_profiles_rating" ON "public"."mentor_profiles" USING "btree" ("rating" DESC);



CREATE INDEX "idx_mentor_segments_mentor_id" ON "public"."mentor_segments" USING "btree" ("mentor_id");



CREATE INDEX "idx_mentor_segments_segment" ON "public"."mentor_segments" USING "btree" ("segment_id");



CREATE INDEX "idx_mentor_segments_segment_id" ON "public"."mentor_segments" USING "btree" ("segment_id");



CREATE INDEX "idx_mentor_verification_docs_app" ON "public"."mentor_verification_documents" USING "btree" ("application_id");



CREATE INDEX "idx_mentor_verification_docs_status" ON "public"."mentor_verification_documents" USING "btree" ("status");



CREATE INDEX "idx_notifications_entity" ON "public"."notifications" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_notifications_event_type" ON "public"."notifications" USING "btree" ("event_type");



CREATE INDEX "idx_notifications_user_unread" ON "public"."notifications" USING "btree" ("user_id", "is_read", "created_at" DESC);



CREATE INDEX "idx_payment_events_payment_id" ON "public"."payment_events" USING "btree" ("payment_id");



CREATE INDEX "idx_payment_events_status" ON "public"."payment_events" USING "btree" ("status");



CREATE INDEX "idx_payments_gateway_status" ON "public"."payments" USING "btree" ("gateway", "status");



CREATE INDEX "idx_payments_manual_refund_queue" ON "public"."payments" USING "btree" ("created_at") WHERE (("refund_status" = 'PENDING'::"text") AND ("gateway" = 'manual'::"text"));



CREATE INDEX "idx_payments_manual_refund_required" ON "public"."payments" USING "btree" ("manual_refund_required") WHERE ("manual_refund_required" = true);



CREATE INDEX "idx_payments_razorpay_order" ON "public"."payments" USING "btree" ("razorpay_order_id") WHERE ("razorpay_order_id" IS NOT NULL);



CREATE INDEX "idx_payments_razorpay_payment" ON "public"."payments" USING "btree" ("razorpay_payment_id") WHERE ("razorpay_payment_id" IS NOT NULL);



CREATE INDEX "idx_payments_refund_status" ON "public"."payments" USING "btree" ("refund_status") WHERE ("refund_status" IS NOT NULL);



CREATE INDEX "idx_payments_seeker_id" ON "public"."payments" USING "btree" ("seeker_id");



CREATE INDEX "idx_payments_status" ON "public"."payments" USING "btree" ("status");



CREATE INDEX "idx_profiles_account_status" ON "public"."profiles" USING "btree" ("account_status");



CREATE INDEX "idx_profiles_email" ON "public"."profiles" USING "btree" ("email");



CREATE INDEX "idx_reschedule_requests_booking" ON "public"."reschedule_requests" USING "btree" ("booking_id", "created_at" DESC);



CREATE INDEX "idx_reschedule_requests_expiry" ON "public"."reschedule_requests" USING "btree" ("expires_at") WHERE ("status" = 'PENDING'::"text");



CREATE INDEX "idx_reschedule_requests_mentor_status" ON "public"."reschedule_requests" USING "btree" ("mentor_id", "status", "created_at" DESC);



CREATE INDEX "idx_reschedule_requests_seeker" ON "public"."reschedule_requests" USING "btree" ("seeker_id", "created_at" DESC);



CREATE INDEX "idx_segment_topics_active_priority" ON "public"."segment_topics" USING "btree" ("segment_id", "priority", "name") WHERE ("is_active" = true);



CREATE INDEX "idx_segment_topics_segment_id" ON "public"."segment_topics" USING "btree" ("segment_id");



CREATE INDEX "idx_segment_topics_slug" ON "public"."segment_topics" USING "btree" ("slug");



CREATE INDEX "idx_segments_active_priority" ON "public"."segments" USING "btree" ("is_active", "priority" DESC);



CREATE INDEX "idx_segments_slug" ON "public"."segments" USING "btree" ("slug");



CREATE INDEX "idx_session_workspaces_booking_id" ON "public"."session_workspaces" USING "btree" ("booking_id");



CREATE INDEX "idx_session_workspaces_mentor_id" ON "public"."session_workspaces" USING "btree" ("mentor_id");



CREATE INDEX "idx_session_workspaces_seeker_id" ON "public"."session_workspaces" USING "btree" ("seeker_id");



CREATE INDEX "idx_session_workspaces_status" ON "public"."session_workspaces" USING "btree" ("status");



CREATE INDEX "idx_slot_holds_active_interval" ON "public"."slot_holds" USING "btree" ("mentor_id", "start_time", "end_time") WHERE ("status" = 'ACTIVE'::"text");



CREATE INDEX "idx_slot_holds_expires_at" ON "public"."slot_holds" USING "btree" ("expires_at") WHERE ("status" = 'ACTIVE'::"text");



CREATE INDEX "idx_slot_holds_mentor_status" ON "public"."slot_holds" USING "btree" ("mentor_id", "status");



CREATE INDEX "idx_support_attachments_message" ON "public"."support_attachments" USING "btree" ("message_id") WHERE ("message_id" IS NOT NULL);



CREATE INDEX "idx_support_attachments_ticket" ON "public"."support_attachments" USING "btree" ("ticket_id", "created_at");



CREATE INDEX "idx_support_audit_events_ticket_created" ON "public"."support_audit_events" USING "btree" ("ticket_id", "created_at" DESC);



CREATE INDEX "idx_support_messages_ticket_created" ON "public"."support_messages" USING "btree" ("ticket_id", "created_at");



CREATE INDEX "idx_support_tickets_assigned_admin" ON "public"."support_tickets" USING "btree" ("assigned_admin_id", "updated_at" DESC) WHERE ("assigned_admin_id" IS NOT NULL);



CREATE INDEX "idx_support_tickets_booking" ON "public"."support_tickets" USING "btree" ("booking_id") WHERE ("booking_id" IS NOT NULL);



CREATE INDEX "idx_support_tickets_payment" ON "public"."support_tickets" USING "btree" ("payment_id") WHERE ("payment_id" IS NOT NULL);



CREATE INDEX "idx_support_tickets_priority" ON "public"."support_tickets" USING "btree" ("priority") WHERE ("priority" = ANY (ARRAY['HIGH'::"text", 'URGENT'::"text"]));



CREATE INDEX "idx_support_tickets_queue" ON "public"."support_tickets" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_support_tickets_requester" ON "public"."support_tickets" USING "btree" ("requester_id", "created_at" DESC);



CREATE INDEX "idx_support_tickets_status" ON "public"."support_tickets" USING "btree" ("status", "updated_at" DESC);



CREATE INDEX "idx_system_logs_category" ON "public"."system_logs" USING "btree" ("category");



CREATE INDEX "idx_system_logs_created_at" ON "public"."system_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_system_logs_created_category" ON "public"."system_logs" USING "btree" ("created_at" DESC, "category");



CREATE INDEX "idx_system_logs_level" ON "public"."system_logs" USING "btree" ("level");



CREATE INDEX "idx_system_logs_path" ON "public"."system_logs" USING "btree" ("path");



CREATE INDEX "idx_system_logs_request_id" ON "public"."system_logs" USING "btree" ("request_id");



CREATE INDEX "idx_system_logs_status_code" ON "public"."system_logs" USING "btree" ("status_code");



CREATE INDEX "idx_system_logs_user_id" ON "public"."system_logs" USING "btree" ("user_id");



CREATE INDEX "idx_unmatched_captures_event_id" ON "public"."razorpay_unmatched_captures" USING "btree" ("event_id");



CREATE INDEX "idx_unmatched_captures_order_id" ON "public"."razorpay_unmatched_captures" USING "btree" ("razorpay_order_id") WHERE ("razorpay_order_id" IS NOT NULL);



CREATE INDEX "idx_unmatched_captures_pending" ON "public"."razorpay_unmatched_captures" USING "btree" ("received_at") WHERE ("reconciliation_status" = 'PENDING'::"text");



CREATE INDEX "idx_user_roles_role" ON "public"."user_roles" USING "btree" ("role");



CREATE INDEX "idx_user_roles_user_id" ON "public"."user_roles" USING "btree" ("user_id");



CREATE INDEX "idx_webhook_events_created_at" ON "public"."webhook_events" USING "btree" ("created_at");



CREATE INDEX "idx_webhook_events_processed" ON "public"."webhook_events" USING "btree" ("processed") WHERE ("processed" = false);



CREATE INDEX "idx_workspaces_booking_id" ON "public"."session_workspaces" USING "btree" ("booking_id");



CREATE INDEX "idx_workspaces_mentor_id" ON "public"."session_workspaces" USING "btree" ("mentor_id");



CREATE INDEX "idx_workspaces_seeker_id" ON "public"."session_workspaces" USING "btree" ("seeker_id");



CREATE UNIQUE INDEX "mentor_profiles_id_key" ON "public"."mentor_profiles" USING "btree" ("id");



CREATE UNIQUE INDEX "uniq_notifications_session_completed" ON "public"."notifications" USING "btree" ("user_id", "entity_id") WHERE ("event_type" = 'SESSION_COMPLETED'::"text");



CREATE UNIQUE INDEX "uq_active_gig_per_mentor_segment" ON "public"."gigs" USING "btree" ("mentor_id", "segment_id") WHERE ("is_active" = true);



CREATE UNIQUE INDEX "uq_gigs_mentor_segment_active" ON "public"."gigs" USING "btree" ("mentor_id", "segment_id") WHERE ("is_active" = true);



CREATE UNIQUE INDEX "uq_reschedule_requests_pending_booking" ON "public"."reschedule_requests" USING "btree" ("booking_id") WHERE ("status" = 'PENDING'::"text");



CREATE UNIQUE INDEX "uq_session_workspaces_booking_id" ON "public"."session_workspaces" USING "btree" ("booking_id");



CREATE OR REPLACE TRIGGER "trg_mvp_bookings_updated" BEFORE UPDATE ON "mvp"."bookings" FOR EACH ROW EXECUTE FUNCTION "mvp_private"."update_timestamps"();



CREATE OR REPLACE TRIGGER "trg_mvp_gigs_updated" BEFORE UPDATE ON "mvp"."gigs" FOR EACH ROW EXECUTE FUNCTION "mvp_private"."update_timestamps"();



CREATE OR REPLACE TRIGGER "trg_mvp_mentor_availability_updated" BEFORE UPDATE ON "mvp"."mentor_availability" FOR EACH ROW EXECUTE FUNCTION "mvp_private"."update_timestamps"();



CREATE OR REPLACE TRIGGER "trg_mvp_mentor_exceptions_updated" BEFORE UPDATE ON "mvp"."mentor_availability_exceptions" FOR EACH ROW EXECUTE FUNCTION "mvp_private"."update_timestamps"();



CREATE OR REPLACE TRIGGER "trg_mvp_mentor_profiles_updated" BEFORE UPDATE ON "mvp"."mentor_profiles" FOR EACH ROW EXECUTE FUNCTION "mvp_private"."update_timestamps"();



CREATE OR REPLACE TRIGGER "trg_mvp_payments_updated" BEFORE UPDATE ON "mvp"."payments" FOR EACH ROW EXECUTE FUNCTION "mvp_private"."update_timestamps"();



CREATE OR REPLACE TRIGGER "trg_mvp_profiles_updated" BEFORE UPDATE ON "mvp"."profiles" FOR EACH ROW EXECUTE FUNCTION "mvp_private"."update_timestamps"();



CREATE OR REPLACE TRIGGER "trg_mvp_seeker_profiles_updated" BEFORE UPDATE ON "mvp"."seeker_profiles" FOR EACH ROW EXECUTE FUNCTION "mvp_private"."update_timestamps"();



CREATE OR REPLACE TRIGGER "trg_mvp_session_workspaces_updated" BEFORE UPDATE ON "mvp"."session_workspaces" FOR EACH ROW EXECUTE FUNCTION "mvp_private"."update_timestamps"();



CREATE OR REPLACE TRIGGER "trg_bookings_coupon_usage" AFTER UPDATE OF "status" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."sync_coupon_usage_for_booking"();



CREATE OR REPLACE TRIGGER "trg_bookings_offer_identity" BEFORE INSERT OR UPDATE OF "mentor_id", "segment_id", "gig_id" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."assert_booking_offer_identity"();



CREATE OR REPLACE TRIGGER "trg_coupons_updated_at" BEFORE UPDATE ON "public"."coupons" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_gig_topics_segment_ownership" BEFORE INSERT OR UPDATE ON "public"."gig_topics" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_gig_topic_segment_ownership"();



CREATE OR REPLACE TRIGGER "trg_mentor_applications_updated_at" BEFORE UPDATE ON "public"."mentor_applications" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_mentor_docs_updated_at" BEFORE UPDATE ON "public"."mentor_verification_documents" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_mentor_document_types_updated_at" BEFORE UPDATE ON "public"."mentor_document_types" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_reschedule_requests_updated_at" BEFORE UPDATE ON "public"."reschedule_requests" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_session_workspaces_participant_identity" BEFORE INSERT OR UPDATE OF "booking_id", "mentor_id", "seeker_id" ON "public"."session_workspaces" FOR EACH ROW EXECUTE FUNCTION "public"."assert_workspace_participant_identity"();



CREATE OR REPLACE TRIGGER "trg_support_messages_updated_at" BEFORE UPDATE ON "public"."support_messages" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_support_tickets_updated_at" BEFORE UPDATE ON "public"."support_tickets" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "mvp"."audit_logs"
    ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "mvp"."bookings"
    ADD CONSTRAINT "bookings_gig_id_fkey" FOREIGN KEY ("gig_id") REFERENCES "mvp"."gigs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "mvp"."bookings"
    ADD CONSTRAINT "bookings_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "mvp"."bookings"
    ADD CONSTRAINT "bookings_seeker_id_fkey" FOREIGN KEY ("seeker_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "mvp"."bookings"
    ADD CONSTRAINT "bookings_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "mvp"."segments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "mvp"."gigs"
    ADD CONSTRAINT "gigs_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "mvp"."gigs"
    ADD CONSTRAINT "gigs_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "mvp"."segments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "mvp"."mentor_availability_exceptions"
    ADD CONSTRAINT "mentor_availability_exceptions_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "mvp"."mentor_availability"
    ADD CONSTRAINT "mentor_availability_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "mvp"."mentor_profiles"
    ADD CONSTRAINT "mentor_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "mvp"."mentor_segments"
    ADD CONSTRAINT "mentor_segments_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "mvp"."mentor_segments"
    ADD CONSTRAINT "mentor_segments_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "mvp"."segments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "mvp"."mentor_time_reservations"
    ADD CONSTRAINT "mentor_time_reservations_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "mvp"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "mvp"."payments"
    ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "mvp"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "mvp"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "mvp"."seeker_profiles"
    ADD CONSTRAINT "seeker_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "mvp"."session_workspaces"
    ADD CONSTRAINT "session_workspaces_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "mvp"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "mvp"."slot_holds"
    ADD CONSTRAINT "slot_holds_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "mvp"."slot_holds"
    ADD CONSTRAINT "slot_holds_seeker_id_fkey" FOREIGN KEY ("seeker_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "mvp"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_gig_id_fkey" FOREIGN KEY ("gig_id") REFERENCES "public"."gigs"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_hold_id_fkey" FOREIGN KEY ("hold_id") REFERENCES "public"."slot_holds"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_seeker_id_fkey" FOREIGN KEY ("seeker_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."coupon_usage"
    ADD CONSTRAINT "coupon_usage_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coupon_usage"
    ADD CONSTRAINT "coupon_usage_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coupon_usage"
    ADD CONSTRAINT "coupon_usage_seeker_id_fkey" FOREIGN KEY ("seeker_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."coupons"
    ADD CONSTRAINT "coupons_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."coupons"
    ADD CONSTRAINT "coupons_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coupons"
    ADD CONSTRAINT "coupons_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gig_topics"
    ADD CONSTRAINT "gig_topics_gig_id_fkey" FOREIGN KEY ("gig_id") REFERENCES "public"."gigs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gig_topics"
    ADD CONSTRAINT "gig_topics_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "public"."segment_topics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gigs"
    ADD CONSTRAINT "gigs_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gigs"
    ADD CONSTRAINT "gigs_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."login_failure_config"
    ADD CONSTRAINT "login_failure_config_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mentor_application_audit"
    ADD CONSTRAINT "mentor_application_audit_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mentor_application_audit"
    ADD CONSTRAINT "mentor_application_audit_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."mentor_applications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mentor_applications"
    ADD CONSTRAINT "mentor_applications_auth_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mentor_applications"
    ADD CONSTRAINT "mentor_applications_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mentor_applications"
    ADD CONSTRAINT "mentor_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mentor_availability_exceptions"
    ADD CONSTRAINT "mentor_availability_exceptions_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mentor_availability"
    ADD CONSTRAINT "mentor_availability_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mentor_profiles"
    ADD CONSTRAINT "mentor_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mentor_segments"
    ADD CONSTRAINT "mentor_segments_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mentor_segments"
    ADD CONSTRAINT "mentor_segments_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mentor_verification_documents"
    ADD CONSTRAINT "mentor_verification_documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."mentor_applications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mentor_verification_documents"
    ADD CONSTRAINT "mentor_verification_documents_document_type_fkey" FOREIGN KEY ("document_type") REFERENCES "public"."mentor_document_types"("code") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."mentor_verification_documents"
    ADD CONSTRAINT "mentor_verification_documents_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_events"
    ADD CONSTRAINT "payment_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payment_events"
    ADD CONSTRAINT "payment_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_seeker_id_fkey" FOREIGN KEY ("seeker_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."platform_config"
    ADD CONSTRAINT "platform_config_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."razorpay_unmatched_captures"
    ADD CONSTRAINT "razorpay_unmatched_captures_resolved_payment_id_fkey" FOREIGN KEY ("resolved_payment_id") REFERENCES "public"."payments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reschedule_requests"
    ADD CONSTRAINT "reschedule_requests_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reschedule_requests"
    ADD CONSTRAINT "reschedule_requests_hold_id_fkey" FOREIGN KEY ("hold_id") REFERENCES "public"."slot_holds"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reschedule_requests"
    ADD CONSTRAINT "reschedule_requests_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reschedule_requests"
    ADD CONSTRAINT "reschedule_requests_seeker_id_fkey" FOREIGN KEY ("seeker_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seeker_profiles"
    ADD CONSTRAINT "seeker_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."segment_topics"
    ADD CONSTRAINT "segment_topics_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_workspaces"
    ADD CONSTRAINT "session_workspaces_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_workspaces"
    ADD CONSTRAINT "session_workspaces_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."session_workspaces"
    ADD CONSTRAINT "session_workspaces_seeker_id_fkey" FOREIGN KEY ("seeker_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."slot_holds"
    ADD CONSTRAINT "slot_holds_gig_id_fkey" FOREIGN KEY ("gig_id") REFERENCES "public"."gigs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."slot_holds"
    ADD CONSTRAINT "slot_holds_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."slot_holds"
    ADD CONSTRAINT "slot_holds_seeker_id_fkey" FOREIGN KEY ("seeker_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."support_attachments"
    ADD CONSTRAINT "support_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."support_messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."support_attachments"
    ADD CONSTRAINT "support_attachments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."support_attachments"
    ADD CONSTRAINT "support_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."support_audit_events"
    ADD CONSTRAINT "support_audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."support_audit_events"
    ADD CONSTRAINT "support_audit_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."support_messages"
    ADD CONSTRAINT "support_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."support_messages"
    ADD CONSTRAINT "support_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_assigned_admin_id_fkey" FOREIGN KEY ("assigned_admin_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."system_log_retention"
    ADD CONSTRAINT "system_log_retention_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Admin can manage all availability" ON "mvp"."mentor_availability" TO "authenticated" USING ("mvp_private"."is_admin"()) WITH CHECK ("mvp_private"."is_admin"());



CREATE POLICY "Admin can manage all exceptions" ON "mvp"."mentor_availability_exceptions" TO "authenticated" USING ("mvp_private"."is_admin"()) WITH CHECK ("mvp_private"."is_admin"());



CREATE POLICY "Admin can manage all gigs" ON "mvp"."gigs" TO "authenticated" USING ("mvp_private"."is_admin"()) WITH CHECK ("mvp_private"."is_admin"());



CREATE POLICY "Admin can manage all mentor segments" ON "mvp"."mentor_segments" TO "authenticated" USING ("mvp_private"."is_admin"()) WITH CHECK ("mvp_private"."is_admin"());



CREATE POLICY "Admin can manage segments" ON "mvp"."segments" TO "authenticated" USING ("mvp_private"."is_admin"()) WITH CHECK ("mvp_private"."is_admin"());



CREATE POLICY "Admin can read all audit logs" ON "mvp"."audit_logs" FOR SELECT TO "authenticated" USING ("mvp_private"."is_admin"());



CREATE POLICY "Admin can read all reservations" ON "mvp"."mentor_time_reservations" FOR SELECT TO "authenticated" USING ("mvp_private"."is_admin"());



CREATE POLICY "Admin can read all seeker profiles" ON "mvp"."seeker_profiles" FOR SELECT TO "authenticated" USING ("mvp_private"."is_admin"());



CREATE POLICY "Admin can read all user roles" ON "mvp"."user_roles" FOR SELECT TO "authenticated" USING ("mvp_private"."is_admin"());



CREATE POLICY "Admin can update all bookings" ON "mvp"."bookings" FOR UPDATE TO "authenticated" USING ("mvp_private"."is_admin"()) WITH CHECK ("mvp_private"."is_admin"());



CREATE POLICY "Admin can update all holds" ON "mvp"."slot_holds" FOR UPDATE TO "authenticated" USING ("mvp_private"."is_admin"()) WITH CHECK ("mvp_private"."is_admin"());



CREATE POLICY "Admin can update mentor profiles" ON "mvp"."mentor_profiles" FOR UPDATE TO "authenticated" USING ("mvp_private"."is_admin"()) WITH CHECK ("mvp_private"."is_admin"());



CREATE POLICY "Admin can update payments" ON "mvp"."payments" FOR UPDATE TO "authenticated" USING ("mvp_private"."is_admin"()) WITH CHECK ("mvp_private"."is_admin"());



CREATE POLICY "Admin can update seeker profiles" ON "mvp"."seeker_profiles" FOR UPDATE TO "authenticated" USING ("mvp_private"."is_admin"()) WITH CHECK ("mvp_private"."is_admin"());



CREATE POLICY "Authenticated users can read active availability" ON "mvp"."mentor_availability" FOR SELECT TO "authenticated" USING ((("is_active" = true) OR "mvp_private"."is_admin"()));



CREATE POLICY "Authenticated users can read active exceptions" ON "mvp"."mentor_availability_exceptions" FOR SELECT TO "authenticated" USING (("status" = 'active'::"mvp"."segment_status"));



CREATE POLICY "Authenticated users can read active gigs" ON "mvp"."gigs" FOR SELECT TO "authenticated" USING (("is_active" = true));



CREATE POLICY "Authenticated users can read active segments" ON "mvp"."segments" FOR SELECT TO "authenticated" USING ((("is_active" = 'active'::"mvp"."segment_status") OR "mvp_private"."is_admin"()));



CREATE POLICY "Authenticated users can read mentor profiles" ON "mvp"."mentor_profiles" FOR SELECT TO "authenticated" USING (((("approval_status" = 'approved'::"mvp"."mentor_approval_status") AND ("is_active" = true)) OR "mvp_private"."is_admin"()));



CREATE POLICY "Authenticated users can read mentor segments" ON "mvp"."mentor_segments" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read profiles" ON "mvp"."profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Mentor can manage own availability" ON "mvp"."mentor_availability" TO "authenticated" USING (("auth"."uid"() = "mentor_id")) WITH CHECK (("auth"."uid"() = "mentor_id"));



CREATE POLICY "Mentor can manage own exceptions" ON "mvp"."mentor_availability_exceptions" TO "authenticated" USING (("auth"."uid"() = "mentor_id")) WITH CHECK (("auth"."uid"() = "mentor_id"));



CREATE POLICY "Mentor can manage own gigs" ON "mvp"."gigs" TO "authenticated" USING (("auth"."uid"() = "mentor_id")) WITH CHECK (("auth"."uid"() = "mentor_id"));



CREATE POLICY "Mentor can manage own memberships" ON "mvp"."mentor_segments" TO "authenticated" USING (("auth"."uid"() = "mentor_id")) WITH CHECK (("auth"."uid"() = "mentor_id"));



CREATE POLICY "Mentor can manage own reservations" ON "mvp"."mentor_time_reservations" TO "authenticated" USING (("auth"."uid"() = "mentor_id")) WITH CHECK (("auth"."uid"() = "mentor_id"));



CREATE POLICY "Mentor can read own mentor profile" ON "mvp"."mentor_profiles" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Mentor can read own reservations" ON "mvp"."mentor_time_reservations" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "mentor_id"));



CREATE POLICY "Mentor can update own bookings" ON "mvp"."bookings" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "mentor_id")) WITH CHECK (("auth"."uid"() = "mentor_id"));



CREATE POLICY "Mentor can update own mentor profile" ON "mvp"."mentor_profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Mentor can update own workspace" ON "mvp"."session_workspaces" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = ( SELECT "b"."mentor_id"
   FROM "mvp"."bookings" "b"
  WHERE ("b"."id" = "session_workspaces"."booking_id")))) WITH CHECK (("auth"."uid"() = ( SELECT "b"."mentor_id"
   FROM "mvp"."bookings" "b"
  WHERE ("b"."id" = "session_workspaces"."booking_id"))));



CREATE POLICY "Seeker can create bookings" ON "mvp"."bookings" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "seeker_id"));



CREATE POLICY "Seeker can create holds" ON "mvp"."slot_holds" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "seeker_id"));



CREATE POLICY "Seeker can read own bookings" ON "mvp"."bookings" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "seeker_id") OR ("auth"."uid"() = "mentor_id") OR "mvp_private"."is_admin"()));



CREATE POLICY "Seeker can read own holds" ON "mvp"."slot_holds" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "seeker_id") OR ("auth"."uid"() = "mentor_id") OR "mvp_private"."is_admin"()));



CREATE POLICY "Seeker can read own payments" ON "mvp"."payments" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = ( SELECT "b"."seeker_id"
   FROM "mvp"."bookings" "b"
  WHERE ("b"."id" = "payments"."booking_id"))) OR ("auth"."uid"() = ( SELECT "b"."mentor_id"
   FROM "mvp"."bookings" "b"
  WHERE ("b"."id" = "payments"."booking_id"))) OR "mvp_private"."is_admin"()));



CREATE POLICY "Seeker can read own workspace" ON "mvp"."session_workspaces" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = ( SELECT "b"."seeker_id"
   FROM "mvp"."bookings" "b"
  WHERE ("b"."id" = "session_workspaces"."booking_id"))) OR ("auth"."uid"() = ( SELECT "b"."mentor_id"
   FROM "mvp"."bookings" "b"
  WHERE ("b"."id" = "session_workspaces"."booking_id"))) OR "mvp_private"."is_admin"()));



CREATE POLICY "Seeker can update own holds" ON "mvp"."slot_holds" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "seeker_id")) WITH CHECK (("auth"."uid"() = "seeker_id"));



CREATE POLICY "Service role can insert audit logs" ON "mvp"."audit_logs" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "Users can insert own role" ON "mvp"."user_roles" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own audit logs" ON "mvp"."audit_logs" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "actor_id"));



CREATE POLICY "Users can read own notifications" ON "mvp"."notifications" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own role" ON "mvp"."user_roles" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own seeker profile" ON "mvp"."seeker_profiles" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own notifications" ON "mvp"."notifications" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile" ON "mvp"."profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can update own seeker profile" ON "mvp"."seeker_profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "mvp"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "mvp"."bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "mvp"."gigs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "mvp"."mentor_availability" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "mvp"."mentor_availability_exceptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "mvp"."mentor_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "mvp"."mentor_segments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "mvp"."mentor_time_reservations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "mvp"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "mvp"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "mvp"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "mvp"."seeker_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "mvp"."segments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "mvp"."session_workspaces" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "mvp"."slot_holds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "mvp"."user_roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Active segments are publicly readable" ON "public"."segments" FOR SELECT TO "authenticated" USING ((("is_active" = true) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'admin'::"text"))))));



CREATE POLICY "Active users can update own profile" ON "public"."profiles" FOR UPDATE USING ((("id" = "auth"."uid"()) AND (NOT "public"."is_account_suspended"("auth"."uid"()))));



CREATE POLICY "Admin operational delete access" ON "public"."session_workspaces" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "Admins can manage all mentor application audit" ON "public"."mentor_application_audit" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage all mentor applications" ON "public"."mentor_applications" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage all profiles" ON "public"."profiles" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage all verification documents" ON "public"."mentor_verification_documents" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage audit log" ON "public"."mentor_application_audit" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage audit_logs" ON "public"."audit_logs" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage coupon usage" ON "public"."coupon_usage" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage coupons" ON "public"."coupons" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage document types" ON "public"."mentor_document_types" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage gig topics" ON "public"."gig_topics" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage log retention" ON "public"."system_log_retention" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage login_failure_config" ON "public"."login_failure_config" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage payment events" ON "public"."payment_events" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage platform config" ON "public"."platform_config" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage razorpay unmatched captures" ON "public"."razorpay_unmatched_captures" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage segment topics" ON "public"."segment_topics" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage segments" ON "public"."segments" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage system_logs" ON "public"."system_logs" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage webhook events" ON "public"."webhook_events" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can read login_failure_trackers" ON "public"."login_failure_trackers" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admins can read mentor application audit" ON "public"."mentor_application_audit" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can review verification documents" ON "public"."mentor_verification_documents" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update any mentor profile" ON "public"."mentor_profiles" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can update any profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can view all profiles" ON "public"."profiles" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admins can view all roles" ON "public"."user_roles" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admins can view support audit events" ON "public"."support_audit_events" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Allow authenticated users and admin to insert notifications" ON "public"."notifications" FOR INSERT WITH CHECK ((("auth"."uid"() IS NOT NULL) OR "public"."is_admin"()));



CREATE POLICY "Allow authenticated users to insert own or admin can insert for" ON "public"."notifications" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") OR "public"."is_admin"()));



CREATE POLICY "Anyone can view active document types" ON "public"."mentor_document_types" FOR SELECT USING ((("is_active" = true) OR "public"."is_admin"()));



CREATE POLICY "Anyone can view active gig topics" ON "public"."gig_topics" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (("public"."gigs" "g"
     JOIN "public"."segments" "s" ON (("s"."id" = "g"."segment_id")))
     JOIN "public"."segment_topics" "t" ON (("t"."id" = "gig_topics"."topic_id")))
  WHERE (("g"."id" = "gig_topics"."gig_id") AND ("t"."id" = "gig_topics"."topic_id") AND ("t"."segment_id" = "g"."segment_id") AND ("g"."is_active" = true) AND ("t"."is_active" = true) AND ("s"."is_active" = true)))));



CREATE POLICY "Anyone can view active gigs of approved mentors" ON "public"."gigs" FOR SELECT USING (((("is_active" = true) AND "public"."mentor_is_publicly_visible"("mentor_id")) OR ("mentor_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Anyone can view active segment topics" ON "public"."segment_topics" FOR SELECT USING ((("is_active" = true) AND (EXISTS ( SELECT 1
   FROM "public"."segments" "s"
  WHERE (("s"."id" = "segment_topics"."segment_id") AND ("s"."is_active" = true))))));



CREATE POLICY "Anyone can view active segments" ON "public"."segments" FOR SELECT USING ((("is_active" = true) OR "public"."is_admin"()));



CREATE POLICY "Anyone can view approved mentor profiles" ON "public"."mentor_profiles" FOR SELECT USING (("public"."mentor_is_publicly_visible"("id") OR ("id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Anyone can view mentor availability exceptions" ON "public"."mentor_availability_exceptions" FOR SELECT USING (("public"."mentor_is_publicly_visible"("mentor_id") OR ("mentor_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Anyone can view mentor availability rules" ON "public"."mentor_availability" FOR SELECT USING (("public"."mentor_is_publicly_visible"("mentor_id") OR ("mentor_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Anyone can view mentor segments" ON "public"."mentor_segments" FOR SELECT USING (("public"."mentor_is_publicly_visible"("mentor_id") OR ("mentor_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Applicants can create own application" ON "public"."mentor_applications" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Applicants can insert own documents" ON "public"."mentor_verification_documents" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."mentor_applications" "a"
  WHERE (("a"."id" = "mentor_verification_documents"."application_id") AND ("a"."user_id" = "auth"."uid"()) AND ("a"."status" = ANY (ARRAY['draft'::"text", 'rejected'::"text"]))))));



CREATE POLICY "Applicants can manage own draft documents" ON "public"."mentor_verification_documents" USING ((EXISTS ( SELECT 1
   FROM "public"."mentor_applications" "a"
  WHERE (("a"."id" = "mentor_verification_documents"."application_id") AND ("a"."user_id" = "auth"."uid"()) AND ("a"."status" = ANY (ARRAY['draft'::"text", 'rejected'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."mentor_applications" "a"
  WHERE (("a"."id" = "mentor_verification_documents"."application_id") AND ("a"."user_id" = "auth"."uid"()) AND ("a"."status" = ANY (ARRAY['draft'::"text", 'rejected'::"text"]))))));



CREATE POLICY "Applicants can update own draft/rejected application" ON "public"."mentor_applications" FOR UPDATE USING ((("user_id" = "auth"."uid"()) AND ("status" = ANY (ARRAY['draft'::"text", 'rejected'::"text"])))) WITH CHECK ((("user_id" = "auth"."uid"()) AND ("status" = ANY (ARRAY['draft'::"text", 'rejected'::"text"]))));



CREATE POLICY "Applicants can update own draft/rejected documents" ON "public"."mentor_verification_documents" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."mentor_applications" "a"
  WHERE (("a"."id" = "mentor_verification_documents"."application_id") AND ("a"."user_id" = "auth"."uid"()) AND ("a"."status" = ANY (ARRAY['draft'::"text", 'rejected'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."mentor_applications" "a"
  WHERE (("a"."id" = "mentor_verification_documents"."application_id") AND ("a"."user_id" = "auth"."uid"()) AND ("a"."status" = ANY (ARRAY['draft'::"text", 'rejected'::"text"]))))));



CREATE POLICY "Applicants can view own application" ON "public"."mentor_applications" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Applicants can view own audit log" ON "public"."mentor_application_audit" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."mentor_applications" "a"
  WHERE (("a"."id" = "mentor_application_audit"."application_id") AND ("a"."user_id" = "auth"."uid"())))));



CREATE POLICY "Applicants can view own documents" ON "public"."mentor_verification_documents" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."mentor_applications" "a"
  WHERE (("a"."id" = "mentor_verification_documents"."application_id") AND (("a"."user_id" = "auth"."uid"()) OR "public"."is_admin"())))));



CREATE POLICY "Authenticated users can view mentor profiles" ON "public"."profiles" FOR SELECT USING ((("auth"."role"() = 'authenticated'::"text") AND "public"."has_role"("id", 'mentor'::"text")));



CREATE POLICY "Mentor applicants can manage own documents" ON "public"."mentor_verification_documents" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."mentor_applications" "a"
  WHERE (("a"."id" = "mentor_verification_documents"."application_id") AND ("a"."user_id" = "auth"."uid"()) AND ("a"."status" = ANY (ARRAY['draft'::"text", 'rejected'::"text"]))))));



CREATE POLICY "Mentor document types are readable" ON "public"."mentor_document_types" FOR SELECT TO "authenticated" USING ((("is_active" = true) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'admin'::"text"))))));



CREATE POLICY "Mentor segment membership is readable by authenticated users" ON "public"."mentor_segments" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Mentors and admins can read verification documents" ON "public"."mentor_verification_documents" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."mentor_applications" "a"
  WHERE (("a"."id" = "mentor_verification_documents"."application_id") AND ("a"."user_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'admin'::"text"))))));



CREATE POLICY "Mentors can create own gigs" ON "public"."gigs" FOR INSERT WITH CHECK (((("mentor_id" = "auth"."uid"()) AND "public"."has_role"("auth"."uid"(), 'mentor'::"text")) OR "public"."is_admin"()));



CREATE POLICY "Mentors can create own workspace, admin operational access" ON "public"."session_workspaces" FOR INSERT WITH CHECK (((("mentor_id" = "auth"."uid"()) AND "public"."has_role"("auth"."uid"(), 'mentor'::"text")) OR "public"."is_admin"()));



CREATE POLICY "Mentors can delete own gigs" ON "public"."gigs" FOR DELETE USING ((("mentor_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Mentors can manage own availability" ON "public"."mentor_availability" USING ((("mentor_id" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK ((("mentor_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Mentors can manage own exceptions" ON "public"."mentor_availability_exceptions" USING ((("mentor_id" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK ((("mentor_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Mentors can update own editable profile fields" ON "public"."mentor_profiles" FOR UPDATE TO "authenticated" USING ((("id" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK ((("id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Mentors can update own gigs" ON "public"."gigs" FOR UPDATE USING ((("mentor_id" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK ((("mentor_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Mentors can update own workspace, admin operational access" ON "public"."session_workspaces" FOR UPDATE USING ((("mentor_id" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK ((("mentor_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Mentors or admin can insert mentor profile" ON "public"."mentor_profiles" FOR INSERT WITH CHECK ((("id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Mentors or admin can manage mentor segments" ON "public"."mentor_segments" USING ((("mentor_id" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK ((("mentor_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Only admin can delete mentor profiles" ON "public"."mentor_profiles" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "Only admins can delete roles" ON "public"."user_roles" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "Only admins can insert roles" ON "public"."user_roles" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "Only admins can update payment verification status" ON "public"."payments" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Only admins can update roles" ON "public"."user_roles" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Participants and admin can view bookings" ON "public"."bookings" FOR SELECT USING ((("seeker_id" = "auth"."uid"()) OR ("mentor_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Participants and admin can view slot holds" ON "public"."slot_holds" FOR SELECT USING ((("seeker_id" = "auth"."uid"()) OR ("mentor_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Participants can update bookings within authorization" ON "public"."bookings" FOR UPDATE USING ((("seeker_id" = "auth"."uid"()) OR ("mentor_id" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK ((("seeker_id" = "auth"."uid"()) OR ("mentor_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Participants can view public support messages" ON "public"."support_messages" FOR SELECT USING (("public"."is_admin"() OR (("is_internal" = false) AND (EXISTS ( SELECT 1
   FROM "public"."support_tickets" "t"
  WHERE (("t"."id" = "support_messages"."ticket_id") AND ("t"."requester_id" = "auth"."uid"())))))));



CREATE POLICY "Participants can view their own reschedule requests" ON "public"."reschedule_requests" FOR SELECT USING ((("auth"."uid"() = "seeker_id") OR ("auth"."uid"() = "mentor_id") OR "public"."is_admin"()));



CREATE POLICY "Participants can view their own support attachments" ON "public"."support_attachments" FOR SELECT USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."support_tickets" "t"
  WHERE (("t"."id" = "support_attachments"."ticket_id") AND ("t"."requester_id" = "auth"."uid"()))))));



CREATE POLICY "Participants can view their own support tickets" ON "public"."support_tickets" FOR SELECT USING ((("requester_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Seeker view published or completed, mentor view own, admin view" ON "public"."session_workspaces" FOR SELECT USING (((("seeker_id" = "auth"."uid"()) AND ("status" = 'PUBLISHED'::"text")) OR ("mentor_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Seekers and admins can view payments" ON "public"."payments" FOR SELECT USING ((("seeker_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Seekers can create slot holds" ON "public"."slot_holds" FOR INSERT WITH CHECK ((("seeker_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Seekers can insert initial bookings" ON "public"."bookings" FOR INSERT WITH CHECK ((("seeker_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Seekers can manage own profile" ON "public"."seeker_profiles" USING ((("id" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK ((("id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Seekers can submit payment proofs" ON "public"."payments" FOR INSERT WITH CHECK ((("seeker_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Seekers can view own payment events" ON "public"."payment_events" FOR SELECT USING (("payment_id" IN ( SELECT "pe"."payment_id"
   FROM ("public"."payment_events" "pe"
     JOIN "public"."payments" "p" ON (("p"."id" = "pe"."payment_id")))
  WHERE ("p"."seeker_id" = "auth"."uid"()))));



CREATE POLICY "Seekers can view own profile or admin" ON "public"."seeker_profiles" FOR SELECT USING ((("id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Seekers or admin can update slot holds" ON "public"."slot_holds" FOR UPDATE USING ((("seeker_id" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK ((("seeker_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Users can delete own profile" ON "public"."profiles" FOR DELETE USING ((("auth"."uid"() = "id") OR "public"."is_admin"()));



CREATE POLICY "Users can insert own profile" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can mark own notifications as read" ON "public"."notifications" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update own notifications" ON "public"."notifications" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own or admin update notifications" ON "public"."notifications" FOR UPDATE USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Users can update own own editable columns" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((("id" = "auth"."uid"()) AND (NOT "public"."is_account_suspended"("auth"."uid"())))) WITH CHECK ((("id" = "auth"."uid"()) AND (NOT "public"."is_account_suspended"("auth"."uid"()))));



CREATE POLICY "Users can view own notifications" ON "public"."notifications" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own or admin view all notifications" ON "public"."notifications" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Users can view own profile" ON "public"."profiles" FOR SELECT USING ((("id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Users can view own roles" ON "public"."user_roles" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."coupon_usage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."coupons" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gig_topics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gigs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."login_failure_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."login_failure_trackers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mentor_application_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mentor_applications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mentor_availability" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mentor_availability_exceptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mentor_document_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mentor_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mentor_segments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mentor_verification_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."razorpay_unmatched_captures" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reschedule_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."seeker_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."segment_topics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."segments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."session_workspaces" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."slot_holds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_attachments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_audit_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_tickets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_log_retention" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."webhook_events" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."bookings";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."gigs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."mentor_availability";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."mentor_availability_exceptions";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."notifications";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."payment_events";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."payments";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."segment_topics";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."segments";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."slot_holds";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."webhook_events";






GRANT USAGE ON SCHEMA "mvp" TO "authenticated";
GRANT ALL ON SCHEMA "mvp" TO "service_role";



GRANT USAGE ON SCHEMA "mvp_private" TO "authenticated";
GRANT USAGE ON SCHEMA "mvp_private" TO "service_role";



REVOKE USAGE ON SCHEMA "public" FROM PUBLIC;
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT ALL ON SCHEMA "public" TO "authenticated";
GRANT ALL ON SCHEMA "public" TO "service_role";











































































































































































GRANT ALL ON FUNCTION "mvp_private"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "mvp_private"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "mvp_private"."is_mentor"() TO "authenticated";
GRANT ALL ON FUNCTION "mvp_private"."is_mentor"() TO "service_role";



GRANT ALL ON FUNCTION "mvp_private"."is_seeker"() TO "authenticated";
GRANT ALL ON FUNCTION "mvp_private"."is_seeker"() TO "service_role";



GRANT ALL ON FUNCTION "mvp_private"."validate_timezone"("p_timezone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "mvp_private"."validate_timezone"("p_timezone" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."_log_mentor_app_audit"("p_application_id" "uuid", "p_action" "text", "p_admin_user_id" "uuid", "p_rejection_reason" "text", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_log_mentor_app_audit"("p_application_id" "uuid", "p_action" "text", "p_admin_user_id" "uuid", "p_rejection_reason" "text", "p_metadata" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."slot_holds" TO "authenticated";
GRANT ALL ON TABLE "public"."slot_holds" TO "service_role";



REVOKE ALL ON FUNCTION "public"."acquire_slot_hold"("p_mentor_id" "uuid", "p_seeker_id" "uuid", "p_gig_id" "uuid", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."acquire_slot_hold"("p_mentor_id" "uuid", "p_seeker_id" "uuid", "p_gig_id" "uuid", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_support_attachment"("p_ticket_code" "text", "p_actor_id" "uuid", "p_storage_path" "text", "p_file_name" "text", "p_mime_type" "text", "p_file_size" integer, "p_message_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_support_attachment"("p_ticket_code" "text", "p_actor_id" "uuid", "p_storage_path" "text", "p_file_name" "text", "p_mime_type" "text", "p_file_size" integer, "p_message_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_support_internal_note"("p_ticket_code" "text", "p_admin_id" "uuid", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_support_internal_note"("p_ticket_code" "text", "p_admin_id" "uuid", "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_support_message"("p_ticket_code" "text", "p_actor_id" "uuid", "p_message" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_support_message"("p_ticket_code" "text", "p_actor_id" "uuid", "p_message" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_approve_payment"("p_payment_id" "uuid", "p_admin_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_approve_payment"("p_payment_id" "uuid", "p_admin_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_delete_profile_by_email"("p_email" "text", "p_except_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_delete_profile_by_email"("p_email" "text", "p_except_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_delete_test_mentor"("p_mentor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_delete_test_mentor"("p_mentor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_list_mentor_applications"("p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_mentor_applications"("p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_reject_payment"("p_payment_id" "uuid", "p_admin_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_reject_payment"("p_payment_id" "uuid", "p_admin_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_report_mentor_dependencies"("p_mentor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_report_mentor_dependencies"("p_mentor_id" "uuid") TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT UPDATE("full_name") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("avatar_url") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("timezone") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("phone") ON TABLE "public"."profiles" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_set_account_status"("p_user_id" "uuid", "p_action" "text", "p_reason" "text", "p_suspended_until" timestamp with time zone, "p_internal_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_account_status"("p_user_id" "uuid", "p_action" "text", "p_reason" "text", "p_suspended_until" timestamp with time zone, "p_internal_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_upsert_profile"("p_id" "uuid", "p_email" "text", "p_full_name" "text", "p_role" "public"."app_role", "p_is_demo" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_upsert_profile"("p_id" "uuid", "p_email" "text", "p_full_name" "text", "p_role" "public"."app_role", "p_is_demo" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_coupon_to_booking"("p_booking_id" "uuid", "p_coupon_code" "text", "p_seeker_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_coupon_to_booking"("p_booking_id" "uuid", "p_coupon_code" "text", "p_seeker_id" "uuid") TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."mentor_applications" TO "authenticated";
GRANT ALL ON TABLE "public"."mentor_applications" TO "service_role";



GRANT INSERT("user_id") ON TABLE "public"."mentor_applications" TO "authenticated";
GRANT INSERT("user_id") ON TABLE "public"."mentor_applications" TO "anon";



GRANT INSERT("full_name"),UPDATE("full_name") ON TABLE "public"."mentor_applications" TO "authenticated";
GRANT INSERT("full_name"),UPDATE("full_name") ON TABLE "public"."mentor_applications" TO "anon";



GRANT INSERT("bio"),UPDATE("bio") ON TABLE "public"."mentor_applications" TO "authenticated";
GRANT INSERT("bio"),UPDATE("bio") ON TABLE "public"."mentor_applications" TO "anon";



GRANT INSERT("timezone"),UPDATE("timezone") ON TABLE "public"."mentor_applications" TO "authenticated";
GRANT INSERT("timezone"),UPDATE("timezone") ON TABLE "public"."mentor_applications" TO "anon";



GRANT INSERT("years_of_experience"),UPDATE("years_of_experience") ON TABLE "public"."mentor_applications" TO "authenticated";
GRANT INSERT("years_of_experience"),UPDATE("years_of_experience") ON TABLE "public"."mentor_applications" TO "anon";



GRANT INSERT("headline"),UPDATE("headline") ON TABLE "public"."mentor_applications" TO "authenticated";
GRANT INSERT("headline"),UPDATE("headline") ON TABLE "public"."mentor_applications" TO "anon";



GRANT INSERT("requested_segment_ids"),UPDATE("requested_segment_ids") ON TABLE "public"."mentor_applications" TO "authenticated";
GRANT INSERT("requested_segment_ids"),UPDATE("requested_segment_ids") ON TABLE "public"."mentor_applications" TO "anon";



REVOKE ALL ON FUNCTION "public"."approve_mentor_application"("p_application_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."approve_mentor_application"("p_application_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."approve_mentor_application"("_application_id" "uuid", "_admin_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."approve_mentor_application"("_application_id" "uuid", "_admin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."assert_booking_offer_identity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assert_booking_offer_identity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."assert_workspace_participant_identity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assert_workspace_participant_identity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."booking_is_upcoming"("p_end_time" timestamp with time zone, "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."booking_is_upcoming"("p_end_time" timestamp with time zone, "p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_join_session"("p_booking_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_join_session"("p_booking_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_reschedule_request"("p_request_id" "uuid", "p_seeker_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_reschedule_request"("p_request_id" "uuid", "p_seeker_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_availability_overlap"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_availability_overlap"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_meeting_link_overdue"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_meeting_link_overdue"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_expired_holds"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_expired_holds"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_expired_sessions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_expired_sessions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_manual_refund"("p_payment_id" "uuid", "p_admin_id" "uuid", "p_amount_paise" integer, "p_method" "text", "p_reference" "text", "p_proof_path" "text", "p_admin_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_manual_refund"("p_payment_id" "uuid", "p_admin_id" "uuid", "p_amount_paise" integer, "p_method" "text", "p_reference" "text", "p_proof_path" "text", "p_admin_note" "text") TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."bookings" TO "service_role";



GRANT UPDATE("cancellation_reason") ON TABLE "public"."bookings" TO "authenticated";
GRANT UPDATE("cancellation_reason") ON TABLE "public"."bookings" TO "anon";



GRANT UPDATE("updated_at") ON TABLE "public"."bookings" TO "authenticated";
GRANT UPDATE("updated_at") ON TABLE "public"."bookings" TO "anon";



REVOKE ALL ON FUNCTION "public"."confirm_booking"("p_booking_id" "uuid", "p_meeting_url" "text", "p_mentor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_booking"("p_booking_id" "uuid", "p_meeting_url" "text", "p_mentor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."convert_hold_to_booking"("p_hold_id" "uuid", "p_seeker_id" "uuid", "p_booking_code" "text", "p_proof_storage_path" "text", "p_transaction_reference" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."convert_hold_to_booking"("p_hold_id" "uuid", "p_seeker_id" "uuid", "p_booking_code" "text", "p_proof_storage_path" "text", "p_transaction_reference" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_booking_with_hold"("p_seeker_id" "uuid", "p_mentor_id" "uuid", "p_segment_id" "uuid", "p_gig_id" "uuid", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_booking_with_hold"("p_seeker_id" "uuid", "p_mentor_id" "uuid", "p_segment_id" "uuid", "p_gig_id" "uuid", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) TO "service_role";
GRANT ALL ON FUNCTION "public"."create_booking_with_hold"("p_seeker_id" "uuid", "p_mentor_id" "uuid", "p_segment_id" "uuid", "p_gig_id" "uuid", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_or_update_mentor_application"("p_full_name" "text", "p_bio" "text", "p_timezone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_or_update_mentor_application"("p_full_name" "text", "p_bio" "text", "p_timezone" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_payment_booking"("p_mentor_id" "uuid", "p_scheduled_start" timestamp with time zone, "p_amount" numeric, "p_duration_mins" integer, "p_hold_id" "uuid", "p_currency" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_payment_booking"("p_mentor_id" "uuid", "p_scheduled_start" timestamp with time zone, "p_amount" numeric, "p_duration_mins" integer, "p_hold_id" "uuid", "p_currency" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_qr_payment"("p_booking_id" "uuid", "p_amount" numeric, "p_currency" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_qr_payment"("p_booking_id" "uuid", "p_amount" numeric, "p_currency" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_reschedule_request"("p_booking_id" "uuid", "p_seeker_id" "uuid", "p_requested_start_time" timestamp with time zone, "p_requested_end_time" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_reschedule_request"("p_booking_id" "uuid", "p_seeker_id" "uuid", "p_requested_start_time" timestamp with time zone, "p_requested_end_time" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_slot_hold"("p_mentor_id" "uuid", "p_scheduled_start" timestamp with time zone, "p_duration_mins" integer, "p_hold_minutes" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_slot_hold"("p_mentor_id" "uuid", "p_scheduled_start" timestamp with time zone, "p_duration_mins" integer, "p_hold_minutes" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_support_ticket"("p_requester_id" "uuid", "p_category" "text", "p_subject" "text", "p_message" "text", "p_booking_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_support_ticket"("p_requester_id" "uuid", "p_category" "text", "p_subject" "text", "p_message" "text", "p_booking_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_gig_topic_segment_ownership"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_gig_topic_segment_ownership"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."expire_stale_holds"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expire_stale_holds"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."expire_stale_reschedule_requests"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expire_stale_reschedule_requests"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_admin_session_view"("p_limit" integer, "p_offset" integer, "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_admin_session_view"("p_limit" integer, "p_offset" integer, "p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_all_booking_rules"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_all_booking_rules"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_bookable_slots"("p_mentor_id" "uuid", "p_date" "date", "p_student_timezone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_bookable_slots"("p_mentor_id" "uuid", "p_date" "date", "p_student_timezone" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_booking_rule"("p_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_booking_rule"("p_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_discoverable_mentors"("p_segment_id" "uuid", "p_date" "date", "p_student_timezone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_discoverable_mentors"("p_segment_id" "uuid", "p_date" "date", "p_student_timezone" "text") TO "service_role";



GRANT ALL ON TABLE "public"."mentor_document_types" TO "authenticated";
GRANT ALL ON TABLE "public"."mentor_document_types" TO "service_role";



GRANT ALL ON TABLE "public"."mentor_verification_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."mentor_verification_documents" TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_mentor_onboarding_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_mentor_onboarding_status"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_mentor_pending_bookings"("p_mentor_id" "uuid", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_mentor_pending_bookings"("p_mentor_id" "uuid", "p_limit" integer, "p_offset" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_reschedule_request_for_booking"("p_booking_id" "uuid", "p_caller_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_reschedule_request_for_booking"("p_booking_id" "uuid", "p_caller_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_session_access"("p_booking_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_session_access"("p_booking_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_subscription_summary"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_subscription_summary"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_support_ticket"("p_ticket_code" "text", "p_caller_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_support_ticket"("p_ticket_code" "text", "p_caller_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_role"("user_uuid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_role"("user_uuid" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_roles"("check_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_roles"("check_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_sessions"("p_user_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_sessions"("p_user_id" "uuid", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "supabase_auth_admin";



REVOKE ALL ON FUNCTION "public"."has_role"("check_user_id" "uuid", "check_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_role"("check_user_id" "uuid", "check_role" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."has_role"("check_user_id" "uuid", "check_role" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."hold_duration_interval"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."hold_duration_interval"() TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



REVOKE ALL ON FUNCTION "public"."insert_audit_log"("p_actor_user_id" "uuid", "p_actor_role" "text", "p_action" "text", "p_entity_type" "text", "p_entity_id" "text", "p_request_id" "text", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."insert_audit_log"("p_actor_user_id" "uuid", "p_actor_role" "text", "p_action" "text", "p_entity_type" "text", "p_entity_id" "text", "p_request_id" "text", "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."insert_notification"("p_user_id" "uuid", "p_title" "text", "p_body" "text", "p_category" "text", "p_kind" "text", "p_related_id" "uuid", "p_link" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."insert_notification"("p_user_id" "uuid", "p_title" "text", "p_body" "text", "p_category" "text", "p_kind" "text", "p_related_id" "uuid", "p_link" "text") TO "service_role";



GRANT ALL ON TABLE "public"."system_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."system_logs" TO "service_role";



REVOKE ALL ON FUNCTION "public"."insert_system_log"("p_request_id" "text", "p_level" "text", "p_category" "text", "p_method" "text", "p_path" "text", "p_status_code" integer, "p_duration_ms" integer, "p_user_id" "uuid", "p_role" "text", "p_error_code" "text", "p_message" "text", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."insert_system_log"("p_request_id" "text", "p_level" "text", "p_category" "text", "p_method" "text", "p_path" "text", "p_status_code" integer, "p_duration_ms" integer, "p_user_id" "uuid", "p_role" "text", "p_error_code" "text", "p_message" "text", "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_account_suspended"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_account_suspended"("p_user_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."is_account_suspended"("p_user_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_current_user_suspended"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_current_user_suspended"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_mentor"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_mentor"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_mentor_discoverable"("p_mentor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_mentor_discoverable"("p_mentor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_mentor_discoverable"("p_mentor_id" "uuid", "p_segment_id" "uuid", "p_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_mentor_discoverable"("p_mentor_id" "uuid", "p_segment_id" "uuid", "p_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_support_ticket_replyable"("p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_support_ticket_replyable"("p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_valid_support_transition"("p_from" "text", "p_to" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_valid_support_transition"("p_from" "text", "p_to" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."issue_auth_otp_hashed"("p_email" "text", "p_purpose" "text", "p_otp_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."issue_auth_otp_hashed"("p_email" "text", "p_purpose" "text", "p_otp_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_active_login_threats"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_active_login_threats"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_all_payments"("p_status" "text", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_all_payments"("p_status" "text", "p_limit" integer, "p_offset" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_pending_payments"("p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_pending_payments"("p_limit" integer, "p_offset" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_support_tickets"("p_caller_id" "uuid", "p_scope" "text", "p_status" "text", "p_priority" "text", "p_category" "text", "p_requester_role" "text", "p_assigned_admin_id" "uuid", "p_search" "text", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_support_tickets"("p_caller_id" "uuid", "p_scope" "text", "p_status" "text", "p_priority" "text", "p_category" "text", "p_requester_role" "text", "p_assigned_admin_id" "uuid", "p_search" "text", "p_limit" integer, "p_offset" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_all_notifications_as_read"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_all_notifications_as_read"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_notification_as_read"("p_notification_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_notification_as_read"("p_notification_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mentor_accept_booking_atomic"("p_request_id" "uuid", "p_mentor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mentor_accept_booking_atomic"("p_request_id" "uuid", "p_mentor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mentor_cancel_booking"("p_booking_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mentor_cancel_booking"("p_booking_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mentor_confirm_booking"("p_booking_id" "uuid", "p_meeting_link" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mentor_confirm_booking"("p_booking_id" "uuid", "p_meeting_link" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mentor_decline_booking_atomic"("p_request_id" "uuid", "p_mentor_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mentor_decline_booking_atomic"("p_request_id" "uuid", "p_mentor_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mentor_is_publicly_visible"("p_mentor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mentor_is_publicly_visible"("p_mentor_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."mentor_is_publicly_visible"("p_mentor_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."next_support_ticket_code"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."next_support_ticket_code"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prune_login_failure_trackers"("p_older_than_minutes" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prune_login_failure_trackers"("p_older_than_minutes" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."prune_system_logs"("p_retention_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prune_system_logs"("p_retention_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."purge_expired_auth_otps"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_expired_auth_otps"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."purge_expired_pending_signups"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_expired_pending_signups"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconcile_expired_bookings"("p_booking_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_expired_bookings"("p_booking_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconcile_expired_sessions"("p_booking_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_expired_sessions"("p_booking_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_login_failure"("p_identifier_key" "text", "p_failure_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_login_failure"("p_identifier_key" "text", "p_failure_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."register_mentor_document"("p_application_id" "uuid", "p_document_type" "text", "p_storage_path" "text", "p_original_filename" "text", "p_mime_type" "text", "p_size_bytes" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."register_mentor_document"("p_application_id" "uuid", "p_document_type" "text", "p_storage_path" "text", "p_original_filename" "text", "p_mime_type" "text", "p_size_bytes" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reject_mentor_application"("p_application_id" "uuid", "p_rejection_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reject_mentor_application"("p_application_id" "uuid", "p_rejection_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."release_slot_hold"("p_hold_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_slot_hold"("p_hold_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."remove_coupon_from_booking"("p_booking_id" "uuid", "p_seeker_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_coupon_from_booking"("p_booking_id" "uuid", "p_seeker_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reopen_support_ticket"("p_ticket_code" "text", "p_actor_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reopen_support_ticket"("p_ticket_code" "text", "p_actor_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reschedule_booking"("p_booking_id" "uuid", "p_new_start" timestamp with time zone, "p_new_duration" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reschedule_booking"("p_booking_id" "uuid", "p_new_start" timestamp with time zone, "p_new_duration" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reschedule_request_expiry_interval"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reschedule_request_expiry_interval"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."reschedule_window_interval"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reschedule_window_interval"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."reset_login_failures"("p_identifier_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reset_login_failures"("p_identifier_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."resolve_session_state"("p_status" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_actual_ended_at" timestamp with time zone, "p_now" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_session_state"("p_status" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_actual_ended_at" timestamp with time zone, "p_now" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_support_ticket"("p_ticket_code" "text", "p_admin_id" "uuid", "p_resolution" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_support_ticket"("p_ticket_code" "text", "p_admin_id" "uuid", "p_resolution" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."respond_to_reschedule_request"("p_request_id" "uuid", "p_mentor_id" "uuid", "p_decision" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."respond_to_reschedule_request"("p_request_id" "uuid", "p_mentor_id" "uuid", "p_decision" "text", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."review_mentor_document"("p_document_id" "uuid", "p_status" "text", "p_admin_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."review_mentor_document"("p_document_id" "uuid", "p_status" "text", "p_admin_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."review_payment"("p_payment_id" "uuid", "p_approve" boolean, "p_rejection_reason" "text", "p_admin_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."review_payment"("p_payment_id" "uuid", "p_approve" boolean, "p_rejection_reason" "text", "p_admin_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_mentor_application"("p_full_name" "text", "p_bio" "text", "p_headline" "text", "p_years_of_experience" integer, "p_timezone" "text", "p_requested_segment_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_mentor_application"("p_full_name" "text", "p_bio" "text", "p_headline" "text", "p_years_of_experience" integer, "p_timezone" "text", "p_requested_segment_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."seeker_cancel_booking"("p_booking_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."seeker_cancel_booking"("p_booking_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_meeting_link"("p_booking_id" "uuid", "p_meeting_link" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_meeting_link"("p_booking_id" "uuid", "p_meeting_link" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_mentor_application"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_mentor_application"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_mentor_application"("p_application_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_mentor_application"("p_application_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."support_ticket_metrics"("p_caller_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."support_ticket_metrics"("p_caller_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_coupon_usage_for_booking"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_coupon_usage_for_booking"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_availability_slots_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_availability_slots_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_booking_capacity_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_booking_capacity_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_booking_rules_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_booking_rules_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_categories_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_categories_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_payment_orders_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_payment_orders_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_sessions_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_sessions_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_support_ticket"("p_ticket_code" "text", "p_admin_id" "uuid", "p_status" "text", "p_priority" "text", "p_assigned_admin_id" "uuid", "p_unassign" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_support_ticket"("p_ticket_code" "text", "p_admin_id" "uuid", "p_status" "text", "p_priority" "text", "p_assigned_admin_id" "uuid", "p_unassign" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."upload_payment_proof"("p_payment_id" "uuid", "p_storage_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upload_payment_proof"("p_payment_id" "uuid", "p_storage_path" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."upsert_mentor_document"("p_application_id" "uuid", "p_document_type" "text", "p_storage_path" "text", "p_original_filename" "text", "p_mime_type" "text", "p_size_bytes" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_mentor_document"("p_application_id" "uuid", "p_document_type" "text", "p_storage_path" "text", "p_original_filename" "text", "p_mime_type" "text", "p_size_bytes" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."verify_auth_otp"("p_otp_id" "uuid", "p_otp" "text", "p_otp_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_auth_otp"("p_otp_id" "uuid", "p_otp" "text", "p_otp_hash" "text") TO "service_role";
























GRANT SELECT ON TABLE "mvp"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "mvp"."audit_logs" TO "service_role";



GRANT SELECT,INSERT,UPDATE ON TABLE "mvp"."bookings" TO "authenticated";
GRANT ALL ON TABLE "mvp"."bookings" TO "service_role";



GRANT SELECT ON TABLE "mvp"."gigs" TO "authenticated";
GRANT ALL ON TABLE "mvp"."gigs" TO "service_role";



GRANT SELECT ON TABLE "mvp"."mentor_availability" TO "authenticated";
GRANT ALL ON TABLE "mvp"."mentor_availability" TO "service_role";



GRANT SELECT ON TABLE "mvp"."mentor_availability_exceptions" TO "authenticated";
GRANT ALL ON TABLE "mvp"."mentor_availability_exceptions" TO "service_role";



GRANT SELECT ON TABLE "mvp"."mentor_profiles" TO "authenticated";
GRANT ALL ON TABLE "mvp"."mentor_profiles" TO "service_role";



GRANT SELECT ON TABLE "mvp"."mentor_segments" TO "authenticated";
GRANT ALL ON TABLE "mvp"."mentor_segments" TO "service_role";



GRANT SELECT ON TABLE "mvp"."mentor_time_reservations" TO "authenticated";
GRANT ALL ON TABLE "mvp"."mentor_time_reservations" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "mvp"."notifications" TO "authenticated";
GRANT ALL ON TABLE "mvp"."notifications" TO "service_role";



GRANT SELECT,INSERT,UPDATE ON TABLE "mvp"."payments" TO "authenticated";
GRANT ALL ON TABLE "mvp"."payments" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "mvp"."profiles" TO "authenticated";
GRANT ALL ON TABLE "mvp"."profiles" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "mvp"."seeker_profiles" TO "authenticated";
GRANT ALL ON TABLE "mvp"."seeker_profiles" TO "service_role";



GRANT SELECT ON TABLE "mvp"."segments" TO "authenticated";
GRANT ALL ON TABLE "mvp"."segments" TO "service_role";



GRANT SELECT,INSERT,UPDATE ON TABLE "mvp"."session_workspaces" TO "authenticated";
GRANT ALL ON TABLE "mvp"."session_workspaces" TO "service_role";



GRANT SELECT,INSERT,UPDATE ON TABLE "mvp"."slot_holds" TO "authenticated";
GRANT ALL ON TABLE "mvp"."slot_holds" TO "service_role";



GRANT SELECT ON TABLE "mvp"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "mvp"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."coupon_usage" TO "service_role";



GRANT ALL ON TABLE "public"."coupons" TO "service_role";



GRANT ALL ON TABLE "public"."gig_topics" TO "authenticated";
GRANT ALL ON TABLE "public"."gig_topics" TO "service_role";



GRANT ALL ON TABLE "public"."gigs" TO "authenticated";
GRANT ALL ON TABLE "public"."gigs" TO "service_role";



GRANT ALL ON TABLE "public"."inconsistent_bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."inconsistent_bookings" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."session_workspaces" TO "authenticated";
GRANT ALL ON TABLE "public"."session_workspaces" TO "service_role";



GRANT INSERT("booking_id") ON TABLE "public"."session_workspaces" TO "authenticated";
GRANT INSERT("booking_id") ON TABLE "public"."session_workspaces" TO "anon";



GRANT INSERT("mentor_id") ON TABLE "public"."session_workspaces" TO "authenticated";
GRANT INSERT("mentor_id") ON TABLE "public"."session_workspaces" TO "anon";



GRANT INSERT("seeker_id") ON TABLE "public"."session_workspaces" TO "authenticated";
GRANT INSERT("seeker_id") ON TABLE "public"."session_workspaces" TO "anon";



GRANT INSERT("summary"),UPDATE("summary") ON TABLE "public"."session_workspaces" TO "authenticated";
GRANT INSERT("summary"),UPDATE("summary") ON TABLE "public"."session_workspaces" TO "anon";



GRANT INSERT("takeaways"),UPDATE("takeaways") ON TABLE "public"."session_workspaces" TO "authenticated";
GRANT INSERT("takeaways"),UPDATE("takeaways") ON TABLE "public"."session_workspaces" TO "anon";



GRANT INSERT("action_items"),UPDATE("action_items") ON TABLE "public"."session_workspaces" TO "authenticated";
GRANT INSERT("action_items"),UPDATE("action_items") ON TABLE "public"."session_workspaces" TO "anon";



GRANT INSERT("resources"),UPDATE("resources") ON TABLE "public"."session_workspaces" TO "authenticated";
GRANT INSERT("resources"),UPDATE("resources") ON TABLE "public"."session_workspaces" TO "anon";



GRANT ALL ON TABLE "public"."inconsistent_session_workspaces" TO "authenticated";
GRANT ALL ON TABLE "public"."inconsistent_session_workspaces" TO "service_role";



GRANT ALL ON TABLE "public"."login_failure_config" TO "authenticated";
GRANT ALL ON TABLE "public"."login_failure_config" TO "service_role";



GRANT ALL ON TABLE "public"."login_failure_trackers" TO "authenticated";
GRANT ALL ON TABLE "public"."login_failure_trackers" TO "service_role";



GRANT ALL ON TABLE "public"."mentor_application_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."mentor_application_audit" TO "service_role";



GRANT ALL ON TABLE "public"."mentor_availability" TO "authenticated";
GRANT ALL ON TABLE "public"."mentor_availability" TO "service_role";



GRANT ALL ON TABLE "public"."mentor_availability_exceptions" TO "authenticated";
GRANT ALL ON TABLE "public"."mentor_availability_exceptions" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN ON TABLE "public"."mentor_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."mentor_profiles" TO "service_role";



GRANT UPDATE("headline") ON TABLE "public"."mentor_profiles" TO "authenticated";



GRANT UPDATE("about") ON TABLE "public"."mentor_profiles" TO "authenticated";



GRANT UPDATE("experience_years") ON TABLE "public"."mentor_profiles" TO "authenticated";



GRANT UPDATE("languages") ON TABLE "public"."mentor_profiles" TO "authenticated";



GRANT UPDATE("expertise") ON TABLE "public"."mentor_profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."mentor_segments" TO "authenticated";
GRANT ALL ON TABLE "public"."mentor_segments" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."payment_events" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_events" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."platform_config" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_config" TO "service_role";



GRANT ALL ON TABLE "public"."razorpay_unmatched_captures" TO "authenticated";
GRANT ALL ON TABLE "public"."razorpay_unmatched_captures" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."reschedule_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."reschedule_requests" TO "service_role";



GRANT ALL ON TABLE "public"."seeker_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."seeker_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."segment_topics" TO "authenticated";
GRANT ALL ON TABLE "public"."segment_topics" TO "service_role";



GRANT ALL ON TABLE "public"."segments" TO "authenticated";
GRANT ALL ON TABLE "public"."segments" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."support_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."support_attachments" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."support_audit_events" TO "authenticated";
GRANT ALL ON TABLE "public"."support_audit_events" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."support_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."support_messages" TO "service_role";



GRANT ALL ON SEQUENCE "public"."support_ticket_code_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."support_ticket_code_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."support_tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."support_tickets" TO "service_role";



GRANT ALL ON TABLE "public"."system_log_retention" TO "authenticated";
GRANT ALL ON TABLE "public"."system_log_retention" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."webhook_events" TO "authenticated";
GRANT ALL ON TABLE "public"."webhook_events" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";




























