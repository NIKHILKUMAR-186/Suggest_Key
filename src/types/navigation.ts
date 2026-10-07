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

/**
 * Grouped navigation for the Admin Control Center.
 *
 * The admin sidebar is organised into collapsible groups rather than a flat
 * list of 25+ items, so an operator can scan the operational surface by domain
 * (People / Marketplace / Scheduling / Finance / Sessions / Communications /
 * Support / Security / System) instead of scrolling an alphabetical list.
 */
export interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  defaultExpanded?: boolean;
  items: NavItem[];
}

export interface AdminNavConfig extends RoleNavConfig {
  role: 'admin';
  groups: NavGroup[];
}