import React, { Suspense, lazy } from 'react';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { ProtectedRoute } from '@/src/components/auth/ProtectedRoute';

// --- Critical, above-the-fold entry points ---------------------------
// These stay in the initial chunk. The landing page IS the first paint for
// every anonymous visitor, and login/signup are the entry point for every
// returning user, so deferring them would trade a larger download for a worse
// first meaningful paint. Everything else is lazy.
import { LandingPage } from '@/src/pages/public/LandingPage';
import { NotFoundPage } from '@/src/pages/public/NotFoundPage';
import { LoginPage } from '@/src/pages/auth/LoginPage';
import { SignUpPage } from '@/src/pages/auth/SignUpPage';
import { AuthCallback } from '@/src/pages/auth/AuthCallback';

// --- Lazily loaded ---------------------------------------------------
// Every seeker, mentor, admin and support screen is behind an authenticated
// route guard, so no visitor needs any of it in the first paint. Splitting them
// keeps a visitor's landing-page load off the ~470 KB of admin screens alone.
const UnauthorizedPage = lazy(() => import('@/src/pages/auth/UnauthorizedPage').then((m) => ({ default: m.UnauthorizedPage })));
const ForgotPasswordPage = lazy(() => import('@/src/pages/auth/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('@/src/pages/auth/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })));
const VerifyPage = lazy(() => import('@/src/pages/auth/VerifyPage').then((m) => ({ default: m.VerifyPage })));

// Support Center (seeker + mentor share one page; admin gets the queue)
const SupportPage = lazy(() => import('@/src/components/support/SupportPage').then((m) => ({ default: m.SupportPage })));

// Seeker Pages
const SeekerHomePage = lazy(() => import('@/src/pages/seeker/SeekerHomePage').then((m) => ({ default: m.SeekerHomePage })));
const SeekerMentorListPage = lazy(() => import('@/src/pages/seeker/SeekerMentorListPage').then((m) => ({ default: m.SeekerMentorListPage })));
const MentorDirectoryPage = lazy(() => import('@/src/pages/seeker/MentorDirectoryPage').then((m) => ({ default: m.MentorDirectoryPage })));
const SeekerMentorDetailPage = lazy(() => import('@/src/pages/seeker/SeekerMentorDetailPage').then((m) => ({ default: m.SeekerMentorDetailPage })));
const SeekerMentorProfilePage = lazy(() => import('@/src/pages/seeker/SeekerMentorProfilePage').then((m) => ({ default: m.SeekerMentorProfilePage })));
const SeekerBookingsPage = lazy(() => import('@/src/pages/seeker/SeekerBookingsPage').then((m) => ({ default: m.SeekerBookingsPage })));
const SeekerBookingDetailPage = lazy(() => import('@/src/pages/seeker/SeekerBookingDetailPage').then((m) => ({ default: m.SeekerBookingDetailPage })));
const SeekerReschedulePage = lazy(() => import('@/src/pages/seeker/SeekerReschedulePage').then((m) => ({ default: m.SeekerReschedulePage })));
const SeekerPaymentPage = lazy(() => import('@/src/pages/seeker/SeekerPaymentPage').then((m) => ({ default: m.SeekerPaymentPage })));
const SeekerNotificationsPage = lazy(() => import('@/src/pages/seeker/SeekerNotificationsPage').then((m) => ({ default: m.SeekerNotificationsPage })));
const SeekerSettingsPage = lazy(() => import('@/src/pages/seeker/SeekerSettingsPage').then((m) => ({ default: m.SeekerSettingsPage })));
const SeekerSessionPage = lazy(() => import('@/src/pages/seeker/SeekerSessionPage').then((m) => ({ default: m.SeekerSessionPage })));
const SeekerWorkspacePage = lazy(() => import('@/src/pages/seeker/SeekerWorkspacePage').then((m) => ({ default: m.SeekerWorkspacePage })));

