import React, { useMemo, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Textarea } from '@/src/components/ui/Textarea';
import { SuccessState } from '@/src/components/shared/SuccessState';
import { InlineNotice } from '@/src/components/booking/StatePanel';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import {
  FORMSPREE_SUPPORT_ENDPOINT,
  HONEYPOT_FIELD,
  SUPPORT_BOOKING_CODE_MAX,
  SUPPORT_CATEGORIES,
  SUPPORT_MESSAGE_MAX,
  SUPPORT_MESSAGE_MIN,
  SUPPORT_SUBJECT_MAX,
  buildSupportPayload,
  isBookingRelatedCategory,
  isValidBookingReference,
  validateSupportForm,
  type SupportFormErrors,
} from '@/src/config/support';

const ROLE_LABEL: Record<string, string> = {
  seeker: 'Seeker',
  mentor: 'Mentor',
  admin: 'Admin',
};

type SubmitState = 'idle' | 'sending' | 'sent' | 'error';

/**
 * The one support form. It reads the authenticated user and the active role
 * from the existing auth context, so a seeker, a mentor and an admin get the
 * same component with different categories — never three forked copies.
 *
 * What it can send is decided by `buildSupportPayload`, which builds an
 * allow-list. What a user may reach is decided by the route guard, not here.
 */
