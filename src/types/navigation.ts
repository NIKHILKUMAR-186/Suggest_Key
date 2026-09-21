import type { LucideIcon } from 'lucide-react';

export type UserRole = 'seeker' | 'mentor' | 'admin';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: string | number;
}

export interface RoleNavConfig {
  role: UserRole;
  label: string;
  shellType: 'top-nav' | 'sidebar';
  navItems: NavItem[];
}