// Mentor Pages
const MentorSignupPage = lazy(() => import('@/src/pages/mentor/MentorSignupPage').then((m) => ({ default: m.MentorSignupPage })));
const MentorVerificationPage = lazy(() => import('@/src/pages/mentor/MentorVerificationPage').then((m) => ({ default: m.MentorVerificationPage })));
const MentorHomePage = lazy(() => import('@/src/pages/mentor/MentorHomePage').then((m) => ({ default: m.MentorHomePage })));
const MentorBookingsPage = lazy(() => import('@/src/pages/mentor/MentorBookingsPage').then((m) => ({ default: m.MentorBookingsPage })));
const MentorBookingDetailPage = lazy(() => import('@/src/pages/mentor/MentorBookingDetailPage').then((m) => ({ default: m.MentorBookingDetailPage })));
const MentorAvailabilityPage = lazy(() => import('@/src/pages/mentor/MentorAvailabilityPage').then((m) => ({ default: m.MentorAvailabilityPage })));
const MentorNotificationsPage = lazy(() => import('@/src/pages/mentor/MentorNotificationsPage').then((m) => ({ default: m.MentorNotificationsPage })));
const MentorSettingsPage = lazy(() => import('@/src/pages/mentor/MentorSettingsPage').then((m) => ({ default: m.MentorSettingsPage })));
const MentorGigsPage = lazy(() => import('@/src/pages/mentor/MentorGigsPage').then((m) => ({ default: m.MentorGigsPage })));
const MentorSegmentsPage = lazy(() => import('@/src/pages/mentor/MentorSegmentsPage').then((m) => ({ default: m.MentorSegmentsPage })));
const MentorWorkspacePage = lazy(() => import('@/src/pages/mentor/MentorWorkspacePage').then((m) => ({ default: m.MentorWorkspacePage })));

