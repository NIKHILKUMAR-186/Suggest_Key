/**
 * Maps raw Supabase Auth errors to friendly, user-facing messages.
 * Never exposes internal technical details to end users.
 */
export function mapAuthError(error: Error | null | undefined): string | null {
  if (!error) return null;

  const message = error.message || '';

  // Invalid login credentials
  if (
    message.includes('Invalid login credentials') ||
    message.includes('invalid login credentials') ||
    message.includes('Email or password is incorrect')
  ) {
    return 'Email or password is incorrect.';
  }

  // Email not confirmed
  if (
    message.includes('Email not confirmed') ||
    message.includes('email not confirmed') ||
    message.includes('confirm your email')
  ) {
    return 'Please confirm your email before signing in.';
  }

  // User not found
  if (message.includes('User not found') || message.includes('user not found')) {
    return 'No account found with that email address.';
  }

  // Too many requests / rate limit
  if (
    message.includes('Too many requests') ||
    message.includes('rate limit') ||
    message.includes('too many')
  ) {
    return 'Too many attempts. Please wait a moment and try again.';
  }

  // Network errors
  if (
    message.includes('Failed to fetch') ||
    message.includes('NetworkError') ||
    message.includes('network error') ||
    message.includes('fetch failed')
  ) {
    return 'Network error. Please check your connection and try again.';
  }

  // Weak password
  if (message.includes('password') && message.includes('weak')) {
    return 'Password is too weak. Please choose a stronger password.';
  }

  // Generic fallback
  return 'Something went wrong. Please try again.';
}

export default mapAuthError;