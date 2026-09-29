/**
 * THE SEEKER HEADER.
 *
 * Navigation only. The marketplace experience below it is untouched.
 *
 * Four decisions shape the structure, and each one is a requirement:
 *
 *  1. SEGMENTS, NOT LINKS. The centre of the bar is the segment switcher,
 *     because choosing a space IS the primary act on a mentorship marketplace.
 *     It is not a row of product links.
 *
 *  2. THE DATABASE OWNS THE SEGMENTS. The switcher renders whatever active
 *     segments exist, with their real display names, and selection is expressed
 *     purely as `/seeker?segment=<slug>`. No slug, name, colour or id is written
 *     into this file, and no segment state is held here: the URL is the single
 *     source of truth, shared with the page below.
 *
 *  3. BRAND BAR, ACCENT CONTROL. The bar is always the Suggest Key plum/gold
 *     field read from the logo. Only the ACTIVE segment control takes that
 *     segment's configured accent, and it does so through the token the theme
 *     provider already publishes — so a segment created tomorrow is on-brand in
 *     the header without anyone editing this component.
 *
 *  4. ACCOUNT ACTIONS LIVE IN THE HAMBURGER. Profile, bookings, notifications,
 *     settings, theme and sign out are account concerns, not marketplace
 *     navigation, so the bar keeps only "Home" plus the menu that holds them.
 *     Their existing routes and handlers are reused unchanged.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Bell,
  Calendar,
  Check,
  ChevronDown,
  Home as HomeIcon,
  LogIn,
  LogOut,
  Menu,
  Settings,
  User,
  X,
} from 'lucide-react';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { useNotifications } from '@/src/context/NotificationContext';
import { ThemeToggle } from '@/src/components/ui/ThemeToggle';
import { useActiveSegments } from '@/src/hooks/useActiveSegments';
import { getHighestPriorityActiveSegment } from '@/src/lib/discoveryService';
import {
  ALL_TOPICS,
  buildExperienceQuery,
  parseExperienceQuery,
} from '@/src/lib/segmentTopics';
import type { Segment } from '@/src/types/database';
import { cn } from '@/src/lib/utils';

export interface SeekerHeaderProps {
  /** Overrides the destination of the brand mark. Defaults to the seeker home. */
  homeHref?: string;
  /** Renders a lighter bar (used inside the admin "Preview as seeker" frame). */
  variant?: 'solid' | 'preview';
}

/** The seeker home. Also the destination that clears segment AND topic state. */
const SEEKER_HOME = '/seeker';

/** The one marketplace destination that keeps a permanent slot in the bar. */
const PRIMARY_LINKS = [
  { id: 'home', label: 'Home', href: SEEKER_HOME, icon: HomeIcon },
] as const;

/** Account-scoped actions. Never shown as a permanent row of buttons. */
const ACCOUNT_LINKS = [
  { id: 'profile', label: 'Profile', href: '/seeker/settings', icon: User },
  { id: 'bookings', label: 'My Bookings', href: '/seeker/bookings', icon: Calendar },
  { id: 'notifications', label: 'Notifications', href: '/seeker/notifications', icon: Bell },
  { id: 'settings', label: 'Settings', href: '/seeker/settings', icon: Settings },
] as const;

