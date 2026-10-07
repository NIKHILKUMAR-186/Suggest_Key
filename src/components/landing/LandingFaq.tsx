import { motion, useReducedMotion } from 'motion/react';
import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { LandingSectionHead } from '@/src/components/landing/LandingSectionHead';
import { FAQ_ITEMS, FAQ_TITLE } from '@/src/components/landing/landingContent';

/**
 * FAQ — Good to know.
 *
 * A clean accordion on a paper band. Each row is a white background with a
 * subtle bottom border, a question, and a circular yellow plus button that
 * rotates to a cross when open. The answer slides open with a smooth
 * max-height transition.
 *
 * Data comes from landingContent.ts. No fake policies, no hardcoded answers
 * that the product cannot support.
 */

export interface LandingFaqProps {
  className?: string;
}

export const LandingFaq: React.FC<LandingFaqProps> = ({ className }) => {
  const canAnimate = useReducedMotion() !== true;
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = (index: number) => {
    setOpenIndex((prev) => (prev === index ? null : index));
  };

  return (
    <section id="faq" className={`sk-lg-band sk-lg-band--paper ${className ?? ''}`} aria-labelledby="faq-title">
      <span className="sk-lg-margin" aria-hidden="true" />

      <div className="sk-lg__wrap">
        <LandingSectionHead id="faq-title" title={FAQ_TITLE} />

        <div className="sk-lg-faq" role="list">
          {FAQ_ITEMS.map((item, index) => {
            const isOpen = openIndex === index;
            return (
              <div key={index} className="sk-lg-faq__item" data-open={isOpen ? 'true' : undefined} role="listitem">
                <button
                  type="button"
                  className="sk-lg-faq__question"
                  onClick={() => toggle(index)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-answer-${index}`}
                >
                  <span>{item.question}</span>
                  <span className="sk-lg-faq__toggle" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M7 2v10M2 7h10" />
                    </svg>
                  </span>
                </button>
                <div id={`faq-answer-${index}`} className="sk-lg-faq__answer" role="region" aria-hidden={!isOpen}>
                  <div className="sk-lg-faq__answer-inner">{item.answer}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default LandingFaq;
