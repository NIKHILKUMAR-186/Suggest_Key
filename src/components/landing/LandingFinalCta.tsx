import React from 'react';
import { Button } from '@/src/components/ui/Button';
import { Enter } from '@/src/components/landing/Reveal';
import { ROUTE_MENTOR_SIGNUP, HERO_ARROW } from '@/src/components/landing/landingContent';

export interface LandingFinalCtaProps {
  findMentorPath: string;
  onNavigate: (href: string) => void;
}

/**
 * FINAL CTA.
 *
 * Closes on the same plum field as the hero, so the page reads as one long
 * piece of art direction with a light editorial middle rather than a stack of
 * unrelated bands.
 */
export const LandingFinalCta: React.FC<LandingFinalCtaProps> = ({ findMentorPath, onNavigate }) => (
  <section className="relative isolate overflow-hidden bg-[var(--sk-brand-plum)] px-4 py-20 sm:px-6 sm:py-28 lg:px-8" aria-labelledby="final-cta-heading">
    <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
      <div className="landing-grid absolute inset-0 opacity-50" />
      <div
        className="absolute left-1/2 top-1/2 h-[640px] w-[960px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'radial-gradient(ellipse, rgba(102,58,243,0.48), transparent 66%)', filter: 'blur(40px)' }}
      />
      <div
        className="absolute left-1/2 top-1/2 h-[360px] w-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'radial-gradient(ellipse, rgba(247,210,67,0.18), transparent 68%)', filter: 'blur(40px)' }}
      />
    </div>

    <div className="mx-auto max-w-3xl text-center">
      <Enter>
        <h2
          id="final-cta-heading"
          className="text-[28px] font-medium leading-[1.12] tracking-tight text-[var(--sk-brand-header-text)] sm:text-[42px]"
          style={{ fontFamily: 'var(--font-aeonikpro)' }}
        >
          You don't have to figure everything out alone.
        </h2>
      </Enter>

      <Enter delay={0.08}>
        <p className="mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-[var(--sk-brand-header-muted)] sm:text-base">
          Find a mentor, have a conversation, and move forward with clarity.
        </p>
      </Enter>

      <Enter delay={0.14}>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button
            size="lg"
            onClick={() => onNavigate(findMentorPath)}
            className="min-h-[52px] gap-2 rounded-xl bg-[var(--sk-brand-gold)] px-7 text-[15px] font-semibold text-[var(--sk-brand-on-gold)] hover:bg-[var(--sk-brand-gold-deep)] hover:shadow-[0_14px_34px_-14px_rgba(247,210,67,0.7)]"
          >
            Find a Mentor {HERO_ARROW}
          </Button>
          <Button
            size="lg"
            onClick={() => onNavigate(ROUTE_MENTOR_SIGNUP)}
            className="min-h-[52px] rounded-xl border border-white/20 bg-white/[0.06] px-7 text-[15px] text-[var(--sk-brand-header-text)] hover:bg-white/[0.12]"
          >
            Become a Mentor
          </Button>
        </div>
      </Enter>
    </div>
  </section>
);