/** Live media query, so the menu is EITHER a popover OR a drawer, never both. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Initials for the menu's identity block. Falls back to a neutral glyph. */
function initialsFor(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name || email || '').trim();
  if (!source) return '';
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export const SeekerHeader: React.FC<SeekerHeaderProps> = ({ homeHref = SEEKER_HOME, variant = 'solid' }) => {
  const { currentPath, navigate } = useNavigation();
  const { user, profile, isAuthenticated, signOut } = useAuth();
  const { unreadCount } = useNotifications();
  const { segments, isLoading: isLoadingSegments } = useActiveSegments();
  const prefersReducedMotion = useReducedMotion();
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const [menuOpen, setMenuOpen] = useState(false);
  const [segmentPickerOpen, setSegmentPickerOpen] = useState(false);

  const headerRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const pickerButtonRef = useRef<HTMLButtonElement>(null);

  // The URL is the single source of truth for the selection. The header only
  // READS it, which is why the page and the header can never disagree.
  //
  // An absent or unknown slug is not "no selection": the page falls back to the
  // highest-priority active segment so it is never empty, and the header applies
  // the SAME rule rather than showing an unmarked bar over rendered content.
  const urlSlug = useMemo(() => parseExperienceQuery(currentPath).segment, [currentPath]);
  const activeSlug = useMemo(
    () =>
      urlSlug && segments.some((segment) => segment.slug === urlSlug)
        ? urlSlug
        : getHighestPriorityActiveSegment(segments)?.slug ?? null,
    [segments, urlSlug],
  );
  const activeSegment = useMemo(
    () => segments.find((segment) => segment.slug === activeSlug) ?? null,
    [segments, activeSlug],
  );

  const closeMenus = useCallback(() => {
    setMenuOpen(false);
    setSegmentPickerOpen(false);
  }, []);

  // Navigating always dismisses every surface, so a menu can never be left
  // hanging over a page the user has already left (including back/forward).
  useEffect(() => {
    closeMenus();
  }, [currentPath, closeMenus]);

  // Outside click and Escape, for both the menu and the mobile segment picker.
  useEffect(() => {
    if (!menuOpen && !segmentPickerOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const inHeader = headerRef.current?.contains(target);
      const inPanel = panelRef.current?.contains(target);
      const inPicker = pickerRef.current?.contains(target);
      if (!inHeader && !inPanel && !inPicker) closeMenus();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        const hadPanel = menuOpen;
        const hadPicker = segmentPickerOpen;
        closeMenus();
        if (hadPicker) pickerButtonRef.current?.focus();
        else if (hadPanel) menuButtonRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen, segmentPickerOpen, closeMenus]);

  // The drawer is a modal surface: lock the page behind it so the content
  // underneath cannot scroll away while the menu is open.
  useEffect(() => {
    if (!menuOpen || isDesktop) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen, isDesktop]);

  // Focus moves into an opened surface, so keyboard and screen-reader users
  // land inside the menu instead of being left behind the trigger.
  useEffect(() => {
    if (menuOpen) panelRef.current?.focus();
  }, [menuOpen]);

  useEffect(() => {
    if (segmentPickerOpen) pickerRef.current?.focus();
  }, [segmentPickerOpen]);

  const go = useCallback(
    (href: string) => {
      closeMenus();
      navigate(href);
    },
    [closeMenus, navigate],
  );

  /**
   * Selecting a segment is a NAVIGATION, not local state: it writes the same
   * `/seeker?segment=<slug>` URL the page reads, and it always clears the
   * topic, because a topic belongs to exactly one segment.
   */
  const selectSegment = useCallback(
    (segment: Segment) => {
      go(`${SEEKER_HOME}${buildExperienceQuery(segment.slug, ALL_TOPICS)}`);
    },
    [go],
  );

  const handleSignOut = useCallback(async () => {
    closeMenus();
    await signOut();
    navigate('/auth/login');
  }, [closeMenus, navigate, signOut]);

  const isSeekerHome = currentPath.split('?')[0] === SEEKER_HOME;
  const initials = initialsFor(profile?.full_name, user?.email);
  const displayName = profile?.full_name || user?.email || 'Account';

  const renderMenuPanel = (appearance: 'popover' | 'drawer' = 'popover') => (
    <div
      ref={panelRef}
      role="menu"
      aria-label="Account"
      tabIndex={-1}
      className={cn(
        'focus:outline-none',
        appearance === 'popover' ? 'sk-header-panel w-72 p-2' : 'w-full'
      )}
    >
      <div className="flex items-center gap-3 rounded-xl px-3 py-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--sk-brand-gold)] text-xs font-bold text-[var(--sk-brand-on-gold)]"
          aria-hidden="true"
        >
          {isAuthenticated && initials ? initials : <User className="h-5 w-5" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[var(--sk-brand-text)]">
            {displayName}
          </span>
          {user?.email && (
            <span className="mt-0.5 block truncate text-xs text-[var(--sk-brand-text-muted)]">
              {user.email}
            </span>
          )}
        </span>
      </div>

      <div className="my-1 h-px w-full bg-[var(--sk-brand-border)]" role="separator" />

      <p className="sk-menu-label">Account</p>
      <div role="group" aria-label="Account">
        {ACCOUNT_LINKS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="sk-menu-item"
              onClick={() => go(item.href)}
            >
              <Icon className="h-4 w-4 shrink-0 text-[var(--sk-brand-text-muted)]" aria-hidden="true" />
              <span className="flex-1">{item.label}</span>
              {item.id === 'notifications' && unreadCount > 0 && (
                <span className="rounded-full bg-[var(--sk-brand-gold)] px-2 py-0.5 text-[10px] font-bold text-[var(--sk-brand-on-gold)]">
                  {unreadCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="my-1.5 h-px w-full bg-[var(--sk-brand-border)]" role="separator" />

      {/* Preferences: the shared app-wide theme control, reused rather than
          re-implemented, so the header menu and every other menu offer the
          same Light / Dark / System behaviour. */}
      <div role="group" aria-label="Preferences" className="flex items-center justify-between gap-2 px-3 py-1.5">
        <span className="text-sm font-medium text-[var(--sk-brand-text)]">Theme</span>
        <ThemeToggle />
      </div>

      <div className="my-1.5 h-px w-full bg-[var(--sk-brand-border)]" role="separator" />

      <p className="sk-menu-label">Account actions</p>
      {isAuthenticated ? (
        <button type="button" role="menuitem" className="sk-menu-item" data-danger="true" onClick={handleSignOut}>
          <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Sign out</span>
        </button>
      ) : (
        <button type="button" role="menuitem" className="sk-menu-item" onClick={() => go('/auth/login')}>
          <LogIn className="h-4 w-4 shrink-0 text-[var(--sk-brand-text-muted)]" aria-hidden="true" />
          <span>Sign in</span>
        </button>
      )}
    </div>
  );

  const renderSegmentPicker = () => (
    <div
      ref={pickerRef}
      role="menu"
      aria-label="Choose your space"
      tabIndex={-1}
      className="sk-header-panel w-64 max-w-[calc(100vw-2rem)] p-2 focus:outline-none"
    >
      <p className="sk-menu-label">Choose your space</p>
      <div role="group" aria-label="Segments">
        {segments.map((segment) => {
          const isActive = segment.slug === activeSlug;
          return (
            <button
              key={segment.id}
              type="button"
              role="menuitemradio"
              aria-checked={isActive}
              data-active={isActive}
              className="sk-menu-item"
              onClick={() => selectSegment(segment)}
            >
              <span className="flex-1">{segment.name}</span>
              {isActive && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <header
      ref={headerRef}
      className={cn('sk-header sticky top-0 z-40 w-full', variant === 'preview' && 'relative')}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:h-[68px] sm:px-6 lg:px-8">
        {/* LEFT — the Suggest Key mark */}
        <button
          type="button"
          onClick={() => go(homeHref)}
          className="flex shrink-0 cursor-pointer items-center gap-2.5 rounded-xl p-1 text-left transition-transform duration-150 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--sk-brand-focus)] focus-visible:outline-offset-2"
          aria-label="Suggest Key home"
        >
          <img
            src="/logo.png"
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 rounded-[10px] object-cover shadow-xs ring-1 ring-white/10"
          />
          <span className="font-display text-[17px] font-bold leading-tight tracking-[-0.02em] text-[var(--sk-brand-header-text)]">
            Suggest Key
          </span>
        </button>

        {/* CENTER — the segment switcher: navigation, not content */}
        <nav
          className="hidden min-w-0 flex-1 justify-center md:flex"
          aria-label="Mentorship segments"
        >
          {isLoadingSegments ? (
            <div className="sk-segment-group" aria-hidden="true">
              <span className="sk-segment-pill" />
              <span className="sk-segment-pill" />
              <span className="sk-segment-pill" />
            </div>
          ) : segments.length > 0 ? (
            <div className="sk-segment-group" role="tablist" aria-label="Mentorship segments">
              {segments.map((segment) => {
                const isActive = segment.slug === activeSlug;
                return (
                  <button
                    key={segment.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    data-active={isActive}
                    className="sk-segment-pill"
                    onClick={() => selectSegment(segment)}
                  >
                    <span className="truncate">{segment.name}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </nav>

        {/* CENTER (mobile) — the current space, opening the full list on demand */}
        <div className="relative min-w-0 flex-1 md:hidden">
          <button
            ref={pickerButtonRef}
            type="button"
            onClick={() => setSegmentPickerOpen((open) => !open)}
            className="sk-segment-trigger"
            aria-haspopup="menu"
            aria-expanded={segmentPickerOpen}
            aria-label={
              activeSegment ? `Current space: ${activeSegment.name}. Change space` : 'Choose your space'
            }
          >
            <span className="truncate">
              {activeSegment ? activeSegment.name : isLoadingSegments ? 'Loading…' : 'Choose space'}
            </span>
            <ChevronDown
              className={cn('h-4 w-4 shrink-0 transition-transform duration-150', segmentPickerOpen && 'rotate-180')}
              aria-hidden="true"
            />
          </button>
          <AnimatePresence>
            {segmentPickerOpen && segments.length > 0 && (
              <motion.div
                initial={prefersReducedMotion ? false : { opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={prefersReducedMotion ? undefined : { opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.15, ease: [0.23, 1, 0.31, 1] }}
                className="absolute right-0 top-full z-50 mt-2 origin-top-right"
              >
                {renderSegmentPicker()}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* RIGHT — home, then the menu that holds every account action.
            Home is desktop-only by the same breakpoint that decides popover vs
            drawer: on mobile the logo is the way back to the seeker home, and a
            third control would squeeze the current-space trigger. */}
        <div className="flex shrink-0 items-center gap-1">
          {isDesktop &&
            PRIMARY_LINKS.map((item) => {
              const Icon = item.icon;
              const active = isSeekerHome;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => go(item.href)}
                  aria-current={active ? 'page' : undefined}
                  className="sk-header-link"
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}

          <div className="relative">
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="sk-icon-btn"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            >
              {menuOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
              {unreadCount > 0 && !menuOpen && (
                <span
                  className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--sk-brand-gold)] px-1 text-[9px] font-bold text-[var(--sk-brand-on-gold)]"
                  aria-hidden="true"
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {/* Desktop: a popover anchored to the trigger. */}
            <AnimatePresence>
              {menuOpen && isDesktop && (
                <motion.div
                  initial={prefersReducedMotion ? false : { opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={prefersReducedMotion ? undefined : { opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.15, ease: [0.23, 1, 0.31, 1] }}
                  className="absolute right-0 top-full z-50 mt-2 origin-top-right"
                >
                  {renderMenuPanel()}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Mobile: the same menu, as a proper drawer over a dismissible backdrop. */}
      <AnimatePresence>
        {menuOpen && !isDesktop && (
          <motion.div
            key="drawer"
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <button
              type="button"
              aria-label="Close menu"
              onClick={closeMenus}
              className="fixed inset-0 z-40 cursor-default bg-[var(--overlay-backdrop)]"
            />
            <motion.div
              initial={prefersReducedMotion ? false : { y: -12 }}
              animate={{ y: 0 }}
              exit={prefersReducedMotion ? undefined : { y: -12 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="relative z-50 max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-[var(--sk-brand-border)] bg-[var(--sk-brand-surface)] px-4 pb-6 pt-4"
            >
              <p className="pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--sk-brand-text-muted)]">
                Menu
              </p>
              {renderMenuPanel('drawer')}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};

export default SeekerHeader;
