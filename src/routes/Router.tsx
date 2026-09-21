import React from 'react';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { ProtectedRoute } from '@/src/components/auth/ProtectedRoute';

// Auth Pages
import { LoginPage } from '@/src/pages/auth/LoginPage';
import { SignUpPage } from '@/src/pages/auth/SignUpPage';
import { UnauthorizedPage } from '@/src/pages/auth/UnauthorizedPage';

// Seeker Pages
import { SeekerHomePage } from '@/src/pages/seeker/SeekerHomePage';
import { SeekerMentorListPage } from '@/src/pages/seeker/SeekerMentorListPage';
import { SeekerMentorDetailPage } from '@/src/pages/seeker/SeekerMentorDetailPage';
import { SeekerBookingsPage } from '@/src/pages/seeker/SeekerBookingsPage';
import { SeekerBookingDetailPage } from '@/src/pages/seeker/SeekerBookingDetailPage';
import { SeekerPaymentPage } from '@/src/pages/seeker/SeekerPaymentPage';
import { SeekerNotificationsPage } from '@/src/pages/seeker/SeekerNotificationsPage';
import { SeekerSettingsPage } from '@/src/pages/seeker/SeekerSettingsPage';
import { SeekerSessionPage } from '@/src/pages/seeker/SeekerSessionPage';
import { SeekerWorkspacePage } from '@/src/pages/seeker/SeekerWorkspacePage';

// Mentor Pages
import { MentorHomePage } from '@/src/pages/mentor/MentorHomePage';
import { MentorBookingsPage } from '@/src/pages/mentor/MentorBookingsPage';
import { MentorBookingDetailPage } from '@/src/pages/mentor/MentorBookingDetailPage';
import { MentorAvailabilityPage } from '@/src/pages/mentor/MentorAvailabilityPage';
import { MentorNotificationsPage } from '@/src/pages/mentor/MentorNotificationsPage';
import { MentorSettingsPage } from '@/src/pages/mentor/MentorSettingsPage';
import { MentorGigsPage } from '@/src/pages/mentor/MentorGigsPage';
import { MentorSegmentsPage } from '@/src/pages/mentor/MentorSegmentsPage';
import { MentorWorkspacePage } from '@/src/pages/mentor/MentorWorkspacePage';

// Admin Pages
import { AdminDashboardPage } from '@/src/pages/admin/AdminDashboardPage';
import { AdminUsersPage } from '@/src/pages/admin/AdminUsersPage';
import { AdminMentorsPage } from '@/src/pages/admin/AdminMentorsPage';
import { AdminSegmentsPage } from '@/src/pages/admin/AdminSegmentsPage';
import { AdminBookingsPage } from '@/src/pages/admin/AdminBookingsPage';
import { AdminWorkspacesPage } from '@/src/pages/admin/AdminWorkspacesPage';
import { AdminPaymentsPage } from '@/src/pages/admin/AdminPaymentsPage';
import { AdminNotificationsPage } from '@/src/pages/admin/AdminNotificationsPage';
import { AdminSettingsPage } from '@/src/pages/admin/AdminSettingsPage';

