import React, { createContext, useContext, useState, useEffect } from 'react';
import type { UserRole } from '@/src/types/navigation';

interface NavigationContextType {
  currentPath: string;
  currentRole: UserRole;
  navigate: (path: string) => void;
  switchRole: (role: UserRole) => void;
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Sync with browser URL pathname or default to /seeker
  const [currentPath, setCurrentPath] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const p = window.location.pathname;
      if (p.startsWith('/mentor')) return p;
      if (p.startsWith('/admin')) return p;
      if (p.startsWith('/seeker')) return p;
      return '/seeker';
    }
    return '/seeker';
  });

  // Determine active role from current path or explicit state
  const [currentRole, setCurrentRole] = useState<UserRole>(() => {
    if (typeof window !== 'undefined') {
      const p = window.location.pathname;
      if (p.startsWith('/admin')) return 'admin';
      if (p.startsWith('/mentor')) return 'mentor';
      return 'seeker';
    }
    return 'seeker';
  });

  const navigate = (path: string) => {
    setCurrentPath(path);
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', path);
    }

    // Auto update currentRole if path indicates different role domain
    if (path.startsWith('/admin')) {
      setCurrentRole('admin');
    } else if (path.startsWith('/mentor')) {
      setCurrentRole('mentor');
    } else if (path.startsWith('/seeker')) {
      setCurrentRole('seeker');
    }
  };

  const switchRole = (role: UserRole) => {
    setCurrentRole(role);
    if (role === 'admin') {
      navigate('/admin');
    } else if (role === 'mentor') {
      navigate('/mentor');
    } else {
      navigate('/seeker');
    }
  };

  useEffect(() => {
    const handlePopState = () => {
      const p = window.location.pathname || '/seeker';
      setCurrentPath(p);
      if (p.startsWith('/admin')) setCurrentRole('admin');
      else if (p.startsWith('/mentor')) setCurrentRole('mentor');
      else setCurrentRole('seeker');
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return (
    <NavigationContext.Provider value={{ currentPath, currentRole, navigate, switchRole }}>
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
