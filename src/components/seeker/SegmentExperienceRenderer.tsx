import React, { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, ChevronDown, MessageSquareQuote } from 'lucide-react';
import { SectionHeader } from '@/src/components/seeker/SectionHeader';
import { Button } from '@/src/components/ui/Button';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { resolveSegmentIcon } from '@/src/lib/segmentIcons';
import { cn } from '@/src/lib/utils';
import {
  isSafeSegmentUrl,
  type SegmentExperienceConfig,
  type SegmentExperienceItem,
} from '@/src/lib/segmentExperience';

export interface SegmentExperienceRendererProps {
  /** The active segment. Only `name` is used, and only as a fallback label. */
  segment: { name: string; slug: string } | null;
  /** A NORMALIZED config. Every visible string below comes from here. */
  config: SegmentExperienceConfig;
  /** Optional live mentors, rendered by the host (never fabricated here). */
  mentors?: React.ReactNode;
  /** Rendered while the config is loading. */
  isLoading?: boolean;
  /** True when the segment has no configured experience at all. */
  isFallback?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** A section wrapper that animates in once, and respects reduced motion. */
const Section: React.FC<{
  id?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ id, className, children }) => {
  const prefersReducedMotion = useReducedMotion();
  return (
    <motion.section
      id={id}
      className={cn('section-container', className)}
      initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.45, ease: [0.23, 1, 0.31, 1] }}
    >
      {children}
    </motion.section>
  );
};

/** Only enabled items are shown. `enabled` defaults to true when absent. */
function visibleItems(items: SegmentExperienceItem[] | undefined): SegmentExperienceItem[] {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item && item.enabled !== false && item.title);
}

/**
 * Resolve an internal link through the host's navigation rather than a full
 * page load, so segment switching stays client-side. External links fall back
 * to a normal (safe, rel-hardened) anchor.
 */
function CtaLink({
  url,
  onNavigate,
  className,
  children,
}: {
  url: string;
  onNavigate?: (path: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  if (!isSafeSegmentUrl(url)) return null;

  const isInternal = url.startsWith('/');

  if (isInternal && onNavigate) {
    return (
      <Button variant="accent" size="lg" className={className} onClick={() => onNavigate(url)}>
        {children}
      </Button>
    );
  }

  return (
    <a
      href={url}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 font-semibold transition-colors',
        'bg-[var(--segment-accent)] text-[var(--segment-on-accent)]',
        className,
      )}
      {...(isInternal ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
    >
      {children}
      {!isInternal && <ArrowUpRight className="h-4 w-4" aria-hidden="true" />}
    </a>
  );
}


// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

const Hero: React.FC<{
  config: SegmentExperienceConfig;
  segment: { name: string; slug: string } | null;
  onNavigate?: (path: string) => void;
}> = ({ config, segment, onNavigate }) => {
  const prefersReducedMotion = useReducedMotion();
  const branding = config.branding ?? {};

  // Every string is either configured or a neutral structural label. No
  // segment-specific copy is hardcoded here.
  const eyebrow = branding.eyebrow ?? segment?.name;
  const headline = branding.heroHeadline ?? segment?.name;

  // A configured image is rendered only when it is a validated http(s) URL.
  const heroImageUrl = isSafeSegmentUrl(branding.heroImageUrl) ? branding.heroImageUrl : null;

  return (
    <Section>
      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.23, 1, 0.31, 1] }}
        className="relative overflow-hidden rounded-[28px] border border-[var(--segment-border-accent)] sm:rounded-[32px]"
        style={{
          background:
            'linear-gradient(135deg, color-mix(in srgb, var(--segment-hero-tint) 18%, transparent) 0%, color-mix(in srgb, var(--segment-accent) 6%, transparent) 100%)',
        }}
      >
        <div className="relative grid items-center gap-8 px-5 py-10 sm:px-8 sm:py-12 lg:grid-cols-2 lg:gap-12 lg:py-16">
          <div className="min-w-0">
            {eyebrow && (
              <p
                className="text-[11px] font-semibold uppercase tracking-[0.18em]"
                style={{ color: 'var(--segment-accent)' }}
              >
                {eyebrow}
              </p>
            )}
            <h1 className="heading-display heading-display-lg mt-3 tracking-[-0.03em] text-[var(--color-shell-text)]">
              {headline}
            </h1>
            {branding.heroSubheadline && (
              <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-[var(--color-shell-text-muted)] sm:text-base">
                {branding.heroSubheadline}
              </p>
            )}
            {config.cta?.buttonUrl && config.cta.buttonText && (
              <div className="mt-7">
                <CtaLink url={config.cta.buttonUrl} onNavigate={onNavigate}>
                  {config.cta.buttonText}
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </CtaLink>
              </div>
            )}
          </div>

          {/* Decorative / configured media. Falls back to a CSS-only panel so a
              missing image never produces broken-image UI. */}
          <div className="relative hidden lg:block" aria-hidden={heroImageUrl ? undefined : true}>
            {heroImageUrl ? (
              <img
                src={heroImageUrl}
                alt=""
                className="h-64 w-full rounded-3xl object-cover"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div
                className="h-64 w-full rounded-3xl"
                style={{
                  background:
                    'radial-gradient(120% 120% at 20% 0%, var(--segment-gradient-start) 0%, transparent 60%), radial-gradient(120% 120% at 80% 100%, var(--segment-gradient-end) 0%, transparent 60%)',
                  opacity: 0.9,
                }}
              />
            )}
          </div>
        </div>
      </motion.div>
    </Section>
  );
};


// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

const Topics: React.FC<{ topics: SegmentExperienceItem[] }> = ({ topics }) => {
  if (topics.length === 0) return null;
  return (
    <Section>
      <SectionHeader eyebrow="Explore" title="Topics" />
      <ul className="mt-5 flex flex-wrap gap-2.5">
        {topics.map((topic, idx) => {
          const Icon = resolveSegmentIcon(topic.icon);
          return (
            <motion.li
              key={`${topic.title}-${idx}`}
              initial={{ opacity: 0, y: 6 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.03, duration: 0.3 }}
              className="inline-flex items-center gap-2 rounded-2xl border border-[var(--segment-border-accent)] bg-[var(--color-shell-surface)] px-4 py-2.5 text-sm text-[var(--color-shell-text)]"
            >
              <Icon
                className="h-4 w-4 shrink-0"
                style={{ color: 'var(--segment-accent)' }}
                aria-hidden="true"
              />
              <span className="font-medium">{topic.title}</span>
            </motion.li>
          );
        })}
      </ul>
    </Section>
  );
};

// ---------------------------------------------------------------------------
// Quick help
// ---------------------------------------------------------------------------

const QuickHelp: React.FC<{ items: SegmentExperienceItem[] }> = ({ items }) => {
  if (items.length === 0) return null;
  return (
    <Section>
      <SectionHeader eyebrow="Quick help" title="How it works" />
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, idx) => {
          const Icon = resolveSegmentIcon(item.icon);
          return (
            <motion.div
              key={`${item.title}-${idx}`}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.03, duration: 0.35 }}
              className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-4"
            >
              <div className="flex items-start gap-3">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: 'var(--segment-accent-soft)', color: 'var(--segment-accent)' }}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--color-shell-text)]">{item.title}</p>
                  {item.description && (
                    <p className="mt-1 text-sm leading-relaxed text-[var(--color-shell-text-muted)]">
                      {item.description}
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </Section>
  );
};

// ---------------------------------------------------------------------------
// Journey
// ---------------------------------------------------------------------------

