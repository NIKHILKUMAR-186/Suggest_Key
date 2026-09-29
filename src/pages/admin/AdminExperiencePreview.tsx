/**
 * "PREVIEW AS SEEKER".
 *
 * The requirement is that an admin sees the page a seeker sees, from the SAME
 * renderer, using the CURRENT UNSAVED DRAFT. Both halves matter:
 *
 *  * SAME RENDERER. This component imports `SegmentExperienceRenderer` and
 *    `SegmentTopicBar` - the identical modules the live seeker page uses. There
 *    is no parallel admin-only layout, so a preview cannot drift.
 *
 *  * UNSAVED DRAFT. The config passed in is the editor's in-memory state, not a
 *    re-fetch. The preview is also scoped in a container rather than the
 *    document, so the draft's derived theme is applied to THIS subtree only and
 *    the admin chrome around it is not repainted.
 *
 * Nothing is persisted to preview. Nothing is fabricated either: with no mentor
 * data, the marketplace area says so plainly instead of showing sample cards.
 */

import React, { useEffect, useRef } from 'react';
import { Eye, Monitor, Smartphone } from 'lucide-react';
import { SegmentExperienceRenderer } from '@/src/components/seeker/SegmentExperienceRenderer';
import { SegmentTopicBar } from '@/src/components/seeker/SegmentTopicBar';
import { deriveSegmentTheme } from '@/src/lib/segmentTheme';
import { normalizeSegmentExperience } from '@/src/lib/segmentExperience';
import { ALL_TOPICS, type SegmentTopicView } from '@/src/lib/segmentTopics';
import { cn } from '@/src/lib/utils';

export type PreviewViewport = 'desktop' | 'mobile';

export interface AdminExperiencePreviewProps {
  segmentName: string;
  segmentSlug: string;
  /** The editor's current in-memory draft. Normalised here, not saved. */
  config: unknown;
  /** Real topics for the segment, so the chip bar is accurate. */
  topics: SegmentTopicView[];
  /** True while a draft differs from what is stored. */
  isDirty: boolean;
  viewport: PreviewViewport;
  onViewportChange: (viewport: PreviewViewport) => void;
  className?: string;
}

export const AdminExperiencePreview: React.FC<AdminExperiencePreviewProps> = ({
  segmentName,
  segmentSlug,
  config,
  topics,
  isDirty,
  viewport,
  onViewportChange,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // The draft is normalised through the SAME function the seeker path uses, so
  // a half-typed hex value or an unsafe URL can never reach the preview DOM.
  const normalized = normalizeSegmentExperience(config);

  // The draft's palette is written onto THIS container, not the document root.
  // An admin editing Career must not see the whole admin shell turn teal, and a
  // seeker on another segment must not be affected either.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    if (Object.keys(normalized).length === 0) {
      for (const name of node.style.length ? Array.from(node.style) : []) {
        node.style.removeProperty(name);
      }
      return;
    }

    const isDark =
      typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    const theme = deriveSegmentTheme(normalized, isDark ? 'dark' : 'light');

    for (const [name, value] of Object.entries(theme.variables)) {
      node.style.setProperty(name, value);
    }

    return () => {
      for (const name of Object.keys(theme.variables)) {
        node.style.removeProperty(name);
      }
    };
  }, [normalized]);

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-2xl border border-b-0 border-zinc-200 bg-zinc-900 px-4 py-2.5">
        <p className="flex items-center gap-2 text-xs font-semibold text-white">
          <Eye className="h-4 w-4" aria-hidden="true" />
          Preview as seeker
          {isDirty && (
            <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
              Unsaved draft
            </span>
          )}
        </p>
        <div className="flex items-center gap-1" role="group" aria-label="Preview viewport">
          {(['desktop', 'mobile'] as PreviewViewport[]).map((option) => {
            const Icon = option === 'desktop' ? Monitor : Smartphone;
            return (
              <button
                key={option}
                type="button"
                onClick={() => onViewportChange(option)}
                aria-pressed={viewport === option}
                className={cn(
                  'flex min-h-[32px] items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold transition-colors',
                  viewport === option
                    ? 'bg-white text-zinc-900'
                    : 'text-white/70 hover:bg-white/10 hover:text-white',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {option === 'desktop' ? '1280' : '390'}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-center overflow-x-auto rounded-b-2xl border border-zinc-200 bg-zinc-100 p-4">
        <div
          ref={containerRef}
          className={cn(
            'overflow-hidden rounded-xl bg-[var(--sk-brand-canvas)] shadow-2xl ring-1 ring-zinc-300',
            viewport === 'desktop' ? 'w-full max-w-[1280px]' : 'w-[390px] max-w-full',
          )}
          // The frame is a preview of a page, not a live region of the admin
          // form, so it is labelled and hidden from the tab order.
          role="region"
          aria-label={`Seeker preview of ${segmentName}`}
        >
          <SegmentExperienceRenderer
            segment={{ name: segmentName, slug: segmentSlug }}
            config={normalized}
            isFallback={Object.keys(normalized).length === 0}
            // The real marketplace block is intentionally NOT faked here: an
            // admin preview must never imply mentor data that was never
            // loaded. The live seeker page supplies its own.
          />

          {/* The topic bar is rendered by the live page above the marketplace,
              so the preview shows it in the same place with the same
              component. Selecting is inert here. */}
          <div className="sk-section" style={{ marginTop: 0 }}>
            <SegmentTopicBar
              topics={topics}
              selectedSlug={ALL_TOPICS}
              onSelect={() => undefined}
            />
          </div>
        </div>
      </div>

      <p className="mt-2 text-[11px] text-zinc-500">
        This is the seeker page rendered from your current draft. Nothing here is saved, and no
        mentor data is loaded.
      </p>
    </div>
  );
};

export default AdminExperiencePreview;