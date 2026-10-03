import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Menu, X } from 'lucide-react';
import { ThemeToggle } from '@/src/components/ui/ThemeToggle';
import { Button } from '@/src/components/ui/Button';
import { NAV_LINKS, ROUTE_SIGN_IN } from '@/src/components/landing/landingContent';

const NAV_BUTTON =
  'cursor-pointer rounded-lg px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sk-brand-focus)]';
const NAV_IDLE =
  'text-[var(--sk-brand-header-muted)] hover:bg-[var(--sk-brand-header-hover)] hover:text-[var(--sk-brand-header-text)]';
const GOLD =
  'bg-[var(--sk-brand-gold)] font-semibold text-[var(--sk-brand-on-gold)] hover:bg-[var(--sk-brand-gold-deep)]';
const TOGGLE =
  'border-[var(--sk-brand-header-border)] bg-transparent text-[var(--sk-brand-header-muted)] hover:bg-[var(--sk-brand-header-hover)] hover:text-[var(--sk-brand-header-text)] focus-visible:ring-[var(--sk-brand-focus)] focus-visible:ring-offset-[var(--sk-brand-plum)]';

export interface LandingNavProps {
  /** Where "Find a Mentor" goes, given the current auth state. */
  findMentorPath: string;
  onNavigate: (href: string) => void;
}

/**
 * FLOATING NAVIGATION.
 *
 * The auth behaviour is unchanged from the page this replaces: a signed-out
 * visitor is sent to sign up, because mentor discovery is a gated route and
 * that is the step which actually unlocks it. The destination arrives as a
 * prop rather than being re-derived here, so the nav can never disagree with
 * the hero's primary button about where "Find a Mentor" goes.
 */
export const LandingNav: React.FC<LandingNavProps> = ({ findMentorPath, onNavigate }) => {
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setIsOpen(false), []);

  // Escape closes the panel and a click outside it does too, so the mobile menu
  // can never be left stranded open over the page.
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const handlePointerDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) close();
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isOpen, close]);

  const go = (href: string) => () => {
    close();
    onNavigate(href);
  };

  return (
    <header className="sticky top-0 z-50 px-4 pt-3 sm:px-6 sm:pt-4 lg:px-8">
      <nav
        aria-label="Main navigation"
        className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-3 rounded-2xl border border-[var(--sk-brand-header-border)] bg-[var(--sk-brand-plum)]/90 px-3 shadow-[0_18px_44px_-24px_rgba(10,4,28,0.85)] backdrop-blur-xl sm:px-5"
      >
        <button
          type="button"
          onClick={go('/')}
          className="flex shrink-0 cursor-pointer items-center gap-2.5 rounded-lg p-1 text-left transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sk-brand-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sk-brand-plum)]"
        >
          <img src="/logo.png" alt="" className="h-9 w-9 rounded-xl object-cover" width={36} height={36} />
          <img src="/name.png" alt="Suggest Key" className="h-5 w-auto" />
        </button>

        <ul className="hidden items-center gap-0.5 lg:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.anchor}>
              <button type="button" onClick={go(`#${link.anchor}`)} className={`${NAV_BUTTON} ${NAV_IDLE}`}>
                {link.label}
              </button>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-2 lg:flex">
          <ThemeToggle buttonClassName={TOGGLE} />
          <Button variant="ghost" size="sm" onClick={go(ROUTE_SIGN_IN)} className={`min-h-[40px] text-[13px] ${NAV_IDLE}`}>
            Sign in
          </Button>
          <Button size="sm" onClick={go(findMentorPath)} className={`min-h-[40px] gap-1.5 px-4 text-[13px] ${GOLD}`}>
            Get Started
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          className={`flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center lg:hidden ${NAV_IDLE}`}
          aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={isOpen}
          aria-controls="landing-mobile-menu"
        >
          {isOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
        </button>
      </nav>
{isOpen && (
        <div
          id="landing-mobile-menu"
          ref={panelRef}
          className="mx-auto mt-2 max-w-[1240px] overflow-hidden rounded-2xl border border-[var(--sk-brand-header-border)] bg-[var(--sk-brand-plum)]/95 px-3 py-3 shadow-[0_24px_60px_-28px_rgba(10,4,28,0.9)] lg:hidden"
        >
          <ul className="space-y-0.5">
            {NAV_LINKS.map((link) => (
              <li key={link.anchor}>
                <button
                  type="button"
                  onClick={go(`#${link.anchor}`)}
                  className={`${NAV_BUTTON} ${NAV_IDLE} min-h-[44px] w-full text-left text-sm`}
                >
                  {link.label}
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-2 space-y-2 border-t border-[var(--sk-brand-header-border)] pt-3">
            <Button variant="ghost" size="md" onClick={go(ROUTE_SIGN_IN)} className={`w-full text-sm ${NAV_IDLE}`}>
              Sign in
            </Button>
            <Button size="md" onClick={go(findMentorPath)} className={`w-full gap-1.5 text-sm ${GOLD}`}>
              Find a Mentor
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/45">Theme</span>
              <ThemeToggle variant="labeled" buttonClassName={TOGGLE} />
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
