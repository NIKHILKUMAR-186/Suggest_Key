import React from 'react';
import { Reveal } from '@/src/components/landing/Reveal';

/**
 * EDITORIAL SECTION HEADER.
 *
 * The reference composition puts a small heading and one supporting line at the
 * top of a generous field, and relies on scale and whitespace — not on a boxed
 * title bar — to separate sections. This keeps that: the label and the heading
 * occupy the left rail, the supporting line sits in the right rail aligned to
 * the baseline, and the two collapse into one column on narrow screens.
 *
 * `titleAs="h2"` is the default and correct for every section except one that
 * begins the page. The heading id is derived from `id` so each section can point
 * `aria-labelledby` at its own heading without inventing a second id.
 */
export interface LandingSectionHeadProps {
  id: string;
  eyebrow: string;
  title: string;
  body?: string;
  titleAs?: 'h2' | 'h3';
  size?: 'lg' | 'md';
  /** Rendered to the right of the heading, on the same baseline. */
  aside?: React.ReactNode;
}

export const LandingSectionHead: React.FC<LandingSectionHeadProps> = ({
  id,
  eyebrow,
  title,
  body,
  titleAs = 'h2',
  size = 'lg',
  aside,
}) => {
  const Title = titleAs;
  const headingId = `${id}-title`;

  return (
    <div className="sk-lp-head">
      <div>
        <Reveal y={10}>
          <p className="sk-lp-eyebrow">{eyebrow}</p>
        </Reveal>
        <Reveal delay={0.05}>
          <Title
            id={headingId}
            className={`sk-lp-display mt-5 ${size === 'md' ? 'sk-lp-display--sm' : ''}`}
          >
            {title}
          </Title>
        </Reveal>
      </div>

      {(body || aside) && (
        <Reveal delay={0.1} className="sk-lp-head__aside">
          {body && <p className="sk-lp-lead">{body}</p>}
          {aside}
        </Reveal>
      )}
    </div>
  );
};