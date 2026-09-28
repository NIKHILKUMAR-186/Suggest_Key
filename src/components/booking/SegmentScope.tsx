import React from 'react';
import { cn } from '@/src/lib/utils';

export interface SegmentScopeProps {
  /** The active segment's slug, e.g. "career-mentor". Null/unknown = brand theme. */
  slug?: string | null;
  className?: string;
  children: React.ReactNode;
}

/**
 * Applies the active segment's visual identity to a subtree.
 *
 * The segment palettes already exist as `[data-segment="…"]` rules in the
 * stylesheet (light and dark variants), so this simply sets the attribute the
 * cascade is keyed on. No colour is written here: a segment theme changes only
 * the `--segment-*` custom properties, so an unknown slug silently falls back
 * to the default brand theme instead of rendering an unstyled surface.
 *
 * This is how the transactional screens keep the seeker's chosen segment
 * identity without any of them hard-coding a palette.
 */
export const SegmentScope: React.FC<SegmentScopeProps> = ({ slug, className, children }) => (
  <div {...(slug ? { 'data-segment': slug } : {})} className={cn(className)}>
    {children}
  </div>
);
