/**
 * Shared avatar fallback utilities for mentors.
 *
 * All other files in src/lib/ are .ts (no JSX), so this module is kept as a
 * pure-TS utility module rather than a .tsx component. Components that need
 * a rendered MentorAvatar import `getInitials` here and compose the JSX in
 * their own .tsx file, preserving Vite/TypeScript extension resolution
 * consistency across the lib directory.
 */

/**
 * Derives deterministic initials from a full name.
 *
 * - "Jane Doe"  -> "JD"
 * - "Alex"      -> "A"
 * - ""          -> "M"  (neutral placeholder for an unknown mentor)
 *
 * Never random, never a UUID fragment.
 */
export function getInitials(fullName: string): string {
  return (
    (fullName || '')
      .split(' ')
      .filter(Boolean)
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'M'
  );
}
