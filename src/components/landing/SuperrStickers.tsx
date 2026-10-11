/**
 * SUPERR STICKER ILLUSTRATIONS.
 *
 * Flat, illustrated characters treated as physical peel-and-stick objects:
 * vivid fills, 2px dark outlines, no drop shadows of their own, placed at
 * random rotations of 5-15 degrees.
 *
 * Every one of them is DECORATIVE PUNCTUATION. They are never system icons,
 * never interactive, and never carry meaning alone — so each renders
 * `aria-hidden` and takes no pointer events. The blue / pink / green fills are
 * the sticker palette and must never be promoted to a functional UI colour.
 *
 * These are original vector drawings made for Suggest Key in the reference
 * aesthetic; no third-party artwork is copied.
 */

import React from 'react';

interface StickerProps {
  className?: string;
}

const OUTLINE = '#171717';

/** Lightning bolt — Sky Sticker blue. */
export function StickerBolt({ className }: StickerProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false" className={className}>
      <path
        d="M18.5 2.5 6.8 17.4h6.2L12 29.5l13.2-16.1h-7.1L18.5 2.5Z"
        fill="var(--sky)"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M15.4 20.6h4.4" stroke={OUTLINE} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Four-point sparkle — Marker Orange. */
export function StickerSparkle({ className }: StickerProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false" className={className}>
      <path
        d="M13.6 2.6C14.5 8.3 17.2 11 23 11.9 17.2 12.8 14.5 15.5 13.6 21.2 12.7 15.5 10 12.8 4.2 11.9 10 11 12.7 8.3 13.6 2.6Z"
        fill="var(--orange)"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M25 18.5c.5 3 1.7 4.2 4.7 4.7-3 .5-4.2 1.7-4.7 4.7-.5-3-1.7-4.2-4.7-4.7 3-.5 4.2-1.7 4.7-4.7Z" fill="var(--orange)" stroke={OUTLINE} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

/** Heart with eyes — Bubblegum pink. */
export function StickerHeart({ className }: StickerProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false" className={className}>
      <path
        d="M16 28.2C7.6 22.4 3 17.9 3 12.6A7.1 7.1 0 0 1 16 8.6 7.1 7.1 0 0 1 29 12.6c0 5.3-4.6 9.8-13 15.6Z"
        fill="var(--bubblegum)"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="11.6" cy="13.4" r="1.15" fill={OUTLINE} />
      <circle cx="20.4" cy="13.4" r="1.15" fill={OUTLINE} />
      <path d="M12.6 17.4c1.9 1.6 4.9 1.6 6.8 0" stroke={OUTLINE} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Small sprout — Sprout green, for tags and dividers. */
export function StickerSprout({ className }: StickerProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false" className={className}>
      <path d="M16 28V14.5" stroke={OUTLINE} strokeWidth="2" strokeLinecap="round" />
      <path d="M16 15.5C11 15.5 7.5 12.5 7 7.5c5.5 0 9 3 9 8Z" fill="var(--sprout)" stroke={OUTLINE} strokeWidth="2" strokeLinejoin="round" />
      <path d="M16 15.5c5 0 8.5-3 9-8-5.5 0-9 3-9 8Z" fill="var(--sprout)" stroke={OUTLINE} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Hand-drawn curved arrow.
 *
 * Thin 1.5px stroke, hand-drawn wobble, no arrowhead fill. It originates at a
 * Handwritten Caption and terminates at the labelled object with a slight
 * curl. Inherits `currentColor` so a caption colour drives the stroke.
 */
export function HandArrow({ className }: StickerProps) {
  return (
    <svg viewBox="0 0 72 56" fill="none" aria-hidden="true" focusable="false" className={className}>
      <path
        d="M4 7C16 3.4 30 5.6 38 15.6 45.4 24.8 47.6 34.6 53.4 41.4 56.2 44.6 59.4 45.8 62.6 44.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M55.6 37.2c1.2 4.2 4.6 6.6 8.8 6.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The hero's standby object: a notebook with a name label and a coloured
 * pencil, in the same flat sticker vocabulary. Shown only until a real mentor
 * portrait is available, so the composition never collapses to a grey box.
 */
export const NotebookScene = React.forwardRef<SVGSVGElement, StickerProps>(({ className }, ref) => (
  <svg ref={ref} viewBox="0 0 400 500" fill="none" aria-hidden="true" focusable="false" className={className} preserveAspectRatio="xMidYMid slice">
    <rect width="400" height="500" fill="var(--dew)" />
    {/* Notebook, tilted like a real object on a desk */}
    <g transform="rotate(-4 200 250)">
      <rect x="72" y="96" width="256" height="324" rx="16" fill="var(--paper)" stroke={OUTLINE} strokeWidth="2.5" />
      <rect x="72" y="96" width="26" height="324" rx="13" fill="var(--dew)" stroke={OUTLINE} strokeWidth="2.5" />
      <rect x="72" y="150" width="256" height="16" fill="var(--orange)" stroke={OUTLINE} strokeWidth="2" />
      <rect x="72" y="352" width="256" height="16" fill="var(--orange)" stroke={OUTLINE} strokeWidth="2" />
      {/* Name label sticker on the cover */}
      <g transform="rotate(2.5 214 268)">
        <rect x="128" y="212" width="172" height="112" rx="8" fill="#ffffff" stroke={OUTLINE} strokeWidth="1.5" />
        <path d="M144 248h140M144 272h140M144 296h92" stroke="var(--mist)" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="5 6" />
        <path d="M144 234h56" stroke={OUTLINE} strokeWidth="2" strokeLinecap="round" />
      </g>
    </g>
    {/* Coloured pencil tucked alongside */}
    <g transform="rotate(14 330 400)">
      <rect x="300" y="330" width="26" height="140" rx="5" fill="var(--sky)" stroke={OUTLINE} strokeWidth="2" />
      <path d="M300 400h26l-13 22-13-22Z" fill="var(--paper)" stroke={OUTLINE} strokeWidth="2" />
      <path d="M307 416h12l-6 10-6-10Z" fill={OUTLINE} />
    </g>
    {/* Two sticker marks, placed by hand rather than on a grid */}
    <g transform="translate(58 60) rotate(-12)">
      <path d="M13.6 2.6C14.5 8.3 17.2 11 23 11.9 17.2 12.8 14.5 15.5 13.6 21.2 12.7 15.5 10 12.8 4.2 11.9 10 11 12.7 8.3 13.6 2.6Z" fill="var(--orange)" stroke={OUTLINE} strokeWidth="2" strokeLinejoin="round" />
    </g>
    <g transform="translate(300 92) rotate(11)">
      <path d="M12 30.2C4 23.6 0 18.7 0 13.2A7.6 7.6 0 0 1 12 8.4 7.6 7.6 0 0 1 24 13.2C24 18.7 20 23.6 12 30.2Z" fill="var(--bubblegum)" stroke={OUTLINE} strokeWidth="2" strokeLinejoin="round" />
    </g>
  </svg>
));

NotebookScene.displayName = 'NotebookScene';

export default StickerBolt;
