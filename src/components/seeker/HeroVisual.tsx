import React from 'react';

export interface HeroVisualProps {
  className?: string;
}

/**
 * Decorative hero artwork.
 *
 * Renders the dedicated `public/assets/landing/seeker-hero.svg` asset as a
 * background layer so the real HTML/React content (headline, search, segment
 * controls, date controls) stays selectable, focusable and screen-reader
 * accessible. The asset's own composition keeps its weight at the left, right
 * and corner regions, leaving the centre calm for the headline.
 *
 * Purely decorative: the layer and the <img> are both aria-hidden.
 */
export const HeroVisual: React.FC<HeroVisualProps> = ({ className }) => (
  <div className={`absolute inset-0 -z-10 overflow-hidden ${className || ''}`} aria-hidden="true">
    <img
      src="/assets/landing/seeker-hero.svg"
      alt=""
      width={1440}
      height={560}
      loading="eager"
      decoding="async"
      aria-hidden="true"
      className="seeker-hero-drift h-full w-full object-cover object-center"
    />
    <div className="seeker-hero-scrim absolute inset-0" />
  </div>
);
