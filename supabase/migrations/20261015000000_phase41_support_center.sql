-- ==============================================================================
-- SUGGEST KEY - PHASE 41: SUPPORT CENTER (internal ticket system)
-- ==============================================================================
-- What replaces what
--   `src/config/support.ts` + `src/components/support/SupportForm.tsx` POSTed
--   every support message to Formspree. Nothing was stored, so there was no
--   ticket, no queue, no conversation, no status and no record an admin could
--   act on. This file creates the real, database-backed support system that
--   replaces it as the canonical support record. Formspree is deleted outright
--   (see the migration report) rather than kept as a second, parallel record.
--
-- The shape of the model
--   support_tickets          one case. Identified publicly by ticket_code.
--   support_messages         the conversation. `is_internal` splits a PUBLIC
--                            message from an ADMIN-ONLY note.
--   support_attachments      private objects in the `support-attachments` bucket.
--   support_audit_events     who did what, when, with safe metadata.
--
-- Every write goes through a SECURITY DEFINER RPC. That is the same
-- authorisation pattern the reschedule and refund features already use, and it
-- is the reason the tables carry READ policies only: with no INSERT/UPDATE/DELETE
-- policy, `authenticated` and `anon` cannot write one row directly even if the
-- Express layer were bypassed. The Express handlers therefore own identity
-- resolution and pass it in; the RPCs re-verify it against `user_roles` and
-- against the row itself, so a compromised service-role key is still refused.
--
-- Identity is NEVER taken from the browser. `requester_id`, `sender_id`,
-- `sender_role`, `is_internal`, `assigned_admin_id`, `priority` and
-- `payment_id` are all derived server-side. `create_support_ticket` takes a
-- human `booking_code` and resolves it itself, so no client can link a ticket
-- to somebody else's booking.
--
-- Refunds are NOT initiated here. The payment/refund lifecycle already exists
-- (`payments.refund_status`, `complete_manual_refund`, the Razorpay refund
-- events). A ticket only READS that state through
-- `get_support_ticket`'s payment context and records it on the timeline. It
-- cannot move money: there is no refund parameter, no amount, and no path from
-- this schema to `payments` beyond a read-only join.
-- ==============================================================================


-- -----------------------------------------------------------------------------
-- 1. CANONICAL VOCABULARY
-- -----------------------------------------------------------------------------
-- The CHECK constraints below are the authority. These functions exist so the
-- workflow is stated once in the database rather than restated per handler.
-- =============================================================================

-- OPEN       -> IN_PROGRESS | WAITING_FOR_USER | RESOLVED | CLOSED
-- IN_PROGRESS-> WAITING_FOR_USER | RESOLVED | CLOSED
-- WAITING    -> IN_PROGRESS | RESOLVED | CLOSED   (the user replied, see step 6
--                                                of add_support_message)
-- RESOLVED   -> OPEN (reopen) | CLOSED
-- CLOSED     -> (terminal; a closed ticket is reopened by creating a new one)
CREATE OR REPLACE FUNCTION public.is_valid_support_transition(p_from TEXT, p_to TEXT)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
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

-- A ticket a user may still add a message to. A reply to a CLOSED ticket is
-- refused outright rather than silently reopening it.
CREATE OR REPLACE FUNCTION public.is_support_ticket_replyable(p_status TEXT)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_status IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER');
$$;


-- -----------------------------------------------------------------------------
-- 2. TICKET CODE
-- -----------------------------------------------------------------------------
-- `SK-<YYYYMMDD>-<6 digits>`. The code is what a user quotes and what the admin
-- queue searches; the UUID stays internal.
--
-- The digits come from a real sequence, so two tickets raised in the same
-- millisecond cannot collide. `UNIQUE` on ticket_code is the backstop: if the
-- sequence were ever reset or wrapped, the insert fails loudly instead of
-- silently producing a duplicate code.
CREATE SEQUENCE IF NOT EXISTS public.support_ticket_code_seq;