// Admin Pages
const AdminDashboardPage = lazy(() => import('@/src/pages/admin/AdminDashboardPage').then((m) => ({ default: m.AdminDashboardPage })));
const AdminUsersPage = lazy(() => import('@/src/pages/admin/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage })));
const AdminUserDetailPage = lazy(() => import('@/src/pages/admin/AdminUserDetailPage').then((m) => ({ default: m.AdminUserDetailPage })));
const AdminCreateUserPage = lazy(() => import('@/src/pages/admin/AdminCreateUserPage').then((m) => ({ default: m.AdminCreateUserPage })));
const AdminMentorsPage = lazy(() => import('@/src/pages/admin/AdminMentorsPage').then((m) => ({ default: m.AdminMentorsPage })));
const AdminMentorDetailPage = lazy(() => import('@/src/pages/admin/AdminMentorDetailPage').then((m) => ({ default: m.AdminMentorDetailPage })));
const AdminMentorVerificationPage = lazy(() => import('@/src/pages/admin/AdminMentorVerificationPage').then((m) => ({ default: m.AdminMentorVerificationPage })));
const AdminMentorVerificationDetailPage = lazy(() => import('@/src/pages/admin/AdminMentorVerificationDetailPage').then((m) => ({ default: m.AdminMentorVerificationDetailPage })));
const AdminSegmentsPage = lazy(() => import('@/src/pages/admin/AdminSegmentsPage').then((m) => ({ default: m.AdminSegmentsPage })));
const AdminCouponsPage = lazy(() => import('@/src/pages/admin/AdminCouponsPage').then((m) => ({ default: m.AdminCouponsPage })));
const AdminSegmentDetailPage = lazy(() => import('@/src/pages/admin/AdminSegmentDetailPage').then((m) => ({ default: m.AdminSegmentDetailPage })));
const AdminBookingsPage = lazy(() => import('@/src/pages/admin/AdminBookingsPage').then((m) => ({ default: m.AdminBookingsPage })));
const AdminWorkspacesPage = lazy(() => import('@/src/pages/admin/AdminWorkspacesPage').then((m) => ({ default: m.AdminWorkspacesPage })));
const AdminPaymentsPage = lazy(() => import('@/src/pages/admin/AdminPaymentsPage').then((m) => ({ default: m.AdminPaymentsPage })));
const AdminNotificationsPage = lazy(() => import('@/src/pages/admin/AdminNotificationsPage').then((m) => ({ default: m.AdminNotificationsPage })));
const AdminSystemHealthPage = lazy(() => import('@/src/pages/admin/AdminSystemHealthPage').then((m) => ({ default: m.AdminSystemHealthPage })));
const AdminSettingsPage = lazy(() => import('@/src/pages/admin/AdminSettingsPage').then((m) => ({ default: m.AdminSettingsPage })));
const AdminSupportPage = lazy(() => import('@/src/pages/admin/AdminSupportPage').then((m) => ({ default: m.AdminSupportPage })));

/**
 * One fallback for every deferred screen.
 *
 * Deliberately matches the session-resolving spinner in `AppShell` so a route
 * chunk arriving mid-navigation looks like the app is still settling, rather
 * than flashing a different loading treatment.
 */
const RouteFallback: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center bg-[#05060f]">
    <div className="text-center space-y-3">
      <div className="h-8 w-8 rounded-full border-2 border-[#663af3] border-t-transparent animate-spin mx-auto text-[var(--color-shell-text-subtle)]" />
      <p className="text-xs text-[#9da7ba]">Loading...</p>
    </div>
  </div>
);

const RouterRoutes: React.FC = () => {
  const { currentPath } = useNavigation();
  const { activeRole, isAuthenticated } = useAuth();
  const pathname = currentPath.split('?')[0];

  // 1. Public Landing Page (always accessible)
  if (pathname === '/') {
    return <LandingPage />;
  }

  // 2. Dedicated Authentication Routes (always accessible)
  if (pathname === '/auth/login' || pathname === '/login') {
    return <LoginPage />;
  }
  if (pathname === '/auth/signup' || pathname === '/signup') {
    return <SignUpPage />;
  }
  if (pathname === '/auth/forgot-password') {
    return <ForgotPasswordPage />;
  }
  if (pathname === '/auth/reset-password') {
    return <ResetPasswordPage />;
  }
  if (pathname === '/auth/verify') {
    return <VerifyPage />;
  }
  if (pathname === '/auth/callback') {
    return <AuthCallback />;
  }
  if (pathname === '/auth/unauthorized' || pathname === '/403') {
    return <UnauthorizedPage />;
  }

  // Mentor Signup (always accessible)
  if (pathname === '/mentor/signup') {
    return <MentorSignupPage />;
  }

  // Mentor Verification (accessible to mentors without auth in demo mode)
  if (pathname === '/mentor/verification') {
    return <MentorVerificationPage />;
  }

  // 3. Admin Routes (Strictly Protected: 'admin' role required)
if (pathname.startsWith('/admin')) {
    return (
      <ProtectedRoute allowedRoles={['admin']}>
        {(() => {
          if (pathname === '/admin/users') return <AdminUsersPage />;
          if (pathname === '/admin/users/create') return <AdminCreateUserPage />;
          if (pathname.startsWith('/admin/users/')) return <AdminUserDetailPage />;
          if (pathname === '/admin/mentor-verification') return <AdminMentorVerificationPage />;
          if (pathname.startsWith('/admin/mentor-verification/')) return <AdminMentorVerificationDetailPage />;
          if (pathname === '/admin/mentors') return <AdminMentorsPage />;
          if (pathname.startsWith('/admin/mentors/')) return <AdminMentorDetailPage />;
          if (pathname === '/admin/segments') return <AdminSegmentsPage />;
          // Exactly ONE path segment: the segment slug, e.g.
          // /admin/segments/relationship-advisior. A strict match keeps any
          // deeper path (such as the old, never-implemented /edit) from being
          // treated as a segment slug by the detail page.
          if (/^\/admin\/segments\/[^/]+$/.test(pathname)) return <AdminSegmentDetailPage />;
          if (pathname === '/admin/bookings') return <AdminBookingsPage />;
          if (pathname === '/admin/workspaces') return <AdminWorkspacesPage />;
          if (pathname === '/admin/payments') return <AdminPaymentsPage />;
          if (pathname === '/admin/coupons') return <AdminCouponsPage />;
          if (pathname === '/admin/notifications') return <AdminNotificationsPage />;
          if (pathname === '/admin/system-health' || pathname === '/admin/system-health/logs' || pathname.startsWith('/admin/system-health/logs/')) return <AdminSystemHealthPage />;
          if (pathname === '/admin/support') return <AdminSupportPage />;
          if (pathname === '/admin/settings') return <AdminSettingsPage />;
          return <AdminDashboardPage />;
        })()}
      </ProtectedRoute>
    );
  }

  // 4. Mentor Directory (seeker-facing "View All Mentors").
  //    Must be matched BEFORE the `/mentor` role block below, because
  //    '/mentors' is a prefix of '/mentor'.
  if (pathname === '/mentors' || pathname.startsWith('/mentors/')) {
    return (
      <ProtectedRoute allowedRoles={['seeker', 'admin']}>
        <MentorDirectoryPage />
      </ProtectedRoute>
    );
  }

  // 5. Mentor Routes (Strictly Protected: 'mentor' or 'admin' role required)
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
          if (pathname === '/mentor/support') return <SupportPage />;
          if (pathname === '/mentor') return <MentorHomePage />;
          // Any other path under /mentor/ is not a route. Returning the home page
          // here made a stale or mistyped link look like a successful
          // navigation to a real, populated screen, which is how the dead
          // `/seeker/reschedule` link survived. The 404 is rendered inside the
          // guard on purpose: an unknown mentor path must not confirm itself to
          // a signed-out or wrong-role visitor by behaving differently from a
          // real one.
          return <NotFoundPage />;
        })()}
      </ProtectedRoute>
    );
  }

  // 5. Seeker Routes (Strictly Protected: 'seeker' or 'admin' role required)
  if (pathname.startsWith('/seeker')) {
    return (
      <ProtectedRoute allowedRoles={['seeker', 'admin']}>
        {(() => {
          if (pathname === '/seeker/mentors') return <SeekerMentorListPage />;
          // Two pages, two jobs. `/seeker/mentor-profile` is the read-only
          // public profile (identity + every active session offer, each with its
          // own Book a slot). `/seeker/mentor-detail` is the booking experience:
          // date, slots, the 5-minute hold and the payment hand-off.
          if (pathname === '/seeker/mentor-profile') return <SeekerMentorProfilePage />;
          if (pathname === '/seeker/mentor-detail') return <SeekerMentorDetailPage />;

          if (pathname === '/seeker/payment' || pathname === '/seeker/checkout') {
            return <SeekerPaymentPage />;
          }
          if (pathname === '/seeker/bookings') return <SeekerBookingsPage />;
          if (pathname === '/seeker/booking-detail') return <SeekerBookingDetailPage />;
          if (pathname === '/seeker/reschedule') return <SeekerReschedulePage />;
          if (pathname === '/seeker/session') return <SeekerSessionPage />;
          if (pathname === '/seeker/workspace') return <SeekerWorkspacePage />;
          if (pathname === '/seeker/notifications') return <SeekerNotificationsPage />;
          if (pathname === '/seeker/settings') return <SeekerSettingsPage />;
          if (pathname === '/seeker/support') return <SupportPage />;
          return <SeekerHomePage />;
        })()}
      </ProtectedRoute>
    );
  }

  // Unknown route: render the global 404 instead of silently falling back to
  // the landing page, so a mistyped or outdated link never looks like success.
  return <NotFoundPage />;
};

/**
 * Route resolution is wrapped in a single Suspense boundary.
 *
 * The boundary sits here rather than per-route so that navigating between two
 * deferred screens does not tear down and rebuild a fallback, and so the
 * already-loaded landing/login pages keep rendering without interruption.
 */
export const Router: React.FC = () => (
  <Suspense fallback={<RouteFallback />}>
    <RouterRoutes />
  </Suspense>
);