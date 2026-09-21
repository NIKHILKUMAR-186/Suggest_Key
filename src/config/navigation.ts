import {
  Compass,
  Calendar,
  Bell,
  Settings,
  Clock,
  LayoutDashboard,
  Users,
  Award,
  Layers,
  CreditCard,
  FileText,
} from 'lucide-react';
import type { RoleNavConfig, UserRole } from '@/src/types/navigation';

/**
 * Centralized, role-aware navigation configuration.
 *
 * Source of truth: SUGGEST-KEY-MVP-UPDATED.md, Section 4
 *
 * Seeker:
 *   Home, My Bookings, Notifications, Settings (Top Navigation)
 *
 * Mentor:
 *   Home, My Bookings, Availability, Notifications, Settings (Top Navigation)
 *
 * Admin:
 *   Dashboard, Users, Mentors, Segments, Bookings, Payments, Notifications, Settings (Sidebar)
 */

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
  admin: {
    role: 'admin',
    label: 'Admin Control',
    shellType: 'sidebar',
    navItems: [
      { id: 'admin-dashboard', label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
      { id: 'admin-users', label: 'Users', href: '/admin/users', icon: Users },
      { id: 'admin-mentors', label: 'Mentors', href: '/admin/mentors', icon: Award },
      { id: 'admin-segments', label: 'Segments', href: '/admin/segments', icon: Layers },
      { id: 'admin-bookings', label: 'Bookings', href: '/admin/bookings', icon: Calendar },
      { id: 'admin-workspaces', label: 'Workspaces', href: '/admin/workspaces', icon: FileText },
      { id: 'admin-payments', label: 'Payments', href: '/admin/payments', icon: CreditCard },
      { id: 'admin-notifications', label: 'Notifications', href: '/admin/notifications', icon: Bell },
      { id: 'admin-settings', label: 'Settings', href: '/admin/settings', icon: Settings },
    ],
  },
};
