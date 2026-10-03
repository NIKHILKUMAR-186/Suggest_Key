import React from 'react';

/**
 * THE WORDMARK.
 *
 * The repository ships no brand logo file — the two image paths the previous
 * header referenced have never existed in `public/`, so the mark was a 404 on
 * every load. Rather than re-point the page at another missing asset, the mark
 * is drawn here: a ring, a stem and one tooth, in the brand gold, next to the
 * name set in the project's display face.
 *
 * As SVG it is resolution-independent, it inherits `currentColor` so it stays
 * legible on plum and on paper without a second file, and it costs nothing on
 * the critical path. The name is real text, not an image, so it is selectable,
 * translatable and announced correctly; the mark itself is decorative.
 */

export interface LandingWordmarkProps {
  /** Font size of the name in px. The mark scales with it. */
  size?: number;
  className?: string;
}

export const LandingWordmark: React.FC<LandingWordmarkProps> = ({ size = 15, className }) => (
  <span
    className={`inline-flex items-center gap-2 leading-none ${className ?? ''}`}
    style={{ fontSize: `${size}px` }}
  >
    <svg
      viewBox="0 0 24 24"
      width={Math.round(size * 1.5)}
      height={Math.round(size * 1.5)}
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ color: 'var(--sk-lp-gold)', flexShrink: 0 }}
    >
      <circle cx="8.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12.2 12.2 20 20"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M16.4 16.4 19 13.8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
    <span
      className="font-[family-name:var(--font-aeonikpro)] font-medium tracking-[-0.02em] whitespace-nowrap"
    >
      Suggest Key
    </span>
  </span>
);