export const Router: React.FC = () => {
  const { currentPath } = useNavigation();
  const { activeRole, isAuthenticated } = useAuth();
  const pathname = currentPath.split('?')[0];

  // 1. Dedicated Authentication Routes
  if (pathname === '/auth/login' || pathname === '/login') {
    return <LoginPage />;
  }
  if (pathname === '/auth/signup' || pathname === '/signup') {
    return <SignUpPage />;
  }
  if (pathname === '/auth/unauthorized' || pathname === '/403') {
    return <UnauthorizedPage />;
  }

  // 2. Admin Routes (Strictly Protected: 'admin' role required)
  if (pathname.startsWith('/admin')) {
    return (
      <ProtectedRoute allowedRoles={['admin']}>
        {(() => {
          if (pathname === '/admin/users') return <AdminUsersPage />;
          if (pathname === '/admin/mentors') return <AdminMentorsPage />;
          if (pathname === '/admin/segments') return <AdminSegmentsPage />;
          if (pathname === '/admin/bookings') return <AdminBookingsPage />;
          if (pathname === '/admin/workspaces') return <AdminWorkspacesPage />;
          if (pathname === '/admin/payments') return <AdminPaymentsPage />;
          if (pathname === '/admin/notifications') return <AdminNotificationsPage />;
          if (pathname === '/admin/settings') return <AdminSettingsPage />;
          return <AdminDashboardPage />;
        })()}
      </ProtectedRoute>
    );
  }

  // 3. Mentor Routes (Strictly Protected: 'mentor' or 'admin' role required)
  if (pathname.startsWith('/mentor')) {
    return (
      <ProtectedRoute allowedRoles={['mentor', 'admin']}>
        {(() => {
          if (pathname === '/mentor/availability') return <MentorAvailabilityPage />;
          if (pathname === '/mentor/bookings') return <MentorBookingsPage />;
          if (pathname === '/mentor/booking-detail') return <MentorBookingDetailPage />;
          if (pathname === '/mentor/workspace') return <MentorWorkspacePage />;
          if (pathname === '/mentor/gigs') return <MentorGigsPage />;
          if (pathname === '/mentor/segments') return <MentorSegmentsPage />;
          if (pathname === '/mentor/notifications') return <MentorNotificationsPage />;
          if (pathname === '/mentor/settings') return <MentorSettingsPage />;
          return <MentorHomePage />;
        })()}
      </ProtectedRoute>
    );
  }

  // 4. Seeker Routes
  // Some seeker views are public (discovery, mentor profiles)
  // Action-oriented views require authentication (bookings, payment, live session)
  if (pathname.startsWith('/seeker') || pathname === '/') {
    if (pathname === '/seeker/mentors') return <SeekerMentorListPage />;
    if (pathname === '/seeker/mentor-detail') return <SeekerMentorDetailPage />;

    if (pathname === '/seeker/payment' || pathname === '/seeker/checkout') {
      return (
        <ProtectedRoute requireAuth={true} allowedRoles={['seeker', 'admin', 'mentor']}>
          <SeekerPaymentPage />
        </ProtectedRoute>
      );
    }
    if (pathname === '/seeker/bookings') {
      return (
        <ProtectedRoute requireAuth={true} allowedRoles={['seeker', 'admin', 'mentor']}>
          <SeekerBookingsPage />
        </ProtectedRoute>
      );
    }
    if (pathname === '/seeker/booking-detail') {
      return (
        <ProtectedRoute requireAuth={true} allowedRoles={['seeker', 'admin', 'mentor']}>
          <SeekerBookingDetailPage />
        </ProtectedRoute>
      );
    }
    if (pathname === '/seeker/session') {
      return (
        <ProtectedRoute requireAuth={true} allowedRoles={['seeker', 'admin', 'mentor']}>
          <SeekerSessionPage />
        </ProtectedRoute>
      );
    }
    if (pathname === '/seeker/workspace') {
      return (
        <ProtectedRoute requireAuth={true} allowedRoles={['seeker', 'admin', 'mentor']}>
          <SeekerWorkspacePage />
        </ProtectedRoute>
      );
    }
    if (pathname === '/seeker/notifications') {
      return (
        <ProtectedRoute requireAuth={true} allowedRoles={['seeker', 'admin', 'mentor']}>
          <SeekerNotificationsPage />
        </ProtectedRoute>
      );
    }
    if (pathname === '/seeker/settings') {
      return (
        <ProtectedRoute requireAuth={true} allowedRoles={['seeker', 'admin', 'mentor']}>
          <SeekerSettingsPage />
        </ProtectedRoute>
      );
    }

    // Role-aware root redirect if user is authenticated and lands on root '/'
    if (pathname === '/' && isAuthenticated) {
      if (activeRole === 'admin') return <AdminDashboardPage />;
      if (activeRole === 'mentor') return <MentorHomePage />;
      return <SeekerHomePage />;
    }

    return <SeekerHomePage />;
  }

  return <SeekerHomePage />;
};
