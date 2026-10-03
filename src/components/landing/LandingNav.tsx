import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, LogIn, Menu, X } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { ThemeToggle } from '@/src/components/ui/ThemeToggle';
import { LandingWordmark } from '@/src/components/landing/LandingWordmark';
import { useCanAnimate } from '@/src/components/landing/Reveal';

/**
 * LANDING NAVIGATION.
 *
 * The bar is part of the hero, not a layer above it: it floats on the plum
 * field with white text and no chrome, and only grows its own background once
 * the hero has scrolled under it. That transition is the only state change here
 * — there is no shrink, no pill, no colour animation, because the bar is already
 * the same colour as the hero and only needs to become opaque.
 *
 * On a plum field the theme switch and the sign-in link are both overridden to
 * light-on-dark. `ThemeToggle` is a shared component used by every portal, so
 * the override arrives through its documented `buttonClassName` prop rather than
 * by editing the shared component and risking all of them.
 *
 * Every item in here faces someone who came to find a mentor. Supplying the
 * network is a different intent and a different audience, so it lives in the
 * footer: a bar that offered both would ask the visitor to choose a side before
 * they had read a word.
 */

export interface LandingNavProps {
  findMentorPath: string;
  onNavigate: (path: string) => void;
}

interface LandingNavLink {
  label: string;
  path: string;
}

export const LandingNav: React.FC<LandingNavProps> = ({ findMentorPath, onNavigate }) => {
  const { isAuthenticated, isLoading: isAuthLoading, activeRole } = useAuth();
  const [isStuck, setIsStuck] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const canAnimate = useCanAnimate();

  /**
   * A single passive scroll listener that only ever writes a boolean. It reads
   * `window.scrollY`, so it cannot trigger layout, and it is removed on unmount.
   *
   * The threshold is deliberately past the fold of the hero copy rather than at
   * 1px: while the bar is transparent it is legible because the plum hero field
   * is behind it, so it should stay that way for as long as it honestly can, and
   * only take on its own background once the copy it sits over has gone.
   */
  useEffect(() => {
    const onScroll = () => setIsStuck(window.scrollY > 120);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const closeMenu = useCallback(() => setIsMenuOpen(false), []);

  useEffect(() => {
    if (!isMenuOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
        burgerRef.current?.focus();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isMenuOpen]);

  const go = useCallback(
    (path: string) => {
      closeMenu();
      onNavigate(path);
    },
    [closeMenu, onNavigate]
  );

  const dashboardPath =
    activeRole === 'mentor' ? '/mentor' : activeRole === 'admin' ? '/admin' : '/seeker';

  const links: LandingNavLink[] = [
    { label: 'Find a Mentor', path: findMentorPath },
    { label: 'How it works', path: '/#how-it-works' },
  ];

  const accountLabel = isAuthenticated ? 'Dashboard' : 'Sign in';
  const accountPath = isAuthenticated ? dashboardPath : '/auth/login';

  /** An in-page anchor is a scroll, not a route change. */
  const handleLinkClick = (event: React.MouseEvent, path: string) => {
    if (!path.startsWith('/#')) return;
    event.preventDefault();
    closeMenu();
    const id = path.slice(2);
    document.getElementById(id)?.scrollIntoView({
      behavior: canAnimate ? 'smooth' : 'auto',
      block: 'start',
    });
  };

  const brand = <LandingWordmark size={15} />;

  return (
    <>
      <motion.header
        className={`sk-lp-nav sk-lp-on-plum ${isStuck ? 'sk-lp-nav--stuck' : ''}`}
        initial={canAnimate ? { opacity: 0, y: -12 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <nav aria-label="Primary" className="sk-lp-wrap">
          <div className="sk-lp-nav__inner">
            <a
              href="/"
              onClick={(event) => {
                event.preventDefault();
                go('/');
              }}
              className="sk-lp-nav__brand"
              aria-label="Suggest Key — home"
            >
              {brand}
            </a>

            <div className="sk-lp-nav__links">
              {links.map((link) => (
                <a
                  key={link.label}
                  href={link.path}
                  className="sk-lp-nav__link"
                  onClick={(event) => handleLinkClick(event, link.path)}
                >
                  {link.label}
                </a>
              ))}
            </div>

            <div className="sk-lp-nav__actions">
              {!isAuthLoading && (
                <a
                  href={accountPath}
                  className="sk-lp-nav__signin inline-flex items-center gap-2"
                  onClick={(event) => {
                    event.preventDefault();
                    go(accountPath);
                  }}
                >
                  {!isAuthenticated && <LogIn className="h-3.5 w-3.5" aria-hidden="true" />}
                  {accountLabel}
                </a>
              )}

              <ThemeToggle
                buttonClassName="h-10 w-10 rounded-full border-[color:var(--sk-lp-hair-on-plum)] bg-transparent text-[color:var(--sk-lp-on-plum-soft)] hover:bg-white/10 hover:text-white"
              />

              <button
                type="button"
                onClick={() => go(findMentorPath)}
                className="sk-lp-btn sk-lp-btn--gold sk-lp-nav__cta"
              >
                Find a Mentor
                <ArrowRight className="h-4 w-4 sk-lp-btn__arrow" aria-hidden="true" />
              </button>
            </div>

            <button
              ref={burgerRef}
              type="button"
              className="sk-lp-nav__burger lg:hidden"
              aria-expanded={isMenuOpen}
              aria-controls="landing-mobile-menu"
              aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setIsMenuOpen((open) => !open)}
            >
              {isMenuOpen ? (
                <X className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Menu className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
          </div>
        </nav>
      </motion.header>

      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            id="landing-mobile-menu"
            className="sk-lp-sheet sk-lp-on-plum lg:hidden"
            initial={canAnimate ? { opacity: 0, y: -12 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={canAnimate ? { opacity: 0, y: -12 } : { opacity: 0 }}
            transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
          >
            {links.map((link) => (
              <a
                key={link.label}
                href={link.path}
                className="sk-lp-sheet__link"
                onClick={(event) => handleLinkClick(event, link.path)}
              >
                {link.label}
                <ArrowRight className="h-4 w-4 text-[color:var(--sk-lp-gold)]" aria-hidden="true" />
              </a>
            ))}

            <div className="sk-lp-sheet__foot">
              {!isAuthLoading && (
                <button
                  type="button"
                  onClick={() => go(accountPath)}
                  className="sk-lp-btn sk-lp-btn--ghost w-full"
                >
                  {accountLabel}
                </button>
              )}
              <button
                type="button"
                onClick={() => go(findMentorPath)}
                className="sk-lp-btn sk-lp-btn--gold w-full"
              >
                Find a Mentor
                <ArrowRight className="h-4 w-4 sk-lp-btn__arrow" aria-hidden="true" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};