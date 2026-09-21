import React, { useState, useEffect, useRef } from 'react';
import { Menu, X, KeyRound, ArrowRightLeft, LogOut, LogIn, ChevronDown, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { useNotifications } from '@/src/context/NotificationContext';
import { ROLE_NAVIGATION } from '@/src/config/navigation';
import { cn } from '@/src/lib/utils';
import type { UserRole } from '@/src/types/navigation';
import { Button } from '@/src/components/ui/Button';

export const TopNavigation: React.FC = () => {
  const { currentPath, currentRole, navigate, switchRole } = useNavigation();
  const { user, profile, roles, isAuthenticated, signOut, switchActiveRole } = useAuth();
  const { unreadCount } = useNotifications();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [roleSwitcherOpen, setRoleSwitcherOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  const roleSwitcherRef = useRef<HTMLDivElement>(null);
  const userDropdownRef = useRef<HTMLDivElement>(null);

  const baseConfig = ROLE_NAVIGATION[currentRole] || ROLE_NAVIGATION.seeker;
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
      if (roleSwitcherRef.current && !roleSwitcherRef.current.contains(e.target as Node)) {
        setRoleSwitcherOpen(false);
      }
      if (userDropdownRef.current && !userDropdownRef.current.contains(e.target as Node)) {
        setUserDropdownOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setRoleSwitcherOpen(false);
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

  const handleRoleChange = (role: UserRole) => {
    switchActiveRole(role);
    switchRole(role);
    setRoleSwitcherOpen(false);
    setMobileMenuOpen(false);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth/login');
    setUserDropdownOpen(false);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-zinc-200 bg-white/95 backdrop-blur-md transition-shadow">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand & Logo */}
        <div className="flex items-center gap-8">
          <button
            onClick={() => handleNavClick(config.navItems[0].href)}
            className="flex items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 rounded-lg p-1 transition-transform active:scale-[0.98] cursor-pointer"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-950 text-white font-bold text-base shadow-xs ring-1 ring-zinc-800">
              <KeyRound className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <span className="text-base font-bold tracking-tight text-zinc-950 block leading-tight font-display">
                Suggest Key
              </span>
              <span className="text-[10px] font-semibold tracking-wide uppercase text-zinc-500">
                {config.label}
              </span>
            </div>
          </button>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-1" aria-label="Main Navigation">
            {config.navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.href === currentPath ||
                (item.href !== `/${currentRole}` && currentPath.startsWith(item.href));

              return (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item.href)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg transition-all relative cursor-pointer',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950',
                    isActive
                      ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-2xs'
                      : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950'
                  )}
                >
                  <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-zinc-950' : 'text-zinc-500')} />
                  <span>{item.label}</span>
                  {item.badge !== undefined && (
                    <span
                      className={cn(
                        'ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full transition-colors',
                        isActive ? 'bg-zinc-950 text-white' : 'bg-zinc-200 text-zinc-800'
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

        {/* Right Section: Auth & Role Status */}
        <div className="hidden md:flex items-center gap-3">
          {/* Role Shell Switcher (for multi-role users or testing) */}
          <div className="relative" ref={roleSwitcherRef}>
            <button
              onClick={() => setRoleSwitcherOpen(!roleSwitcherOpen)}
              aria-expanded={roleSwitcherOpen}
              aria-haspopup="menu"
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-zinc-700 bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950"
              title="Role Shell Switcher"
            >
              <ArrowRightLeft className="h-3.5 w-3.5 text-zinc-500" />
              <span>
                Role: <strong className="capitalize text-zinc-950">{currentRole}</strong>
              </span>
              <ChevronDown className={cn('h-3.5 w-3.5 text-zinc-400 transition-transform duration-150', roleSwitcherOpen && 'rotate-180')} />
            </button>

            <AnimatePresence>
              {roleSwitcherOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 4 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="absolute right-0 mt-2 w-52 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl z-50"
                  role="menu"
                >
                  <div className="px-2.5 py-1 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                    Switch Active Role
                  </div>
                  {(['seeker', 'mentor', 'admin'] as UserRole[]).map((r) => {
                    const isAssigned = roles.includes(r) || roles.includes('admin');
                    return (
                      <button
                        key={r}
                        onClick={() => handleRoleChange(r)}
                        disabled={!isAssigned}
                        role="menuitem"
                        className={cn(
                          'w-full text-left px-2.5 py-2 text-xs rounded-lg transition-colors capitalize flex items-center justify-between',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950',
                          !isAssigned
                            ? 'opacity-40 cursor-not-allowed text-zinc-400'
                            : currentRole === r
                            ? 'bg-zinc-100 font-semibold text-zinc-950 cursor-pointer'
                            : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950 cursor-pointer'
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span className={cn('h-2 w-2 rounded-full', currentRole === r ? 'bg-emerald-600' : 'bg-zinc-300')} />
                          {r} View
                        </span>
                        {currentRole === r && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* User Profile or Sign In */}
          {isAuthenticated ? (
            <div className="relative" ref={userDropdownRef}>
              <button
                onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                aria-expanded={userDropdownOpen}
                aria-haspopup="menu"
                className="flex items-center gap-2 px-2 py-1 rounded-xl hover:bg-zinc-50 border border-transparent hover:border-zinc-200 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950"
              >
                <div className="h-8 w-8 rounded-full bg-zinc-950 text-white flex items-center justify-center text-xs font-bold shadow-2xs ring-1 ring-zinc-800">
                  {profile?.full_name?.charAt(0) || user?.email?.charAt(0)?.toUpperCase() || 'U'}
                </div>
                <div className="text-left hidden lg:block">
                  <span className="text-xs font-bold text-zinc-950 block leading-tight">
                    {profile?.full_name || 'User'}
                  </span>
                  <span className="text-[10px] text-zinc-500 block leading-none truncate max-w-[140px]">
                    {user?.email}
                  </span>
                </div>
                <ChevronDown className={cn('h-3.5 w-3.5 text-zinc-400 transition-transform duration-150 hidden lg:block', userDropdownOpen && 'rotate-180')} />
              </button>

              <AnimatePresence>
                {userDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 4 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                    className="absolute right-0 mt-2 w-60 rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl z-50 space-y-1"
                    role="menu"
                  >
                    <div className="px-3 py-2.5 border-b border-zinc-100">
                      <p className="text-xs font-bold text-zinc-950 truncate">
                        {profile?.full_name || 'User'}
                      </p>
                      <p className="text-[11px] text-zinc-500 truncate mt-0.5">{user?.email}</p>
                      <div className="flex gap-1.5 mt-2 flex-wrap">
                        {roles.map((r) => (
                          <span
                            key={r}
                            className="px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-700 text-[10px] font-bold uppercase tracking-wider"
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        navigate(`/${currentRole}/settings`);
                        setUserDropdownOpen(false);
                      }}
                      role="menuitem"
                      className="w-full text-left px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950"
                    >
                      Account Settings
                    </button>

                    <button
                      onClick={handleSignOut}
                      role="menuitem"
                      className="w-full text-left px-3 py-2 text-xs text-rose-600 hover:bg-rose-50 rounded-lg transition-colors flex items-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
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
          {unreadCount > 0 && (
            <button
              onClick={() => handleNavClick(`/${currentRole}/notifications`)}
              className="p-2 text-zinc-600 hover:text-zinc-950 relative rounded-lg"
              aria-label="View notifications"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-950 text-white text-[10px] font-bold">
                {unreadCount}
              </span>
            </button>
          )}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2.5 text-zinc-600 hover:text-zinc-950 rounded-lg hover:bg-zinc-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 cursor-pointer"
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
          <div className="fixed inset-0 top-16 z-50 md:hidden flex flex-col">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 top-16 bg-zinc-950/40 backdrop-blur-xs"
              onClick={() => setMobileMenuOpen(false)}
            />

            {/* Menu Container */}
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="relative w-full max-h-[calc(100vh-4rem)] overflow-y-auto border-b border-zinc-200 bg-white px-5 pt-3 pb-8 shadow-2xl space-y-4"
            >
              {/* Header inside mobile drawer */}
              <div className="py-2 flex items-center justify-between border-b border-zinc-100 pb-3">
                <span className="text-xs font-bold uppercase text-zinc-400 tracking-wider">
                  {config.label}
                </span>
                {isAuthenticated && (
                  <span className="text-xs text-zinc-600 font-mono truncate max-w-[200px]">
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
                    (item.href !== `/${currentRole}` && currentPath.startsWith(item.href));

                  return (
                    <button
                      key={item.id}
                      onClick={() => handleNavClick(item.href)}
                      className={cn(
                        'flex w-full items-center gap-3 px-3.5 py-3 text-sm font-medium rounded-xl transition-all text-left cursor-pointer min-h-[44px]',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950',
                        isActive
                          ? 'bg-zinc-950 text-white font-semibold shadow-xs'
                          : 'text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950'
                      )}
                    >
                      <Icon className={cn('h-5 w-5 shrink-0', isActive ? 'text-white' : 'text-zinc-500')} />
                      <span className="flex-1">{item.label}</span>
                      {item.badge !== undefined && (
                        <span
                          className={cn(
                            'px-2 py-0.5 text-xs font-bold rounded-full',
                            isActive ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-200 text-zinc-800'
                          )}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>

              {/* Mobile Role Switcher */}
              <div className="pt-3 border-t border-zinc-200 space-y-2">
                <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider block">
                  Switch Active Role Shell
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {(['seeker', 'mentor', 'admin'] as UserRole[]).map((r) => {
                    const isAssigned = roles.includes(r) || roles.includes('admin');
                    return (
                      <button
                        key={r}
                        onClick={() => handleRoleChange(r)}
                        disabled={!isAssigned}
                        className={cn(
                          'py-2 px-2 text-xs rounded-lg font-semibold capitalize border transition-all text-center min-h-[40px] flex items-center justify-center',
                          !isAssigned
                            ? 'opacity-30 border-zinc-200 text-zinc-400 cursor-not-allowed'
                            : currentRole === r
                            ? 'border-zinc-950 bg-zinc-950 text-white shadow-2xs'
                            : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100'
                        )}
                      >
                        {r}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Mobile Sign Out / Sign In */}
              <div className="pt-3 border-t border-zinc-200 space-y-2">
                {isAuthenticated ? (
                  <Button
                    variant="outline"
                    size="md"
                    onClick={handleSignOut}
                    className="w-full text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200 gap-2 min-h-[44px]"
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
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </header>
  );
};