const Journey: React.FC<{ steps: SegmentExperienceItem[] }> = ({ steps }) => {
  if (steps.length === 0) return null;
  return (
    <Section>
      <SectionHeader eyebrow="Your journey" title="What to expect" />
      <ol className="mt-6 flex flex-col gap-4 sm:flex-row sm:gap-0">
        {steps.map((step, idx) => {
          const Icon = resolveSegmentIcon(step.icon);
          const isLast = idx === steps.length - 1;
          return (
            <motion.li
              key={`${step.title}-${idx}`}
              initial={{ opacity: 0, x: -8 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.05, duration: 0.35 }}
              className="relative flex flex-1 gap-4 sm:flex-col sm:gap-3"
            >
              <div className="flex flex-col items-center sm:flex-row sm:items-center sm:gap-3">
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-bold"
                  style={{
                    background: 'var(--segment-accent-soft)',
                    color: 'var(--segment-accent)',
                  }}
                >
                  {step.icon ? <Icon className="h-5 w-5" aria-hidden="true" /> : idx + 1}
                </span>
                {!isLast && (
                  <span
                    aria-hidden="true"
                    className="hidden h-px w-full sm:block"
                    style={{ background: 'var(--segment-border-accent)' }}
                  />
                )}
              </div>
              <div className="min-w-0 sm:pr-4">
                <p className="text-sm font-semibold text-[var(--color-shell-text)]">{step.title}</p>
                {step.description && (
                  <p className="mt-1 text-sm leading-relaxed text-[var(--color-shell-text-muted)]">
                    {step.description}
                  </p>
                )}
              </div>
              {!isLast && (
                <span
                  aria-hidden="true"
                  className="absolute left-[21px] top-12 h-[calc(100%-2.5rem)] w-px sm:hidden"
                  style={{ background: 'var(--segment-border-accent)' }}
                />
              )}
            </motion.li>
          );
        })}
      </ol>
    </Section>
  );
};

// ---------------------------------------------------------------------------
// Benefits
// ---------------------------------------------------------------------------

const Benefits: React.FC<{ items: SegmentExperienceItem[] }> = ({ items }) => {
  if (items.length === 0) return null;
  return (
    <Section>
      <SectionHeader eyebrow="Why this helps" title="Benefits" />
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, idx) => {
          const Icon = resolveSegmentIcon(item.icon);
          return (
            <motion.div
              key={`${item.title}-${idx}`}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.03, duration: 0.35 }}
              className="rounded-2xl border border-[var(--segment-border-accent)] p-4"
              style={{ background: 'var(--segment-accent-soft)' }}
            >
              <div className="flex items-start gap-3">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: 'var(--segment-accent)', color: 'var(--segment-on-accent)' }}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--color-shell-text)]">{item.title}</p>
                  {item.description && (
                    <p className="mt-1 text-sm leading-relaxed text-[var(--color-shell-text-muted)]">
                      {item.description}
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </Section>
  );
};

// ---------------------------------------------------------------------------
// Guides — ONLY from config.guides
// ---------------------------------------------------------------------------

const Guides: React.FC<{
  guides: NonNullable<SegmentExperienceConfig['guides']>;
  onNavigate?: (path: string) => void;
}> = ({ guides, onNavigate }) => {
  // No configured guides means no section. Guides are never synthesised from
  // mentors — a mentor is a person to book, not an article.
  if (guides.length === 0) return null;

  return (
    <Section>
      <SectionHeader eyebrow="Guides" title="Read before you book" />
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {guides.map((guide, idx) => (
          <motion.article
            key={`${guide.title}-${idx}`}
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: idx * 0.03, duration: 0.35 }}
            className="flex flex-col rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5"
          >
            {guide.topic && (
              <p
                className="text-[11px] font-semibold uppercase tracking-[0.18em]"
                style={{ color: 'var(--segment-accent)' }}
              >
                {guide.topic}
              </p>
            )}
            <h3 className="mt-2 font-display text-base font-bold leading-snug text-[var(--color-shell-text)]">
              {guide.title}
            </h3>
            {guide.description && (
              <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--color-shell-text-muted)]">
                {guide.description}
              </p>
            )}
            <div className="mt-4 flex items-center justify-between gap-3">
              {guide.readingTime && (
                <span className="text-xs text-[var(--color-shell-text-subtle)]">{guide.readingTime}</span>
              )}
              {guide.cta?.buttonUrl && guide.cta.buttonText && (
                <CtaLink
                  url={guide.cta.buttonUrl}
                  onNavigate={onNavigate}
                  className="px-3 py-1.5 text-sm"
                >
                  {guide.cta.buttonText}
                </CtaLink>
              )}
            </div>
          </motion.article>
        ))}
      </div>
    </Section>
  );
};

