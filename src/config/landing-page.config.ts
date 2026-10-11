/**
 * LANDING-PAGE VARIANT CONFIGURATION — the single switch.
 *
 * There are two completely independent implementations of `/`:
 *
 *   'legacy'  → the existing production landing page, in
 *               `src/pages/public/LandingPage.tsx` with its components under
 *               `src/components/landing/`. NEVER modified by this integration.
 *
 *   'new'     → the HTML-derived landing page, in
 *               `src/pages/public/NewLandingPage.tsx` with its components
 *               under `src/components/new-landing/` and its own isolated
 *               stylesheet.
 *
 * HOW TO SWITCH
 * -------------
 * Change the one value below and rebuild:
 *
 *     export const LANDING_PAGE_VARIANT: LandingPageVariant = 'new';
 *
 * That is the ONLY supported way to activate or restore a variant. It is a
 * build-time constant, so it is read once at module load, is identical in
 * development and production, and cannot be flipped by a visitor, a query
 * string or any other public control.
 *
 * Deliberately NOT used here: `process.env` or a `VITE_`-prefixed variable.
 * Client bundles do not receive `process.env` — the bundler replaces it with
 * an empty object, so an environment-driven switch silently resolves to
 * `'legacy'` no matter what is set and the new page can never be reached. A
 * plain exported constant is unambiguous, type-checked and has no plumbing
 * that can quietly fail.
 *
 * HOW TO VERIFY
 * -------------
 * Set `'new'` below, then `npm run dev` and open `/`. You should see the
 * deep-purple hero with the floating category bubbles, the overlapping
 * category cards and the dark story cards. Set it back to `'legacy'`, restart,
 * and the notebook landing page must appear byte-for-byte as before.
 *
 * Exactly ONE variant is ever mounted: `src/routes/Router.tsx` selects between
 * them at the route boundary. They are never kept in the tree together and no
 * CSS visibility trick is used to hide either one.
 */

/** The two supported landing-page variants. */
export type LandingPageVariant = 'legacy' | 'new';

/** The two variants, so anything that must enumerate them stays in step. */
export const LANDING_PAGE_VARIANTS: readonly LandingPageVariant[] = ['legacy', 'new'];

/**
 * THE ACTIVE VARIANT.
 *
 * Change this single value to switch the landing page. The value is a
 * literal on purpose: it is the one place to look and it cannot be overridden
 * by the environment, the URL or the session.
 *
 * The initial value is 'legacy': the existing production landing page
 * stays live until the new implementation is deliberately activated.
 */
export const LANDING_PAGE_VARIANT: LandingPageVariant = 'legacy';

/** True when the new, independently integrated landing page is active. */
export function isNewLandingPageActive(): boolean {
  return LANDING_PAGE_VARIANT === 'new';
}

/** True when the existing production landing page is active. */
export function isLegacyLandingPageActive(): boolean {
  return LANDING_PAGE_VARIANT === 'legacy';
}