CREATE OR REPLACE FUNCTION public.next_support_ticket_code()
RETURNS TEXT
LANGUAGE sql
VOLATILE
AS $$
  SELECT 'SK-'
    || to_char(clock_timestamp() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD')
    || '-'
    || lpad(nextval('public.support_ticket_code_seq')::TEXT, 6, '0');
$$;


-- -----------------------------------------------------------------------------
-- 3. TABLES
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Public identifier. Never expose `id` in user-facing UI.
  ticket_code TEXT NOT NULL UNIQUE
    CHECK (ticket_code ~ '^SK-[0-9]{8}-[0-9]{6}$'),

  -- Set by the RPC from the verified caller. There is no route that accepts it.
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  requester_role TEXT NOT NULL CHECK (requester_role IN ('seeker', 'mentor', 'admin')),

  -- The union of every role's allow-list. The per-role allow-list is enforced in
  -- create_support_ticket, because a single CHECK cannot express "depends on
  -- requester_role".
  category TEXT NOT NULL CHECK (category IN (
    'BOOKING', 'PAYMENT', 'SESSION', 'MENTOR', 'AVAILABILITY', 'PROFILE',
    'ACCOUNT', 'USER', 'SYSTEM', 'TECHNICAL', 'OTHER'
  )),

  subject TEXT NOT NULL CHECK (length(btrim(subject)) BETWEEN 4 AND 140),
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED')),
  -- Never URGENT at creation: a user cannot escalate their own ticket. An admin
  -- promotes it.
  priority TEXT NOT NULL DEFAULT 'NORMAL'
    CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),

  -- Both are resolved by the RPC from a human booking_code, never from a client
  -- UUID. `payment_id` is derived from the booking, never accepted.
  booking_id UUID NULL REFERENCES public.bookings(id) ON DELETE SET NULL,
  payment_id UUID NULL REFERENCES public.payments(id) ON DELETE SET NULL,

  assigned_admin_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,

  resolution TEXT NULL CHECK (resolution IS NULL OR length(resolution) <= 4000),

  resolved_at TIMESTAMPTZ NULL,
  resolved_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ NULL,
  closed_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,

  CONSTRAINT chk_support_resolution_presence CHECK (
    (status = 'RESOLVED' AND resolution IS NOT NULL)
    OR (status <> 'RESOLVED')
  )
);

