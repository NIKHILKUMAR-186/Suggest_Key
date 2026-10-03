import React from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Reveal } from '@/src/components/landing/Reveal';
import { MENTOR_STEPS, HERO_ARROW, ROUTE_MENTOR_SIGNUP } from '@/src/components/landing/landingContent';

export interface LandingMentorCtaProps {
  /** The app's own navigate(), so onboarding is reached through the router. */
  onNavigate: (href: string) => void;
}

/**
 * MENTOR CTA.
 *
 * The listed steps are the real onboarding sequence: apply, set sessions and
 * a price, publish availability, take bookings and write the session up. There
 * is no earnings figure, no "passive income" line and no guaranteed-income
 * claim anywhere here — none of that is something the product can promise.
 */
export const LandingMentorCta: React.FC<LandingMentorCtaProps> = ({ onNavigate }) => (
  <section
    id="for-mentors"
    className="scroll-mt-24 bg-[var(--sk-brand-canvas)] px-4 py-16 sm:px-6 sm:py-24 lg:px-8"
    aria-labelledby="for-mentors-heading"
  >
    <div className="mx-auto max-w-[1240px]">
      <Reveal className="overflow-hidden rounded-[32px] border border-[var(--sk-brand-border)] bg-[var(--sk-brand-surface)] shadow-[var(--sk-shadow-hero)]">
        <div className="grid grid-cols-1 gap-10 p-7 sm:p-10 lg:grid-cols-2 lg:gap-12 lg:p-12">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-shell-accent)]">
              For Mentors
            </p>
            <h2
              id="for-mentors-heading"
              className="mt-4 text-[28px] font-medium leading-[1.14] tracking-tight text-[var(--sk-brand-text)] sm:text-[36px]"
              style={{ fontFamily: 'var(--font-aeonikpro)' }}
            >
              Your experience could help someone move forward.
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-[var(--sk-brand-text-muted)]">
              Share what you've learned, help someone navigate an important decision, and build meaningful 1:1
              conversations.
            </p>

            <Button
              size="lg"
              className="mt-9 min-h-[52px] gap-2 rounded-xl px-7 text-[15px]"
              onClick={() => onNavigate(ROUTE_MENTOR_SIGNUP)}
            >
              Become a Mentor {HERO_ARROW}
            </Button>
          </div>

          <ol className="space-y-4 self-center">
            {MENTOR_STEPS.map((step, index) => (
              <li
                key={step}
                className="flex items-start gap-3.5 rounded-2xl border border-[var(--sk-brand-border)] bg-[var(--sk-brand-canvas)]/70 px-4 py-4"
              >
                <span
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-shell-accent-soft)] text-[var(--color-shell-accent)]"
                  aria-hidden="true"
                >
                  <Check className="h-3.5 w-3.5" />
                </span>
                <span className="text-[13.5px] leading-relaxed text-[var(--sk-brand-text)]">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </Reveal>
    </div>
  </section>
);