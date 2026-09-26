export const APP_CONFIG = {
  HOLD_DURATION_MS: 15 * 60 * 1000,
  SESSION_ACCESS_WINDOW_MS: 5 * 60 * 1000,
  // Authoritative booking cutoff. A slot stays bookable while
  // `slotStart - now >= BOOKING_CUTOFF_MS`, measured on absolute instants and
  // therefore independent of any display timezone. This replaces the old
  // 2-hour advance restriction, which no longer exists.
  //
  // This is NOT the mentor meeting-link deadline below: that is an operational
  // rule for mentors adding a meeting URL and must never block booking.
  BOOKING_CUTOFF_MS: 5 * 60 * 1000,
  MEETING_LINK_DEADLINE_MS: 2 * 60 * 60 * 1000,
  NORMAL_CANCELLATION_WINDOW_HOURS: 24,
  MVP_PAYMENT_METHOD: 'manual_qr',
  DEFAULT_TIMEZONE: 'Asia/Kolkata',
} as const;

export const HOLDOUT_MINUTES = (APP_CONFIG.HOLD_DURATION_MS / (60 * 1000)) | 0;
export const SESSION_ACCESS_WINDOW_MINUTES = (APP_CONFIG.SESSION_ACCESS_WINDOW_MS / (60 * 1000)) | 0;
export const BOOKING_CUTOFF_MINUTES = (APP_CONFIG.BOOKING_CUTOFF_MS / (60 * 1000)) | 0;
export const CANCELLATION_WINDOW_HOURS = APP_CONFIG.NORMAL_CANCELLATION_WINDOW_HOURS;

export const DAYS_OF_WEEK = [
  { name: 'Sunday', index: 0 },
  { name: 'Monday', index: 1 },
  { name: 'Tuesday', index: 2 },
  { name: 'Wednesday', index: 3 },
  { name: 'Thursday', index: 4 },
  { name: 'Friday', index: 5 },
  { name: 'Saturday', index: 6 },
];