// ---------------------------------------------------------------------------
// Stories — ONLY from config.stories
// ---------------------------------------------------------------------------

const Stories: React.FC<{ stories: NonNullable<SegmentExperienceConfig['stories']> }> = ({ stories }) => {
  // No configured stories means the section is omitted entirely. Testimonials are
  // never generated from mentor names, ratings or review counts.
  if (stories.length === 0) return null;

  return (
    <Section>
      <SectionHeader eyebrow="Stories" title="What seekers say" />
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stories.map((story, idx) => (
          <motion.figure
            key={`${story.name}-${idx}`}
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: idx * 0.03, duration: 0.35 }}
            className="flex flex-col rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5"
          >
            <MessageSquareQuote
              className="h-5 w-5 shrink-0"
              style={{ color: 'var(--segment-accent)' }}
              aria-hidden="true"
            />
            <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-[var(--color-shell-text)]">
              {story.quote}
            </blockquote>
            <figcaption className="mt-4 flex items-center gap-3">
              {story.avatar && (
                <img
                  src={story.avatar}
                  alt=""
                  className="h-9 w-9 rounded-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--color-shell-text)]">{story.name}</p>
                {story.context && (
                  <p className="text-xs text-[var(--color-shell-text-subtle)]">{story.context}</p>
                )}
              </div>
            </figcaption>
          </motion.figure>
        ))}
      </div>
    </Section>
  );
};

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

const FaqItem: React.FC<{ question: string; answer: string }> = ({ question, answer }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-[var(--color-shell-text)]">{question}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 transition-transform',
            open && 'rotate-180',
          )}
          style={{ color: 'var(--segment-accent)' }}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="border-t border-[var(--color-shell-border)] px-4 py-3">
          <p className="text-sm leading-relaxed text-[var(--color-shell-text-muted)]">{answer}</p>
        </div>
      )}
    </div>
  );
};

const Faq: React.FC<{ faq: NonNullable<SegmentExperienceConfig['faq']> }> = ({ faq }) => {
  const items = faq.filter((item) => item && item.enabled !== false && item.question && item.answer);
  if (items.length === 0) return null;

  return (
    <Section>
      <SectionHeader eyebrow="FAQ" title="Common questions" />
      <div className="mt-5 flex flex-col gap-2.5">
        {items.map((item, idx) => (
          <FaqItem key={`${item.question}-${idx}`} question={item.question} answer={item.answer} />
        ))}
      </div>
    </Section>
  );
};

// ---------------------------------------------------------------------------
// Final CTA
// ---------------------------------------------------------------------------

