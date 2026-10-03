import { ArrowRight } from 'lucide-react';
import React from 'react';
import { LineReveal, Reveal } from '@/src/components/landing/Reveal';
import { CONNECTION_IMAGE } from '@/src/components/landing/landingImages';
import {
  CONNECTION_BODY,
  CONNECTION_CTA_LABEL,
  CONNECTION_EYEBROW,
  CONNECTION_QUOTE_LINES,
} from '@/src/components/landing/landingContent';

/**
 * HUMAN CONNECTION.
 *
 * The one spread on the page that is purely an argument rather than a product
 * surface: a photograph on one side, three lines of type on the other. It comes
 * after the mentors, so by the time a visitor reads it they have already seen
 * real faces and the sentence is reinforcement rather than a claim made on
 * trust.
 *
 * It is deliberately the plainest band on the page — no wash, no field, just
 * paper and one photograph. The lavender wash is reserved for the section after
 * it, so that ending on a gradient and starting on a gradient would have made
 * the middle of the page feel like one long block instead of a sequence of
 * decisions.
 *
 * The copy makes no promise about outcomes. It describes the shape of the
 * session — one person, one hour, one question — which is the only thing the
 * platform actually controls.
 */

export interface LandingConnectionSectionProps {
  onFindMentor: () => void;
}

export const LandingConnectionSection: React.FC<LandingConnectionSectionProps> = ({
  onFindMentor,
}) => (
  <section id="conversation" className="sk-lp-section" aria-labelledby="conversation-title">
    <div className="sk-lp-wrap">
      <div className="sk-lp-connection">
        <Reveal className="sk-lp-connection__media">
          <img
            src={CONNECTION_IMAGE.src}
            alt={CONNECTION_IMAGE.alt}
            width={CONNECTION_IMAGE.width}
            height={CONNECTION_IMAGE.height}
            loading="lazy"
            decoding="async"
          />
        </Reveal>

        <div>
          <Reveal y={10}>
            <p className="sk-lp-eyebrow">{CONNECTION_EYEBROW}</p>
          </Reveal>

          <h2 id="conversation-title" className="sk-lp-display sk-lp-display--md mt-5">
            <LineReveal lines={CONNECTION_QUOTE_LINES} delay={0.08} />
          </h2>

          <Reveal delay={0.3}>
            <p className="sk-lp-body mt-7 max-w-[48ch]">{CONNECTION_BODY}</p>
          </Reveal>

          <Reveal delay={0.4}>
            <button
              type="button"
              className="sk-lp-link mt-8 text-[color:var(--sk-lp-ink)]"
              onClick={onFindMentor}
            >
              {CONNECTION_CTA_LABEL}
              <ArrowRight className="h-4 w-4 sk-lp-link__arrow" aria-hidden="true" />
            </button>
          </Reveal>
        </div>
      </div>
    </div>
  </section>
);