export const SupportForm: React.FC = () => {
  const { profile, user, activeRole } = useAuth();
  const { currentPath } = useNavigation();

  // A signed-in visitor always has one of the three roles; the fallback only
  // exists so the component can render before the session has resolved.
  const role = activeRole ?? 'seeker';
  const categories = SUPPORT_CATEGORIES[role];

  const pathname = currentPath.split('?')[0];

  // `/seeker/booking-detail` -> "Help & Support" carries the booking code in the
  // query string. Only a real booking reference is taken, so a crafted or stale
  // URL cannot pre-fill an arbitrary string.
  const prefilledBookingCode = useMemo(() => {
    const query = currentPath.split('?')[1];
    const value = query ? new URLSearchParams(query).get('bookingCode') ?? '' : '';
    return isValidBookingReference(value) ? value.trim() : '';
  }, [currentPath]);

  const [category, setCategory] = useState<string>(categories[0]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [bookingCode, setBookingCode] = useState(prefilledBookingCode);
  const [website, setWebsite] = useState('');
  const [errors, setErrors] = useState<SupportFormErrors>({});
  const [state, setState] = useState<SubmitState>('idle');

  // `disabled` only reaches the DOM after React re-renders, so two clicks in the
  // same tick would both fire. This synchronous guard is what actually stops the
  // second submission; the disabled button is only the visible half.
  const inFlight = useRef(false);

  // A category from a previous role must not survive a role change.
  const selectedCategory = categories.includes(category) ? category : categories[0];

  const isSending = state === 'sending';
  const showBookingCode = bookingCode.trim() !== '' || isBookingRelatedCategory(selectedCategory);

  const endpoint = FORMSPREE_SUPPORT_ENDPOINT;
  if (!endpoint) {
    return (
      <InlineNotice
        tone="warning"
        title="Support is not configured yet"
        icon={Send}
        role="status"
      >
        This deployment has no support endpoint set, so a message cannot be sent from here. Set
        VITE_FORMSPREE_SUPPORT_ENDPOINT and reload.
      </InlineNotice>
    );
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;

    const found = validateSupportForm({ subject, message, bookingCode });
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    inFlight.current = true;
    setState('sending');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(
          buildSupportPayload({
            name: profile?.full_name || user?.user_metadata?.full_name || '',
            email: profile?.email || user?.email || '',
            role,
            category: selectedCategory,
            subject,
            message,
            bookingCode,
            currentPage: currentPath,
            website,
          }),
        ),
      });
      // A honeypot submission is rejected by Formspree, and that must read as a
      // failure rather than as a confirmation the user never earned.
      if (!response.ok) throw new Error('Support submission was not accepted.');

      // Only clear once the send is confirmed, so a failure never loses a draft.
      setSubject('');
      setMessage('');
      setBookingCode('');
      setCategory(categories[0]);
      setState('sent');
    } catch {
      // The raw Formspree / network / server reason is deliberately not shown
      // and not logged: it carries nothing the user can act on.
      setState('error');
    } finally {
      inFlight.current = false;
    }
  };

  if (state === 'sent') {
    return (
      <SuccessState
        title="Message sent"
        description="Thanks for contacting Suggest Key. Our support team will review your message and get back to you."
        actionLabel="Send another message"
        onAction={() => {
          setState('idle');
          setErrors({});
        }}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {state === 'error' && (
        <InlineNotice
          tone="danger"
          role="alert"
          icon={Send}
          title="Unable to send your message right now. Please try again."
        >
          Nothing was sent and your message is still here. Try again in a moment.
        </InlineNotice>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Input
          id="support-name"
          label="Name"
          value={profile?.full_name || user?.user_metadata?.full_name || ''}
          readOnly
          autoComplete="name"
          helperText="From your account."
        />
        <Input
          id="support-email"
          label="Email"
          type="email"
          value={profile?.email || user?.email || ''}
          readOnly
          autoComplete="email"
          helperText="We reply here."
        />
        <Input
          id="support-role"
          label="Role"
          value={ROLE_LABEL[role] ?? role}
          readOnly
          helperText="From your account."
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="support-category"
          className="block text-xs font-semibold text-[var(--color-shell-text)]"
        >
          Category
          <span className="ml-0.5 text-[var(--color-shell-error)]">*</span>
        </label>
        <select
          id="support-category"
          value={selectedCategory}
          onChange={(event) => setCategory(event.target.value)}
          disabled={isSending}
          className="flex h-12 w-full cursor-pointer rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] px-3 py-2 text-sm text-[var(--color-shell-text)] focus:border-[var(--color-shell-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--color-shell-accent-soft)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {categories.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <Input
        id="support-subject"
        label="Subject"
        value={subject}
        onChange={(event) => setSubject(event.target.value)}
        disabled={isSending}
        required
        maxLength={SUPPORT_SUBJECT_MAX}
        placeholder="One line that says what you need"
        error={errors.subject}
        helperText={`Up to ${SUPPORT_SUBJECT_MAX} characters.`}
      />

      <Textarea
        id="support-message"
        label="Message"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        disabled={isSending}
        required
        rows={7}
        maxLength={SUPPORT_MESSAGE_MAX}
        showCount
        placeholder="What happened, what you expected, and anything you already tried."
        error={errors.message}
        helperText={`At least ${SUPPORT_MESSAGE_MIN} characters, up to ${SUPPORT_MESSAGE_MAX}.`}
      />

      {showBookingCode && (
        <Input
          id="support-booking-code"
          label="Booking code (optional)"
          value={bookingCode}
          onChange={(event) => setBookingCode(event.target.value)}
          disabled={isSending}
          maxLength={SUPPORT_BOOKING_CODE_MAX}
          placeholder="BK-1234"
          error={errors.bookingCode}
          helperText="The code shown on your booking, not required for general support. Clear it to leave it out."
        />
      )}

      {/* <Input
        id="support-current-page"
        label="Current page"
        value={pathname}
        readOnly
        helperText="Attached automatically so we know where you were. It is not a permission."
      /> */}

      {/* Formspree's real spam trap: hidden from sight and from assistive tech,
          skipped by the tab order. Formspree discards any submission that fills
          it, so a bot gets nowhere while a human never sees it. */}
      <div aria-hidden="true" className="hidden">
        <label htmlFor="support-website">Website</label>
        <input
          id="support-website"
          name={HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-3 border-t border-[var(--color-shell-border)] pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] leading-relaxed text-[var(--color-shell-text-subtle)]">
          Sent to the Suggest Key support team by email. No password, payment proof or private
          document is ever attached to this form.
        </p>
        <Button
          type="submit"
          size="md"
          className="w-full gap-2 sm:w-auto sm:min-w-[9rem]"
          disabled={isSending}
          isLoading={isSending}
          loadingText="Sending..."
        >
          {!isSending && <Send className="h-4 w-4" aria-hidden="true" />}
          <span>Send Message</span>
        </Button>
      </div>
    </form>
  );
};

export default SupportForm;
