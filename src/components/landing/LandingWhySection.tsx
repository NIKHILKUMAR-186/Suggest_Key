import React from 'react';
import { Reveal } from '@/src/components/landing/Reveal';
import { WHY_BENEFITS } from '@/src/components/landing/landingContent';

/**
 * WHY SUGGEST KEY.
 *
 * A two-column editorial spread rather than a card grid: the claim sits large
 * on one side and the four mechanics stack as a quiet list on the other, which
 * keeps the page from turning into a wall of identical boxes.
 *
 * Every benefit describes something the product actually does. There is no
 * outcome guarantee, no "changed my life" claim and no invented statistic.
 */
export const LandingWhySection: React.FC = () => (
  <section
    id="why-suggest-key"
    className="scroll-mt-24 border-y border-[var(--sk-brand-border)] bg-[var(--sk-brand-surface)] px-4 py-16 sm:px-6 sm:py-24 lg:px-8"
    aria-labelledby="why-heading"
  >
    <div className="mx-auto grid max-w-[1240px] grid-cols-1 gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:gap-14">
      <Reveal>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-shell-accent)]">
          Why Suggest Key
        </p>
        <h2
          id="why-heading"
          className="mt-4 text-[28px] font-medium leading-[1.12] tracking-tight text-[var(--sk-brand-text)] sm:text-[38px]"
          style={{ fontFamily: 'var(--font-aeonikpro)' }}
        >
          More than advice. A conversation designed around you.
        </h2>
        <p className="mt-5 max-w-md text-[15px] leading-relaxed text-[var(--sk-brand-text-muted)]">
          Real people. Real experience. Real conversations that help you move forward.
        </p>
      </Reveal>

      <ul className="grid grid-cols-1 gap-x-8 gap-y-7 sm:grid-cols-2">
        {WHY_BENEFITS.map((benefit, index) => {
          const Icon = benefit.icon;

          return (
            <Reveal as="li" key={benefit.title} delay={index * 0.06} className="group border-t border-[var(--sk-brand-border)] pt-5 transition-colors duration-200 hover:bg-[var(--sk-brand-canvas)]/60 -mx-3 px-3 rounded-xl">
              <Icon className="h-5 w-5 text-[var(--color-shell-accent)] transition-transform duration-200 group-hover:scale-110" aria-hidden="true" />
              <h3 className="mt-3.5 text-[15px] font-semibold leading-snug tracking-tight text-[var(--sk-brand-text)]">
                {benefit.title}
              </h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--sk-brand-text-muted)]">
                {benefit.description}
              </p>
            </Reveal>
          );
        })}
      </ul>
    </div>
  </section>
);