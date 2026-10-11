import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Menu, X } from 'lucide-react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { useReducedMotion } from '@/src/components/landing/motion';
import { MagneticButton } from '@/src/components/landing/motion';

/**
 * THE LANDING BAR.
 *
 * Brand mark top-left, links centre, sign-in and the single pill conversion
 * anchor top-right — nothing else. Home comes FIRST and always returns the
 * visitor smoothly to the top of the page rather than to a route.
 *
 * The bar is sticky and stays quiet: it only grows a hairline and a whisper of
 * shadow once the page has actually moved. Below 980px the link row collapses
 * into a panel behind the hamburger; the panel is `display: none` while closed,
 * so its links are never tab stops for a keyboard visitor.
 */

const NAV_LINKS = [
  { label: 'Home', target: 'top' },
  { label: 'Explore mentors', target: 'explore' },
  { label: 'How it works', target: 'how-it-works' },
  { label: 'Why Suggest Key', target: 'why' },
] as const;

export interface SuperrNavProps {
  /** Resolves where the single conversion anchor leads. */
  findMentorPath: string;
}

export function SuperrNav({ findMentorPath }: SuperrNavProps) {
  const { isAuthenticated } = useAuth();
  const { navigate } = useNavigation();
  const reduceMotion = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const scrollToTarget = useCallback(
    (target: string) => {
      if (target === 'top') {
        window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
        return;
      }
      const element = document.getElementById(target);
      if (!element) return;
      element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      // Keep the URL shareable without pushing a history entry per section.
      window.history.replaceState(null, '', `#${target}`);
    },
    [reduceMotion],
  );

  const onLinkClick = (event: React.MouseEvent, target: string) => {
    event.preventDefault();
    setOpen(false);
    scrollToTarget(target);
  };

  return (
    <header
      className="landing-nav"
      data-scrolled={scrolled ? 'true' : 'false'}
      data-open={open ? 'true' : 'false'}
    >
      <div className="landing-nav__inner">
        <a
          className="landing-brand"
          href="#top"
          aria-label="Suggest Key — back to top"
          onClick={(event) => onLinkClick(event, 'top')}
        >
          <img className="landing-brand__mark" src="/logo.png" alt="" width={34} height={34} />
          <span className="landing-brand__name">
            <img src="/name.png" alt="Suggest Key" />
          </span>
        </a>

        <nav className="landing-nav__links" data-open={open ? 'true' : 'false'} aria-label="Landing sections">
          {NAV_LINKS.map(({ label, target }) => (
            <a
              key={target}
              href={target === 'top' ? '#top' : `#${target}`}
              aria-current={target === 'top' ? 'page' : undefined}
              onClick={(event) => onLinkClick(event, target)}
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="landing-nav__actions">
          <button
            className="landing-nav__signin"
            type="button"
            onClick={() => {
              setOpen(false);
              navigate('/auth/login');
            }}
          >
            Sign in
          </button>
          <MagneticButton
            className="landing-button"
            onClick={() => {
              setOpen(false);
              navigate(findMentorPath);
            }}
          >
            Find a mentor <ArrowRight size={16} aria-hidden="true" />
          </MagneticButton>
          <button
            className="landing-nav__toggle"
            type="button"
            aria-expanded={open}
            aria-controls="landing-nav-panel"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </header>
  );
}

export default SuperrNav;
