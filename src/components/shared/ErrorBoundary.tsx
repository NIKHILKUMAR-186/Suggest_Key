/**
 * Error containment for the React tree.
 *
 * The app previously had NO error boundary at all: any component that threw
 * during render unmounted the entire React root and left a blank page with the
 * error only in the console. That is what turned a provider wiring mistake into
 * an unrecoverable white screen.
 *
 * Scope, deliberately narrow:
 *
 *  - It catches unexpected RENDER errors. It does not catch, and must never be
 *    used to hide, API failures: a 429 is a normal, recoverable API result that
 *    travels through the API client's error path (see `apiClient` /
 *    `rateLimitManager`) and renders as the rate-limit banner plus a per-surface
 *    message. Nothing here turns a 429 into a render error.
 *  - It does NOT catch the missing-context bug it was added alongside. The
 *    boundary is mounted around the route tree and at the root, so a provider
 *    ordering defect still surfaces as a visible error state with diagnostics -
 *    it is contained, not concealed.
 *  - It logs a sanitized message (never the raw stack, never request bodies)
 *    and keeps a copy on `window` for System Health / support triage.
 */
import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { captureClientError } from '@/src/lib/apiClient';
import { logSanitizer } from '@/src/lib/logSanitizer';

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  /**
   * What this boundary guards. Rendered in the fallback so a future reader can
   * tell which tree failed without opening the console.
   */
  scope?: string;
  /**
   * Rendered instead of the default card. Recovery actions must stay under the
   * boundary: remounting a subtree that threw on its own data would throw again.
   */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  /** Bumped on every reset so the child tree is remounted from scratch. */
  generation: number;
}

declare global {
  interface Window {
    __lastRenderError?: { scope?: string; message: string; at: string };
  }
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, generation: 0 };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Sanitized copy for the console and System Health. The raw stack is kept
    // out of the persisted record because it can embed URLs and request data.
    captureClientError(error, { boundaryScope: this.props.scope ?? 'unknown' });
    const safe = logSanitizer.safeMessage(error);
    console.error(
      `[ErrorBoundary:${this.props.scope ?? 'unknown'}] render failed:`,
      safe,
      info.componentStack ?? '',
    );
    if (typeof window !== 'undefined') {
      window.__lastRenderError = {
        scope: this.props.scope,
        message: safe,
        at: new Date().toISOString(),
      };
    }
  }

  private reset = (): void => {
    // Local reset only. It does NOT reload the page, because a full reload would
    // discard every unsaved form value for a problem that is usually confined
    // to this subtree.
    this.setState((prev) => ({ error: null, generation: prev.generation + 1 }));
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    return (
      <div
        role="alert"
        className="flex min-h-screen w-full items-center justify-center bg-[var(--color-shell-bg)] px-4 py-10"
      >
        <div className="w-full max-w-lg rounded-2xl border border-[var(--color-shell-error)]/30 bg-[var(--color-shell-error-soft)] p-6 sm:p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--color-shell-error)]/30 bg-[var(--color-shell-error-soft)] text-[var(--color-shell-error)]">
            <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-base sm:text-lg font-bold tracking-tight text-[var(--color-shell-text)]">
            This screen could not be displayed
          </h1>
          <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-[var(--color-shell-text-muted)] max-w-md mx-auto">
            {this.props.scope
              ? `The ${this.props.scope} area hit an unexpected error. Nothing was submitted - your form entries are still here.`
              : 'An unexpected error occurred. Nothing was submitted.'}
          </p>
          <button
            type="button"
            onClick={this.reset}
            className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--color-shell-error)]/40 bg-[var(--color-shell-surface)] px-4 py-2 text-sm font-medium text-[var(--color-shell-error)] transition-colors hover:bg-[var(--color-shell-error-soft)]"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Try again</span>
          </button>
        </div>
      </div>
    );
  }
}

/**
 * Compact inline fallback for the route tree: keeps the shell, navigation and
 * sidebar usable so the user can move somewhere else instead of being stranded
 * on a blank page. Deliberately different copy from the root boundary so the two
 * levels are distinguishable in a screenshot.
 */
export const RouteErrorFallback: React.FC<{
  error: Error;
  reset: () => void;
}> = ({ reset }) => (
  <div
    role="alert"
    className="mx-auto w-full max-w-xl rounded-2xl border border-[var(--color-shell-error)]/30 bg-[var(--color-shell-error-soft)] p-6 sm:p-8 text-center"
  >
    <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--color-shell-error)]/30 bg-[var(--color-shell-error-soft)] text-[var(--color-shell-error)]">
      <AlertTriangle className="h-5 w-5" aria-hidden="true" />
    </div>
    <h2 className="text-sm sm:text-base font-bold tracking-tight text-[var(--color-shell-text)]">
      This page could not be displayed
    </h2>
    <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-[var(--color-shell-text-muted)]">
      Something unexpected went wrong while rendering this page. Use the navigation
      to move somewhere else, or try again here.
    </p>
    <button
      type="button"
      onClick={reset}
      className="mt-4 inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[var(--color-shell-error)]/40 bg-[var(--color-shell-surface)] px-3.5 py-2 text-xs font-medium text-[var(--color-shell-error)] transition-colors hover:bg-[var(--color-shell-error-soft)]"
    >
      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
      <span>Try again</span>
    </button>
  </div>
);