const FinalCta: React.FC<{
  cta: NonNullable<SegmentExperienceConfig['cta']>;
  onNavigate?: (path: string) => void;
}> = ({ cta, onNavigate }) => {
  const buttonUrl = isSafeSegmentUrl(cta.buttonUrl) ? cta.buttonUrl : null;
  // Nothing to show and nowhere to go => render nothing rather than a dead panel.
  if (!cta.title && !cta.description && !buttonUrl) return null;

  return (
    <Section>
      <div
        className="rounded-3xl border border-[var(--segment-border-accent)] p-6 text-center sm:p-10"
        style={{
          background:
            'linear-gradient(135deg, color-mix(in srgb, var(--segment-accent) 14%, transparent) 0%, color-mix(in srgb, var(--segment-accent-secondary) 8%, transparent) 100%)',
        }}
      >
        {cta.title && (
          <h2 className="font-display text-xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-2xl">
            {cta.title}
          </h2>
        )}
        {cta.description && (
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-[var(--color-shell-text-muted)]">
            {cta.description}
          </p>
        )}
        {buttonUrl && cta.buttonText && (
          <div className="mt-6">
            <CtaLink url={buttonUrl} onNavigate={onNavigate}>
              {cta.buttonText}
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </CtaLink>
          </div>
        )}
      </div>
    </Section>
  );
};
// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

/** Mirrors the real layout so the page never flashes blank while loading. */
const ExperienceSkeleton: React.FC = () => (
  <div className="section-container space-y-10" aria-busy="true" aria-live="polite">
    <span className="sr-only">Loading experience</span>
    <Skeleton className="h-56 w-full rounded-[28px] sm:rounded-[32px]" />
    <div className="flex flex-wrap gap-2.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-32 rounded-2xl" />
      ))}
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full rounded-2xl" />
      ))}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

/**
 * The single renderer for segment experience content.
 *
 * It is intentionally PURE: it takes an already-normalized config and renders
 * it. It performs no fetching, no subscription and no auth, which is what lets
 * the seeker page and any future admin preview share the exact same output.
 *
 * Sections with no configured content are omitted rather than padded with
 * placeholder copy — an empty config renders the hero alone.
 */
export const SegmentExperienceRenderer: React.FC<SegmentExperienceRendererProps> = ({
  segment,
  config,
  mentors,
  isLoading = false,
  isFallback = false,
  className,
}) => {
  const prefersReducedMotion = useReducedMotion();

  if (isLoading) {
    return <ExperienceSkeleton />;
  }

  const topics = visibleItems(config.topics);
  const quickHelp = visibleItems(config.quickHelp);
  const journeySteps = visibleItems(config.journeySteps);
  const benefits = visibleItems(config.benefits);
  const guides = config.guides ?? [];
  const stories = config.stories ?? [];
  const faq = config.faq ?? [];
  const cta = config.cta;

  const hasAnySection =
    Boolean(config.branding) ||
    topics.length > 0 ||
    quickHelp.length > 0 ||
    journeySteps.length > 0 ||
    benefits.length > 0 ||
    guides.length > 0 ||
    stories.length > 0 ||
    faq.length > 0 ||
    Boolean(cta);

  return (
    <div className={cn('seeker-page', className)}>
      {/* Keyed on the slug so switching segments remounts the tree and no stale
          content from the previous segment can remain visible. */}
      <motion.div
        key={segment?.slug ?? 'no-segment'}
        initial={prefersReducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35 }}
      >
        <Hero config={config} segment={segment} />

        <Topics topics={topics} />
        <QuickHelp items={quickHelp} />

        {/* Real mentor/discovery content is supplied by the host. */}
        {mentors}

        <Journey steps={journeySteps} />
        <Guides guides={guides} />
        <Benefits items={benefits} />
        <Stories stories={stories} />
        <Faq faq={faq} />
        {cta && <FinalCta cta={cta} />}

        {/* An entirely unconfigured segment gets an honest, non-fabricated
            note rather than invented marketing copy or fake testimonials. */}
        {isFallback && !hasAnySection && (
          <Section>
            <div className="rounded-2xl border border-dashed border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-6 py-10 text-center">
              <p className="text-sm text-[var(--color-shell-text-muted)]">
                Detailed guides for this area are being prepared. In the meantime, browse the
                mentors below to get started.
              </p>
            </div>
          </Section>
        )}
      </motion.div>
    </div>
  );
};

export default SegmentExperienceRenderer;
