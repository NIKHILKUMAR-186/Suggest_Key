import React from 'react';
import { Reveal } from '@/src/components/landing/Reveal';
import { JOURNEY_STEPS } from '@/src/components/landing/landingContent';

/**
 * HOW SUGGEST KEY WORKS.
 *
 * Editorial rather than diagrammatic: a numbered left rail reads as an
 * editorial sequence rather than a software pipeline, and the hairline that
 * joins the numbers is the only connective device — no boxes, no arrows, no
 * per-step illustrations competing with the copy.
 */
export const LandingHowItWorks: React.FC = () => (
  <section
    id="how-it-works"
    className="scroll-mt-24 bg-[var(--sk-brand-canvas)] px-4 py-20 sm:px-6 sm:py-28 lg:px-8"
    aria-labelledby="how-it-works-heading"
  >
    <div className="mx-auto max-w-[1240px]">
      <Reveal className="max-w-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-shell-accent)]">
          How Suggest Key works
        </p>
        <h2
          id="how-it-works-heading"
          className="mt-4 text-[30px] font-medium leading-[1.12] tracking-tight text-[var(--sk-brand-text)] sm:text-[40px]"
          style={{ fontFamily: 'var(--font-aeonikpro)' }}
        >
          A simple journey from a question to a conversation that helps you move forward.
        </h2>
      </Reveal>

      <ol className="mt-14 grid grid-cols-1 gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        {JOURNEY_STEPS.map((step, index) => {
          const Icon = step.icon;
          const isLast = index === JOURNEY_STEPS.length - 1;

          return (
            <Reveal
              as="li"
              key={step.num}
              delay={index * 0.07}
              className="relative flex gap-5 lg:flex-col lg:gap-6"
            >
              {/* Rail: the number, a hairline to the next step, and the icon. */}
              <div className="flex shrink-0 flex-col items-center lg:flex-row lg:items-center lg:gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[var(--sk-brand-border)] bg-[var(--sk-brand-surface)] text-[13px] font-bold text-[var(--sk-brand-text)] shadow-[var(--sk-shadow-card)]">
                  {step.num}
                </span>
                {!isLast ? (
                  <span
                    className="hidden w-full flex-1 bg-[var(--sk-brand-border)] lg:block lg:h-px lg:w-full"
                    aria-hidden="true"
                  />
                ) : null}
              </div>

              <div className="lg:flex-1">
                <Icon className="h-5 w-5 text-[var(--color-shell-accent)]" aria-hidden="true" />
                <h3 className="mt-3 text-lg font-semibold leading-snug tracking-tight text-[var(--sk-brand-text)] lg:mt-4">
                  {step.title}
                </h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--sk-brand-text-muted)]">
                  {step.description}
                </p>
              </div>
            </Reveal>
          );
        })}
      </ol>
    </div>
  </section>
);