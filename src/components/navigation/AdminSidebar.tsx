import React, { useState, useEffect } from 'react';
import {
  Menu,
  X,
  KeyRound,
  Shield,
  ChevronRight,
  LogOut,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { useNotifications } from '@/src/context/NotificationContext';
import { ROLE_NAVIGATION } from '@/src/config/navigation';
import { cn } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/Button';

export const AdminSidebar: React.FC = () => {
  const { currentPath, navigate } = useNavigation();
  const { user, profile, signOut } = useAuth();
  const { unreadCount } = useNotifications();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const baseConfig = ROLE_NAVIGATION.admin;
  const config = {
    ...baseConfig,
    navItems: baseConfig.navItems.map((item) => {
      if (item.id.includes('notification') && unreadCount > 0) {
        return { ...item, badge: unreadCount };
      }
      return item;
    }),
  };

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileSidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [mobileSidebarOpen]);

  const handleNavClick = (href: string) => {
    navigate(href);
    setMobileSidebarOpen(false);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth/login');
    setMobileSidebarOpen(false);
  };

  const navContent = (
    <div className="flex h-full flex-col justify-between p-4 overflow-y-auto">
      {/* Top section: Brand & Navigation */}
      <div className="space-y-6">
        {/* Admin Header */}
        <div className="flex items-center justify-between pb-3 border-b border-zinc-200">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-950 text-white shadow-xs ring-1 ring-zinc-800">
              <Shield className="h-5 w-5 text-rose-400" />
            </div>
            <div>
              <span className="text-sm font-bold tracking-tight text-zinc-950 block font-display">
                Suggest Key
              </span>
              <span className="text-[10px] font-bold tracking-wider uppercase text-rose-600">
                Admin Console
              </span>
            </div>
          </div>
          {mobileSidebarOpen && (
            <button
              onClick={() => setMobileSidebarOpen(false)}
              className="p-1.5 text-zinc-500 hover:text-zinc-950 rounded-lg hover:bg-zinc-100 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950"
              aria-label="Close sidebar"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Navigation List */}
        <div className="space-y-1">
          <div className="px-2.5 py-1 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
            Operations & Governance
          </div>
          <nav className="space-y-0.5" aria-label="Admin Navigation">
            {config.navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.href === currentPath ||
                (item.href !== '/admin' && currentPath.startsWith(item.href));

              return (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item.href)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'group flex w-full items-center justify-between px-3 py-2.5 text-xs font-medium rounded-xl transition-all text-left cursor-pointer min-h-[40px]',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950',
                    isActive
                      ? 'bg-zinc-950 text-white shadow-xs font-semibold'
                      : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950'
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-white' : 'text-zinc-500')} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge !== undefined && (
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-bold',
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
        </div>
      </div>

      {/* Admin User Profile & Sign Out */}
      <div className="pt-4 border-t border-zinc-200 space-y-3">
        {/* User Card */}
        <div className="rounded-xl bg-white border border-zinc-200 p-2.5 flex items-center gap-2.5 shadow-2xs">
          <div className="h-8 w-8 rounded-lg bg-zinc-950 text-white flex items-center justify-center font-bold text-xs shrink-0 ring-1 ring-zinc-800">
            {profile?.full_name?.charAt(0) || 'A'}
          </div>
          <div className="overflow-hidden flex-1">
            <span className="text-xs font-bold text-zinc-950 truncate block">
              {profile?.full_name || 'Admin User'}
            </span>
            <span className="text-[10px] text-zinc-400 truncate block">
              {user?.email || 'admin@suggestkey.com'}
            </span>
          </div>
          <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 text-[9px] font-bold uppercase tracking-wider">
            Admin
          </span>
        </div>

        {/* Sign Out Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleSignOut}
          className="w-full text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200 gap-1.5 min-h-[38px]"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>Sign Out Admin</span>
        </Button>

        <div className="px-2 text-[10px] text-zinc-400 flex items-center justify-between">
          <span>RLS & Security Definers</span>
          <span className="font-mono text-[10px] bg-zinc-100 px-1.5 py-0.5 rounded">PostgreSQL</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Header Bar for Admin */}
      <div className="md:hidden sticky top-0 z-40 flex h-14 w-full items-center justify-between border-b border-zinc-200 bg-white/95 backdrop-blur-md px-4">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-rose-600" />
          <span className="font-bold text-sm text-zinc-950 font-display">Suggest Key Admin</span>
        </div>
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="p-2 text-zinc-600 hover:text-zinc-950 rounded-lg hover:bg-zinc-100 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950"
          aria-label="Open Sidebar"
          aria-expanded={mobileSidebarOpen}
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* Desktop Persistent Sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r border-zinc-200 bg-zinc-50/50 shrink-0 min-h-screen">
        {navContent}
      </aside>

      {/* Mobile Sidebar Overlay with Framer Motion */}
      <AnimatePresence>
        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-50 md:hidden flex">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 bg-zinc-950/40 backdrop-blur-xs"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="relative flex w-72 flex-col bg-white shadow-2xl z-10"
            >
              {navContent}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};