/**
 * Maps raw Supabase Auth errors to friendly, user-facing messages.
 * Never exposes internal technical details to end users.
 * Prevents account enumeration by returning the same generic message for
 * "user not found" and "invalid credentials" scenarios.
 */
export function mapAuthError(error: Error | null | undefined): string | null {
  if (!error) return null;

  const message = error.message || '';

  // Invalid login credentials / User not found - SAME MESSAGE to prevent enumeration
  if (
    message.includes('Invalid login credentials') ||
    message.includes('invalid login credentials') ||
    message.includes('Email or password is incorrect') ||
    message.includes('User not found') ||
    message.includes('user not found')
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