-- Queue is always ordered by "what needs attention first": unassigned open work
-- before everything else, most recent first inside that.
CREATE INDEX IF NOT EXISTS idx_support_tickets_queue
  ON public.support_tickets (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status
  ON public.support_tickets (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_priority
  ON public.support_tickets (priority)
  WHERE priority IN ('HIGH', 'URGENT');
CREATE INDEX IF NOT EXISTS idx_support_tickets_requester
  ON public.support_tickets (requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned_admin
  ON public.support_tickets (assigned_admin_id, updated_at DESC)
  WHERE assigned_admin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_tickets_booking
  ON public.support_tickets (booking_id)
  WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_tickets_payment
  ON public.support_tickets (payment_id)
  WHERE payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,

  -- Both derived from the verified caller inside the RPC.
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('seeker', 'mentor', 'admin')),

  message TEXT NOT NULL CHECK (length(btrim(message)) BETWEEN 1 AND 4000),

  -- THE public/internal boundary. A user message can never set this to true:
  -- the RPC that inserts a public reply takes no such parameter, and the RPC
  -- that inserts an internal note is admin-gated.
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The conversation is always read in insertion order.
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_created
  ON public.support_messages (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS public.support_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  message_id UUID NULL REFERENCES public.support_messages(id) ON DELETE CASCADE,

  uploaded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- An OBJECT KEY, never a URL. The bucket is private and the server mints a
  -- short-lived signed URL at read time.
  storage_path TEXT NOT NULL
    CHECK (storage_path ~ '^support/[0-9a-f-]{36}/[0-9A-Za-z._-]+$')
    CHECK (storage_path !~ '\.\.' AND storage_path !~ '\\'),

  file_name TEXT NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 255),
  -- Closed allow-list: images and PDFs. No executable, no script, no archive.
  mime_type TEXT NOT NULL CHECK (mime_type IN (
    'image/png', 'image/jpeg', 'image/webp', 'application/pdf'
  )),
  file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 5242880),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_attachments_ticket
  ON public.support_attachments (ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_support_attachments_message
  ON public.support_attachments (message_id)
  WHERE message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.support_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'TICKET_CREATED',
    'TICKET_MESSAGE_SENT',
    'TICKET_INTERNAL_NOTE_ADDED',
    'TICKET_STATUS_CHANGED',
    'TICKET_PRIORITY_CHANGED',
    'TICKET_ASSIGNED',
    'TICKET_RESOLVED',
    'TICKET_REOPENED',
    'ATTACHMENT_ADDED',
    'REFUND_REQUESTED',
    'REFUND_STATUS_CHANGED'
  )),
  -- Operational identifiers only. Never a token, a secret, a payment
  -- credential or message content.
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_audit_events_ticket_created
  ON public.support_audit_events (ticket_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_support_tickets_updated_at ON public.support_tickets;
CREATE TRIGGER trg_support_tickets_updated_at
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_support_messages_updated_at ON public.support_messages;
CREATE TRIGGER trg_support_messages_updated_at
  BEFORE UPDATE ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
-- Read-only policies only. There is no INSERT/UPDATE/DELETE policy on any
-- support table, so `authenticated` (and `anon`) cannot write a row directly;
-- every mutation below goes through a SECURITY DEFINER RPC that re-verifies
-- identity. The service-role client bypasses RLS, which is why the RPCs are
-- the boundary and not the policies.
-- =============================================================================

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_audit_events ENABLE ROW LEVEL SECURITY;

-- A requester sees their own ticket. An admin sees every ticket (that is the
-- queue). Nobody else sees anything.
DROP POLICY IF EXISTS "Participants can view their own support tickets" ON public.support_tickets;
CREATE POLICY "Participants can view their own support tickets"
  ON public.support_tickets FOR SELECT
  USING (requester_id = auth.uid() OR public.is_admin());

-- The public/internal split, enforced in the policy itself: a non-admin can
-- only ever SELECT a row where `is_internal = false`. There is no policy that
-- lets a requester read an admin's private note.
DROP POLICY IF EXISTS "Participants can view public support messages" ON public.support_messages;
CREATE POLICY "Participants can view public support messages"
  ON public.support_messages FOR SELECT
  USING (
    public.is_admin()
    OR (
      is_internal = FALSE
      AND EXISTS (
        SELECT 1 FROM public.support_tickets t
        WHERE t.id = support_messages.ticket_id
          AND t.requester_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Participants can view their own support attachments" ON public.support_attachments;
CREATE POLICY "Participants can view their own support attachments"
  ON public.support_attachments FOR SELECT
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = support_attachments.ticket_id
        AND t.requester_id = auth.uid()
    )
  );

-- Audit events are an operational record: admin-only. A requester reads the
-- conversation, not the ticket's internal history.
DROP POLICY IF EXISTS "Admins can view support audit events" ON public.support_audit_events;
CREATE POLICY "Admins can view support audit events"
  ON public.support_audit_events FOR SELECT
  USING (public.is_admin());


-- -----------------------------------------------------------------------------
-- 5. STORAGE
-- -----------------------------------------------------------------------------
-- A private bucket. `public = FALSE` is the load-bearing part: nothing here is
-- ever served from a permanent URL. Both directions are signed URLs minted by
-- the server (which holds the service key), which is the same arrangement
-- `payment-qr` already uses, so no broad read grant is created here.
--
-- Path shape: `support/<ticketUuid>/<random>-<sanitisedName>`. The first folder
-- is the literal word `support`, never a user id, so no pre-existing
-- "first folder = auth.uid()" rule can accidentally match an attachment.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'support-attachments',
  'support-attachments',
  FALSE,
  5242880, -- 5 MB, mirrors support_attachments.file_size
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Admin only, mirroring "Admins have full access to payment QR" (phase 27).
-- Deliberately no policy for `anon` and none for a plain non-admin
-- `authenticated`: a participant downloads their own attachment through
-- `GET /api/support/tickets/:code/attachments/:id`, which verifies ticket
-- ownership server-side and returns a short-lived signed URL.
DROP POLICY IF EXISTS "Admins have full access to support attachments" ON storage.objects;
CREATE POLICY "Admins have full access to support attachments"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'support-attachments' AND public.is_admin())
  WITH CHECK (bucket_id = 'support-attachments' AND public.is_admin());


-- -----------------------------------------------------------------------------
-- 6. create_support_ticket
-- -----------------------------------------------------------------------------
-- The one writer of `support_tickets`.
--
-- Identity handling:
--   `p_requester_id` is verified against `user_roles` here. A caller naming
--   somebody else's id gets UNAUTHORIZED, and `requester_role` is derived from
--   the REAL role, never from a parameter. The per-role category allow-list is
--   applied here because a CHECK constraint cannot express "depends on
--   requester_role".
--
-- Booking handling:
--   `p_booking_code` is a human code, resolved by the database. A seeker may
--   only link their own booking; a mentor only a booking they are on. A code
--   that does not belong to the caller is refused rather than silently
--   dropped, so nobody learns whether another user's booking code exists.
--   `payment_id` is then DERIVED from that booking. There is no parameter for
--   it at all.
--
-- Priority handling:
--   Always NORMAL. A user cannot make their own ticket URGENT.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_support_ticket(
  p_requester_id UUID,
  p_category TEXT,
  p_subject TEXT,
  p_message TEXT,
  p_booking_code TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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


-- -----------------------------------------------------------------------------
-- 7. add_support_message  (public reply, requester or admin)
-- -----------------------------------------------------------------------------
-- There is NO `is_internal` parameter. A public reply is structurally incapable
-- of becoming an internal note; `add_support_internal_note` below is the only
-- writer of `is_internal = TRUE` and it is admin-gated.
--
-- A requester may reply only to their OWN ticket, and only while it is
-- OPEN / IN_PROGRESS / WAITING_FOR_USER. Replying to a RESOLVED or CLOSED
-- ticket is refused: the supported paths are reopen, or a new ticket.
--
-- Replying to WAITING_FOR_USER moves the ticket to IN_PROGRESS, which is the
-- whole point of that status.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.add_support_message(
  p_ticket_code TEXT,
  p_actor_id UUID,
  p_message TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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


-- -----------------------------------------------------------------------------
-- 8. add_support_internal_note  (admin only)
-- -----------------------------------------------------------------------------
-- The ONLY writer of `is_internal = TRUE`. `public.is_admin()` gates it, and the
-- caller identity is verified the same way as everywhere else, so a forged
-- "role": "admin" in a body cannot reach it.
--
-- Refused on a CLOSED ticket: a closed case takes no further notes.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.add_support_internal_note(
  p_ticket_code TEXT,
  p_admin_id UUID,
  p_note TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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


-- -----------------------------------------------------------------------------
-- 9. update_support_ticket  (admin: status / priority / assignment)
-- -----------------------------------------------------------------------------
-- One admin-gated writer for the three scalar admin actions, so the transition
-- table, the priority allow-list and the assignment check each exist once.
--
-- Resolving is NOT here: it needs a mandatory resolution message and stamps
-- resolved_at/resolved_by, so it has its own function (step 10).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.update_support_ticket(
  p_ticket_code TEXT,
  p_admin_id UUID,
  p_status TEXT DEFAULT NULL,
  p_priority TEXT DEFAULT NULL,
  p_assigned_admin_id UUID DEFAULT NULL,
  p_unassign BOOLEAN DEFAULT FALSE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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


-- -----------------------------------------------------------------------------
-- 10. resolve_support_ticket  (admin; resolution text is mandatory)
-- -----------------------------------------------------------------------------
-- Resolution is not just a status flip: it is a final PUBLIC message, stored on
-- the conversation where the user will actually read it, and copied onto the
-- ticket so the list view can render it without a join.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.resolve_support_ticket(
  p_ticket_code TEXT,
  p_admin_id UUID,
  p_resolution TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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


-- -----------------------------------------------------------------------------
-- 11. reopen_support_ticket  (requester or admin)
-- -----------------------------------------------------------------------------
-- The requester reopening their own RESOLVED ticket is the "this is not
-- resolved" path. A CLOSED ticket is deliberately NOT reopenable: the supported
-- route is a new ticket, and silently resurrecting a closed case would rewrite
-- -- admission that the ticket was finished.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.reopen_support_ticket(
  p_ticket_code TEXT,
  p_actor_id UUID,
  p_reason TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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


-- -----------------------------------------------------------------------------
-- 12. add_support_attachment
-- -----------------------------------------------------------------------------
-- Records an already-uploaded object. The browser never sends the bytes here;
-- it PUTs them to a signed URL the server minted for a path IT generated, then
-- posts the resulting key. This function therefore cannot be tricked into
-- recording an object the caller did not upload, because the caller is not the
-- one choosing the path.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.add_support_attachment(
  p_ticket_code TEXT,
  p_actor_id UUID,
  p_storage_path TEXT,
  p_file_name TEXT,
  p_mime_type TEXT,
  p_file_size INTEGER,
  p_message_id UUID DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;


-- -----------------------------------------------------------------------------
-- 13. get_support_ticket  (read, with the internal-note filter applied)
-- -----------------------------------------------------------------------------
-- The read boundary, and the reason the Express layer does not have to
-- re-implement the public/internal split. A non-admin caller never receives an
-- `is_internal = TRUE` row: the WHERE clause is inside the function, not in the
-- HTTP layer, so there is no response shape that could contain one.
--
-- The payment context is READ ONLY. It exposes the same fields the seeker can
-- already see on their own payment plus the refund state, and deliberately
-- excludes every credential: no gateway ids, no signature, no secret.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_support_ticket(
  p_ticket_code TEXT,
  p_caller_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ticket public.support_tickets;
  v_is_admin boolean;
  v_requester public.profiles;
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

  SELECT p.full_name, p.email INTO v_requester FROM public.profiles p WHERE p.id = v_ticket.requester_id;

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
      'requesterName', v_requester.full_name,
      'requesterEmail', v_requester.email,
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


-- -----------------------------------------------------------------------------
-- 14. list_support_tickets  (user scope or admin queue)
-- -----------------------------------------------------------------------------
-- `p_scope` is 'USER' or 'ADMIN'. USER is forced to the caller's own tickets
-- regardless of what the caller asked for, so there is no `user_id` parameter
-- to tamper with in the first place. ADMIN is refused unless the caller really
-- is an admin.
--
-- The search is a prefix/contains match over ticket_code, subject, and the
-- requester's name and email. It is bounded (`LIMIT`) and only ever runs for an
-- admin, so it cannot be used to enumerate accounts.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_support_tickets(
  p_caller_id UUID,
  p_scope TEXT DEFAULT 'USER',
  p_status TEXT DEFAULT NULL,
  p_priority TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_requester_role TEXT DEFAULT NULL,
  p_assigned_admin_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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


-- -----------------------------------------------------------------------------
-- 15. support_ticket_metrics  (admin dashboard, real counts)
-- -----------------------------------------------------------------------------
-- Every number is a COUNT over real rows. There is no fabricated counter and no
-- denormalised counter column that could drift from the queue.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.support_ticket_metrics(p_caller_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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


-- -----------------------------------------------------------------------------
-- 16. EXECUTE GRANTS
-- -----------------------------------------------------------------------------
-- Phase 29 revoked EXECUTE from PUBLIC/anon/authenticated on every SECURITY
-- DEFINER function, and Postgres re-grants PUBLIC on a new one. Without this,
-- `anon` could call create_support_ticket / add_support_internal_note /
-- resolve_support_ticket directly and every ownership check in their bodies
-- would be decorative.
-- =============================================================================
REVOKE EXECUTE ON FUNCTION public.is_valid_support_transition(TEXT, TEXT)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_support_ticket_replyable(TEXT)            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_support_ticket_code()                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_support_ticket(UUID, TEXT, TEXT, TEXT, TEXT)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.add_support_message(TEXT, UUID, TEXT)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.add_support_internal_note(TEXT, UUID, TEXT)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_support_ticket(TEXT, UUID, TEXT, TEXT, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_support_ticket(TEXT, UUID, TEXT)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reopen_support_ticket(TEXT, UUID, TEXT)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.add_support_attachment(TEXT, UUID, TEXT, TEXT, TEXT, INTEGER, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_support_ticket(TEXT, UUID)               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.list_support_tickets(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.support_ticket_metrics(UUID)                FROM PUBLIC, anon, authenticated;

-- The pure helpers carry no data and no side effects, so the server grants them
-- only to itself. Nothing else in the app calls them.
GRANT EXECUTE ON FUNCTION public.is_valid_support_transition(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_support_ticket_replyable(TEXT)       TO service_role;
GRANT EXECUTE ON FUNCTION public.next_support_ticket_code()              TO service_role;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(UUID, TEXT, TEXT, TEXT, TEXT)  TO service_role;
GRANT EXECUTE ON FUNCTION public.add_support_message(TEXT, UUID, TEXT)   TO service_role;
GRANT EXECUTE ON FUNCTION public.add_support_internal_note(TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_support_ticket(TEXT, UUID, TEXT, TEXT, UUID, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_support_ticket(TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reopen_support_ticket(TEXT, UUID, TEXT)  TO service_role;
GRANT EXECUTE ON FUNCTION public.add_support_attachment(TEXT, UUID, TEXT, TEXT, TEXT, INTEGER, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_support_ticket(TEXT, UUID)          TO service_role;
GRANT EXECUTE ON FUNCTION public.list_support_tickets(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.support_ticket_metrics(UUID)                TO service_role;


-- -----------------------------------------------------------------------------
-- 17. POST-CONDITIONS
-- -----------------------------------------------------------------------------
-- These must hold after the migration runs. A failure here means a leak, not a
-- style problem, so the migration aborts rather than finishing half-secured.
-- ==============================================================================
DO $$
DECLARE
  leaked text;
BEGIN
  -- 1. anon must not be able to execute ANY support function.
  SELECT string_agg(p.proname, ', ')
    INTO leaked
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN (
       'is_valid_support_transition', 'is_support_ticket_replyable',
       'next_support_ticket_code', 'create_support_ticket', 'add_support_message',
       'add_support_internal_note', 'update_support_ticket', 'resolve_support_ticket',
       'reopen_support_ticket', 'add_support_attachment', 'get_support_ticket',
       'list_support_tickets', 'support_ticket_metrics'
     )
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'PHASE-41 containment incomplete: anon can EXECUTE: %', leaked;
  END IF;

  -- 2. The attachment bucket must not be public.
  IF EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'support-attachments' AND public IS TRUE
  ) THEN
    RAISE EXCEPTION 'PHASE-41 invariant violated: support-attachments must be private';
  END IF;

  -- 3. No support table may carry an INSERT/UPDATE/DELETE policy. A write
  --    policy would let a client bypass every check the RPCs perform.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('support_tickets','support_messages','support_attachments','support_audit_events')
      AND cmd IN ('INSERT','UPDATE','DELETE')
  ) THEN
    RAISE EXCEPTION 'PHASE-41 invariant violated: support tables must have no direct write policy';
  END IF;

  RAISE NOTICE 'PHASE-41 applied: support center is private, admin-only for internal notes, and RPC-only for writes.';
END $$;

-- ==============================================================================
-- VERIFICATION
-- ==============================================================================
-- RLS, in psql as a non-admin authenticated user `me`:
--   SELECT ticket_code FROM public.support_messages WHERE is_internal;  -- 0 rows
--   SELECT ticket_code FROM public.support_audit_events;                 -- 0 rows
--   INSERT INTO public.support_tickets (...) VALUES (...);               -- permission denied
--
-- Direct RPC call as anon (must fail, not silently succeed):
--   SELECT public.create_support_ticket(gen_random_uuid(), 'PAYMENT', 'test', 'a message long enough');
--   -- ERROR: PHASE-41 / permission denied for function
-- ==============================================================================