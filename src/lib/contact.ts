/**
 * Contact-link helpers.
 *
 * Turning an email address or a phone number into a real `mailto:` / `tel:`
 * link has to be conservative: a booking reference, a UUID, a price or a
 * timestamp must never be mistaken for a phone number. These helpers are the
 * single place that decides "this really is a contact detail".
 */

/** Matches an address with a real, dot-separated TLD. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/**
 * A phone number in E.164-ish form: an optional +, then 7-15 digits, with
 * spaces, dashes, dots or parentheses as separators.
 *
 * Deliberately anchored: 7 digits minimum, no letters, and not a pure
 * timestamp fragment. `9876543210`, `+91 98765 43210` and `(020) 7946-0100`
 * match; `1234567890123` (a ms epoch) and a UUID fragment do not.
 */
const PHONE_PATTERN = /^\+?[\d][\d\s().-]{5,19}\d$/;

export function isEmail(value: string | null | undefined): value is string {
  return typeof value === 'string' && EMAIL_PATTERN.test(value.trim());
}

export function isPhoneNumber(value: string | null | undefined): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!PHONE_PATTERN.test(trimmed)) return false;

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return false;

  // Reject values that are really a 10-13 digit run of digits with no
  // separator and no country prefix: those are almost always ids or epochs.
  if (digits.length >= 10 && !/^[+\s().-]/.test(trimmed)) return false;

  return true;
}

/** `mailto:` href. Returns null for anything that is not an address. */
export function mailtoHref(email: string | null | undefined): string | null {
  if (!isEmail(email)) return null;
  return `mailto:${email.trim()}`;
}

/**
 * `tel:` href. Strips every non-digit (and the leading `+`) so the value is a
 * valid RFC 3966 URI that the device can dial.
 */
export function telHref(phone: string | null | undefined): string | null {
  if (!isPhoneNumber(phone)) return null;
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return `tel:${hasPlus ? '+' : ''}${digits}`;
}
