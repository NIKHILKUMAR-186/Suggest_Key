import {
  Compass,
  Calendar,
  Bell,
  Settings,
  Clock,
  LayoutDashboard,
  Users,
  UserCog,
  ShieldCheck,
  Layers,
  CreditCard,
  FileText,
  Activity,
  Percent,
  LifeBuoy,
  Briefcase,
  Search,
  Hourglass,
  CalendarClock,
  Video,
  Lock,
} from 'lucide-react';
import type { AdminNavConfig, NavGroup, RoleNavConfig, UserRole } from '@/src/types/navigation';

/**
 * Centralized, role-aware navigation configuration.
 *
 * Source of truth: SUGGEST-KEY-MVP-UPDATED.md, Section 4
 *
 * Seeker:
 *   Home, My Bookings, Notifications, Settings (Top Navigation)
 *   Help & Support is reached from Settings, not from the top nav.
 *
 * Mentor:
 *   Home, My Bookings, Availability, Notifications, Settings (Top Navigation)
 *   Help & Support is reached from Settings, not from the top nav.
 *
 * Admin (Control Center):
 *   Organised into collapsible operational groups (Overview / People /
 *   Marketplace / Scheduling / Finance / Sessions / Communications / Support /
 *   Security / System) rendered by AdminSidebar. The flattened `navItems` on
 *   the admin config is derived from those groups below, so the two can never
 *   describe different navigations.
 */

/**
 * The Control Center's grouped navigation.
 *
 * Every `href` must be a route `Router.tsx` implements — enforced by
 * `tests/admin_control_center.test.ts`, which parses both files. A group whose
 * items deep-link into a tab (e.g. Security → System Health logs) carries the
 * tab as a query string, which the target page reads on mount.
 *
 * `defaultExpanded` controls the resting state only; the group containing the
 * active route is always expanded regardless, so an operator never lands on a
 * highlighted item they cannot see.
 */
export const ADMIN_NAV_GROUPS: NavGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    defaultExpanded: true,
    items: [
      { id: 'admin-dashboard', label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
    ],
  },
  {
    id: 'people',
    label: 'People',
    icon: Users,
    items: [
      { id: 'admin-users', label: 'Users', href: '/admin/users', icon: Users },
      { id: 'admin-mentors', label: 'Mentors', href: '/admin/mentors', icon: UserCog },
      { id: 'admin-mentor-verification', label: 'Mentor Verification', href: '/admin/mentor-verification', icon: ShieldCheck },
    ],
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    icon: Layers,
    items: [
      { id: 'admin-segments', label: 'Segments', href: '/admin/segments', icon: Layers },
      { id: 'admin-gigs', label: 'Gigs', href: '/admin/gigs', icon: Briefcase },
      { id: 'admin-coupons', label: 'Coupons', href: '/admin/coupons', icon: Percent },
    ],
  },
  {
    id: 'scheduling',
    label: 'Scheduling',
    icon: Calendar,
    items: [
      { id: 'admin-bookings', label: 'Bookings', href: '/admin/bookings', icon: Calendar },
      { id: 'admin-slot-explorer', label: 'Slot Explorer', href: '/admin/slot-explorer', icon: Search },
      { id: 'admin-holds', label: 'Active Holds', href: '/admin/holds', icon: Hourglass },
      { id: 'admin-reschedules', label: 'Reschedules', href: '/admin/reschedules', icon: CalendarClock },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    icon: CreditCard,
    items: [
      { id: 'admin-payments', label: 'Payments', href: '/admin/payments', icon: CreditCard },
    ],
  },
  {
    id: 'sessions',
    label: 'Sessions',
    icon: Video,
    items: [
      { id: 'admin-workspaces', label: 'Workspaces', href: '/admin/workspaces', icon: FileText },
    ],
  },
  {
    id: 'communications',
    label: 'Communications',
    icon: Bell,
    items: [
      { id: 'admin-notifications', label: 'Notifications', href: '/admin/notifications', icon: Bell },
    ],
  },
  {
    id: 'support',
    label: 'Support',
    icon: LifeBuoy,
    defaultExpanded: true,
    items: [
      { id: 'admin-support', label: 'Support', href: '/admin/support', icon: LifeBuoy },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    icon: Lock,
    items: [
      // Both land on System Health with the matching log tab preselected;
      // AdminSystemHealthPage reads `?tab=` on mount.
      { id: 'admin-audit-logs', label: 'Audit Logs', href: '/admin/system-health?tab=audit', icon: Lock },
      { id: 'admin-auth-logs', label: 'Auth Logs', href: '/admin/system-health?tab=auth', icon: ShieldCheck },
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: Activity,
    items: [
      { id: 'admin-system-health', label: 'System Health', href: '/admin/system-health', icon: Activity },
      { id: 'admin-settings', label: 'Settings', href: '/admin/settings', icon: Settings },
    ],
  },
];

/**
 * The same items as a flat list, derived from the groups. Kept because
 * `RoleNavConfig` promises `navItems` (the badge pass in AdminSidebar maps over
 * it) — deriving here is what stops the flat list and the groups drifting apart.
 */
const adminNavItems = ADMIN_NAV_GROUPS.flatMap((group) => group.items);

export const ADMIN_NAV: AdminNavConfig = {
  role: 'admin',
  label: 'Admin Control',
  shellType: 'sidebar',
  groups: ADMIN_NAV_GROUPS,
  navItems: adminNavItems,
};

export const ROLE_NAVIGATION: Record<UserRole, RoleNavConfig> = {
  seeker: {
    role: 'seeker',
    label: 'Seeker Space',
    shellType: 'top-nav',
    navItems: [
      { id: 'seeker-home', label: 'Home', href: '/seeker', icon: Compass },
      { id: 'seeker-bookings', label: 'My Bookings', href: '/seeker/bookings', icon: Calendar },
      { id: 'seeker-notifications', label: 'Notifications', href: '/seeker/notifications', icon: Bell },
      { id: 'seeker-settings', label: 'Settings', href: '/seeker/settings', icon: Settings },
    ],
  },
  mentor: {
    role: 'mentor',
    label: 'Mentor Portal',
    shellType: 'top-nav',
    navItems: [
      { id: 'mentor-home', label: 'Home', href: '/mentor', icon: Compass },
      { id: 'mentor-bookings', label: 'My Bookings', href: '/mentor/bookings', icon: Calendar },
      { id: 'mentor-availability', label: 'Availability', href: '/mentor/availability', icon: Clock },
      { id: 'mentor-notifications', label: 'Notifications', href: '/mentor/notifications', icon: Bell },
      { id: 'mentor-settings', label: 'Settings', href: '/mentor/settings', icon: Settings },
    ],
  },
  // The admin sidebar renders `ADMIN_NAV_GROUPS`, not this flat list; the
  // flat `navItems` below is the same data flattened, exported via ADMIN_NAV.
  admin: ADMIN_NAV,
};
