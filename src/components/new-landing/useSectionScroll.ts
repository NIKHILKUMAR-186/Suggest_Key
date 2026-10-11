/**
 * NEW LANDING PAGE — smooth section scrolling.
 *
 * The source design uses same-page anchor links (`#keys`, `#how`). Internal
 * links in this app must never trigger a full reload, so every in-page target
 * is resolved with a scroll + `replaceState` — the same pattern the rest of
 * the app uses — and the URL stays shareable without a navigation.
 *
 * It honours `prefers-reduced-motion` so the page never animates for someone
 * who asked it not to.
 */
import { useCallback } from 'react';
import { useReducedMotion } from '@/src/components/landing/motion';

/** Scroll to a section by id, keeping the URL hash in sync without a reload. */
export function useSectionScroll() {
  const reduceMotion = useReducedMotion();

  return useCallback(
    (id: string) => {
      const element = document.getElementById(id);
      if (!element) return;
      element.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'start',
      });
      window.history.replaceState(null, '', `#${id}`);
    },
    [reduceMotion],
  );
}
