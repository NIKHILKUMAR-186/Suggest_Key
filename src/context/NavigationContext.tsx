import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import type { UserRole } from '@/src/types/navigation';

interface NavigationContextType {
  currentPath: string;
  currentRole: UserRole | null;
  navigate: (path: string) => void;
  /**
   * Writes the path into the URL WITHOUT adding a history entry.
   *
   * Used to mirror live discovery state (selected date, filters) into the query
   * string. `navigate` would push an entry per keystroke, so Back would walk
   * through every filter change instead of leaving the page.
   */
  replace: (path: string) => void;
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeRole } = useAuth();

  const [currentPath, setCurrentPath] = useState<string>(() => {
    if (typeof window !== 'undefined') {
    const p = `${window.location.pathname}${window.location.search}`;
    if (p.startsWith('/admin')) return p;
    if (p.startsWith('/mentor')) return p;
    if (p.startsWith('/seeker')) return p;
    return p;
    }
    return '/seeker';
  });

  // `navigate` and `replace` only touch setState and history, so they are safe
  // to keep referentially stable for the life of the provider.
  const navigate = useCallback((path: string) => {
    setCurrentPath(path);
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', path);
    }
  }, []);

  const replace = useCallback((path: string) => {
    setCurrentPath(path);
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', path);
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const p = `${window.location.pathname || '/seeker'}${window.location.search}`;
      setCurrentPath(p);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  /**
   * This provider sits directly above the router, so an unmemoized value would
   * hand every consumer (AppShell, Router, every header) a new object on every
   * render and re-render the entire app tree on unrelated state changes.
   */
  const value = useMemo<NavigationContextType>(
    () => ({ currentPath, currentRole: activeRole, navigate, replace }),
    [currentPath, activeRole, navigate, replace],
  );

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
};

export const useNavigation = () => {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return context;
};