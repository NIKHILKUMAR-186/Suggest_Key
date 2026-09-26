import React, { useState, useEffect, useRef } from 'react';
import { Menu, X, LogOut, LogIn, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { useNotifications } from '@/src/context/NotificationContext';
import { ROLE_NAVIGATION } from '@/src/config/navigation';
import { cn } from '@/src/lib/utils';
import type { UserRole } from '@/src/types/navigation';
import { Button } from '@/src/components/ui/Button';
import { ThemeToggle } from '@/src/components/ui/ThemeToggle';

export const TopNavigation: React.FC = () => {
  const { currentPath, currentRole, navigate } = useNavigation();
  const { user, profile, roles, isAuthenticated, signOut } = useAuth();
  const { unreadCount } = useNotifications();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  const userDropdownRef = useRef<HTMLDivElement>(null);

  // `currentRole` is null when the database has no role row for the account.
  // Navigation links still need a concrete path prefix, so the display prefix
  // falls back to the seeker shell. This is presentation only: `ProtectedRoute`
  // authorises against the real `roles` array, so no access is granted here.
  const rolePrefix = currentRole ?? 'seeker';

  const baseConfig = ROLE_NAVIGATION[rolePrefix] || ROLE_NAVIGATION.seeker;
  const config = {
    ...baseConfig,
    navItems: baseConfig.navItems.map((item) => {
      if (item.id.includes('notification') && unreadCount > 0) {
        return { ...item, badge: unreadCount };
      }
      return item;
    }),
  };

  // Close dropdowns on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userDropdownRef.current && !userDropdownRef.current.contains(e.target as Node)) {
        setUserDropdownOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setUserDropdownOpen(false);
        setMobileMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Prevent scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [mobileMenuOpen]);

  const handleNavClick = (href: string) => {
    navigate(href);
    setMobileMenuOpen(false);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth/login');
    setUserDropdownOpen(false);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[var(--color-shell-border)] bg-[var(--color-shell-bg)]/80 shadow-[0_1px_0_rgba(186,215,247,0.04),0_10px_30px_-24px_rgba(0,0,0,0.9)] backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:h-[68px] sm:px-6 lg:px-8">
        {/* Brand & Logo */}
        <div className="flex items-center gap-4 sm:gap-7">
          <button
            onClick={() => handleNavClick(config.navItems[0].href)}
            className="flex cursor-pointer items-center gap-3 rounded-xl p-1 text-left transition-transform duration-150 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--color-shell-focus)] focus-visible:outline-offset-2"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-gradient-to-br from-[var(--color-shell-primary)] to-[var(--color-shell-accent)] font-bold text-white shadow-[var(--shadow-sm)] ring-1 ring-inset ring-white/25">
              <span className="text-[13px] font-bold tracking-tight">SK</span>
            </div>
            <div>
              <span className="block font-display text-[17px] font-bold leading-tight tracking-[-0.02em] text-[var(--color-shell-text)]">
                Suggest Key
              </span>
              <span className="mt-0.5 block rounded-md bg-[var(--color-shell-primary-soft)] px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--color-shell-primary)]">
                {config.label}
              </span>
            </div>
          </button>

          {/* Desktop Nav Links */}
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main Navigation">
            {config.navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.href === currentPath ||
                (item.href !== `/${rolePrefix}` && currentPath.startsWith(item.href));

              return (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item.href)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'group relative flex min-h-[40px] cursor-pointer items-center gap-2 rounded-full px-4 text-[13px] font-medium transition-all duration-200',
                    'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--color-shell-focus)] focus-visible:outline-offset-2',
                    isActive
                      ? 'bg-[var(--color-shell-primary)] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(102,57,243,0.9)]'
                      : 'text-[var(--color-shell-text-muted)] hover:bg-[var(--color-shell-primary-soft)] hover:text-[var(--color-shell-text)]'
                  )}
                >
                  <Icon
                    className={cn(
                      'h-4 w-4 shrink-0 transition-colors duration-200',
                      isActive ? 'text-white' : 'text-[var(--color-shell-text-subtle)] group-hover:text-[var(--color-shell-primary)]'
                    )}
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                  {item.badge !== undefined && (
                    <span
                      className={cn(
                        'ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums transition-colors',
                        isActive
                          ? 'bg-white/20 text-white'
                          : 'bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-muted)]'
                      )}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right Section: Theme Toggle + User Profile or Sign In */}
        <div className="hidden md:flex items-center gap-3">
          <ThemeToggle />
          {isAuthenticated ? (
            <div className="relative" ref={userDropdownRef}>
              <button
                onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                aria-expanded={userDropdownOpen}
                aria-haspopup="menu"
                className="flex cursor-pointer items-center gap-2.5 rounded-full border border-transparent py-1 pl-1 pr-2.5 transition-colors duration-150 hover:border-[var(--color-shell-border)] hover:bg-[var(--color-shell-surface)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--color-shell-focus)] focus-visible:outline-offset-2"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-shell-primary)] to-[var(--color-shell-accent)] text-[12px] font-bold text-white shadow-[var(--shadow-sm)] ring-2 ring-[var(--color-shell-bg)]">
                  {(profile?.full_name || user?.email || 'U').slice(0, 1).toUpperCase()}
                </div>
                <div className="hidden text-left lg:block">
                  <span className="block max-w-[150px] truncate text-[13px] font-bold leading-tight text-[var(--color-shell-text)]">
                    {profile?.full_name || 'User'}
                  </span>
                  <span className="block max-w-[150px] truncate text-[11px] leading-none text-[var(--color-shell-text-subtle)]">
                    {user?.email}
                  </span>
                </div>
                <ChevronDown className={cn('hidden h-3.5 w-3.5 text-[var(--color-shell-text-muted)] transition-transform duration-200 lg:block', userDropdownOpen && 'rotate-180')} />
              </button>

              <AnimatePresence>
                {userDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 4 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                    className="absolute right-0 z-50 mt-2.5 w-64 space-y-1 rounded-2xl border border-[var(--seeker-panel-border)] bg-[var(--color-shell-surface-elevated)] p-2 shadow-[var(--shadow-xl)]"
                    role="menu"
                  >
                    <div className="rounded-xl bg-[var(--color-shell-primary-soft)] px-3 py-2.5">
                      <p className="truncate text-[13px] font-bold text-[var(--color-shell-text)]">
                        {profile?.full_name || 'User'}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-[var(--color-shell-text-muted)]">{user?.email}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {roles.map((r) => (
                          <span
                            key={r}
                            className="rounded-md bg-[var(--color-shell-surface-elevated)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-shell-primary)]"
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        navigate(`/${rolePrefix}/settings`);
                        setUserDropdownOpen(false);
                      }}
                      role="menuitem"
                      className="w-full cursor-pointer rounded-lg px-3 py-2.5 text-left text-[13px] font-medium text-[var(--color-shell-text-muted)] transition-colors hover:bg-[var(--color-shell-bg-hover)] hover:text-[var(--color-shell-text)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--color-shell-focus)] focus-visible:outline-offset-2"
                    >
                      Account Settings
                    </button>

                    <button
                      onClick={handleSignOut}
                      role="menuitem"
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium text-[var(--color-shell-error)] transition-colors hover:bg-[var(--color-shell-error-soft)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--color-shell-error)] focus-visible:outline-offset-2"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/auth/login')}
                className="text-xs gap-1.5 shadow-2xs font-medium"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>Sign In</span>
              </Button>
            </div>
          )}
        </div>

        {/* Mobile Hamburger Button */}
        <div className="flex md:hidden items-center gap-2">
          <ThemeToggle />
          {unreadCount > 0 && (
            <button
              onClick={() => handleNavClick(`/${rolePrefix}/notifications`)}
              className="p-2 text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] relative rounded-lg"
              aria-label="View notifications"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-shell-primary)] text-white text-[10px] font-bold">
                {unreadCount}
              </span>
            </button>
          )}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2.5 text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] rounded-lg hover:bg-[var(--color-shell-surface)] transition-colors focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--color-shell-focus)] focus-visible:outline-offset-2 cursor-pointer"
            aria-label="Toggle Navigation"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu with AnimatePresence & Backdrop */}
      <AnimatePresence>
        {mobileMenuOpen && (
            <div className="fixed inset-0 top-16 z-50 flex flex-col sm:top-[68px] md:hidden">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 top-16 bg-black/70 backdrop-blur-sm sm:top-[68px]"
              onClick={() => setMobileMenuOpen(false)}
            />

            {/* Menu Container */}
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="relative max-h-[calc(100vh-4rem)] space-y-4 overflow-y-auto rounded-b-none border-b border-[var(--seeker-panel-border)] bg-[var(--color-shell-surface)] px-5 pb-8 pt-3 shadow-2xl sm:max-h-[calc(100vh-4.25rem)]"
            >
              {/* Header inside mobile drawer */}
              <div className="py-2 flex items-center justify-between border-b border-[var(--color-shell-border)] pb-3">
                <span className="text-xs font-bold uppercase text-[var(--color-shell-text-muted)] tracking-wider">
                  {config.label}
                </span>
                {isAuthenticated && (
                  <span className="text-xs text-[var(--color-shell-text-muted)] font-mono truncate max-w-[200px]">
                    {user?.email}
                  </span>
                )}
              </div>

              {/* Navigation Items */}
              <nav className="space-y-1" aria-label="Mobile Navigation">
                {config.navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    item.href === currentPath ||
                    (item.href !== `/${rolePrefix}` && currentPath.startsWith(item.href));

                  return (
                    <button
                      key={item.id}
                      onClick={() => handleNavClick(item.href)}
                      className={cn(
                        'flex min-h-[48px] w-full cursor-pointer items-center gap-3 rounded-xl px-3.5 py-3 text-left text-sm font-medium transition-all duration-150',
                        'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--color-shell-focus)] focus-visible:outline-offset-2',
                        isActive
                          ? 'bg-[var(--color-shell-primary)] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(102,57,243,0.9)]'
                          : 'text-[var(--color-shell-text-muted)] hover:bg-[var(--color-shell-primary-soft)] hover:text-[var(--color-shell-text)]'
                      )}
                    >
                      <Icon className={cn('h-5 w-5 shrink-0', isActive ? 'text-white' : 'text-[var(--color-shell-text-muted)]')} />
                      <span className="flex-1">{item.label}</span>
                      {item.badge !== undefined && (
                        <span
                          className={cn(
                            'px-2 py-0.5 text-xs font-bold rounded-full',
                            isActive ? 'bg-white/20 text-white' : 'bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-muted)]'
                          )}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>

              {/* Mobile Sign Out / Sign In */}
              <div className="pt-3 border-t border-[var(--color-shell-border)] space-y-2">
                {isAuthenticated ? (
                  <Button
                    variant="outline"
                    size="md"
                    onClick={handleSignOut}
                    className="w-full text-xs text-[var(--color-shell-error)] hover:bg-[var(--color-shell-error-soft)] border-[var(--color-shell-error)]/30 gap-2 min-h-[44px]"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Sign Out ({profile?.full_name || user?.email})</span>
                  </Button>
                ) : (
                  <Button
                    size="md"
                    onClick={() => {
                      navigate('/auth/login');
                      setMobileMenuOpen(false);
                    }}
                    className="w-full text-xs gap-2 min-h-[44px]"
                  >
                    <LogIn className="h-4 w-4" />
                    <span>Sign In to Suggest Key</span>
                  </Button>
                )}
              </div>

              {/* Mobile theme selection */}
              <div className="pt-1 pb-1 flex items-center justify-between gap-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-shell-text-subtle)]">
                  Theme
                </span>
                <ThemeToggle variant="labeled" />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </header>
  );
};