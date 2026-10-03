import React from 'react';
import { Reveal } from '@/src/components/landing/Reveal';
import { TRUST_BODY, TRUST_EYEBROW, TRUST_ITEMS, TRUST_TITLE } from '@/src/components/landing/landingContent';

/**
 * VERIFICATION.
 *
 * This section describes the mechanism, not a promise. The model is
 * `mentor_applications` plus `mentor_verification_documents`, two configured
 * document types — a government-issued photo ID and a qualification certificate
 * — an admin review queue, and a directory that only returns approved, active
 * profiles. Everything below is that, stated plainly.
 *
 * Nothing here claims a certification, an accreditation or an outcome the
 * platform cannot evidence, and there is no trust badge wall: a row of invented
 * logos or counts would undo the honesty of the paragraph next to it.
 *
 * The layout is the one asymmetric editorial split on the page — statement on the
 * left rail, ruled list on the right — which also keeps this section from reading
 * as a fourth card grid.
 *
 * It is the one band on a wash. Everything above it is either flat paper or a
 * dark field, so the soft gradient is what makes the mechanism read as a
 * considered part of the page rather than as a footnote.
 */

export const LandingTrustSection: React.FC = () => (
  <section
    id="verification"
    className="sk-lp-section sk-lp-section--wash"
    aria-labelledby="verification-title"
  >
    <div className="sk-lp-wrap">
      <div className="sk-lp-trust">
        <div>
          <Reveal y={10}>
            <p className="sk-lp-eyebrow">{TRUST_EYEBROW}</p>
          </Reveal>
          <Reveal delay={0.05}>
            <h2
              id="verification-title"
              className="sk-lp-display sk-lp-display--md mt-5 max-w-[16ch]"
            >
              {TRUST_TITLE}
            </h2>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="sk-lp-body mt-6 max-w-[44ch]">{TRUST_BODY}</p>
          </Reveal>
        </div>

        <ol className="sk-lp-trust__list">
          {TRUST_ITEMS.map((item, index) => (
            <Reveal
              as="li"
              key={item.title}
              delay={index * 0.07}
              className="sk-lp-trust__item"
              y={18}
            >
              <span className="sk-lp-numeral" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="block">
                <h3 className="sk-lp-trust__title">{item.title}</h3>
                <p className="sk-lp-trust__text">{item.description}</p>
              </span>
            </Reveal>
          ))}
        </ol>
      </div>
    </div>
  </section>
);