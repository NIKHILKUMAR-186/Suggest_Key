import React from 'react';

/**
 * THE WORDMARK.
 *
 * These are the shipped brand assets, used as shipped: `public/logo.png` is the
 * 96px plum-and-gold square mark, `public/name.png` is the 431×72 wordmark.
 * Both are the same files the seeker header and seeker home already render, so
 * the landing page, the app and the tab icon are one brand rather than three
 * approximations of one.
 *
 * The wordmark is white artwork with a transparent background — measured, not
 * assumed — so it belongs on the plum field the header and footer already use.
 * There is no dark-background variant in the repository to choose between, and
 * no reason to invent one.
 *
 * Sizes are intrinsic (`width`/`height` on both images) so the lockup reserves
 * its box before the bytes arrive, and the wordmark is marked `fetchPriority`
 * when it is above the fold: it is the first thing on the page and it is in the
 * document head's critical path.
 *
 * The mark is decorative — the adjacent wordmark already names the company — so
 * it carries an empty `alt` rather than repeating itself to a screen reader.
 */

export interface LandingWordmarkProps {
  /** Height of the square mark in px. The wordmark scales proportionally. */
  size?: number;
  /** Above the fold: skip lazy loading and raise fetch priority. */
  priority?: boolean;
  className?: string;
}

/** name.png is 431×72, so the wordmark's height is what sets its width. */
const WORDMARK_RATIO = 431 / 72;

export const LandingWordmark: React.FC<LandingWordmarkProps> = ({
  size = 36,
  priority = false,
  className,
}) => {
  const nameHeight = Math.round(size * 0.72);

  return (
    <span
      className={`inline-flex items-center gap-2.5 leading-none ${className ?? ''}`}
      style={{ height: `${size}px` }}
    >
      <img
        src="/logo.png"
        alt=""
        width={96}
        height={96}
        className="shrink-0 rounded-[10px] object-cover"
        style={{ height: `${size}px`, width: `${size}px` }}
      />
      <img
        src="/name.png"
        alt="Suggest Key"
        width={431}
        height={72}
        className="shrink-0 object-contain"
        style={{
          height: `${nameHeight}px`,
          width: `${Math.round(nameHeight * WORDMARK_RATIO)}px`,
        }}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={priority ? 'high' : 'auto'}
      />
    </span>
  );
};