/**
 * SegmentExperienceRenderer — THE single renderer for a segment experience.
 *
 * It is deliberately pure: it takes an already-normalized config plus whatever
 * real marketplace nodes the host supplies, and renders them. It performs no
 * fetching, no subscription and no auth.
 *
 * That purity is the whole point. The live seeker page and the admin
 * "Preview as seeker" surface import THIS component, so a preview cannot
 * drift from what a seeker actually sees. There is no second UI.
 *
 * Rules this file must never break:
 *
 *  * NO FABRICATION. Guides and stories exist only when an admin configured
 *    them. Mentors are supplied by the host from the discovery API. Nothing is
 *    ever sliced, sampled or synthesised to fill a section.
 *  * NO SLUG BRANCHES. Appearance comes from CSS variables derived from the
 *    config, so a brand-new segment works with no code change.
 *  * NO INVENTED COLOURS. Every colour resolves through a token; this file
 *    contains no literal hex values.
 */

import React, { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, ArrowUpRight, ChevronDown, MessageSquareQuote } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { resolveSegmentIcon } from '@/src/lib/segmentIcons';
import { cn } from '@/src/lib/utils';
import {
  isSafeSegmentLink,
  isSafeSegmentUrl,
  isSegmentSectionEnabled,
  type SegmentExperienceConfig,
  type SegmentExperienceCTA,
  type SegmentExperienceItem,
  type SegmentGuide,
  type SegmentStory,
} from '@/src/lib/segmentExperience';

export interface SegmentExperienceRendererProps {
  /** The active segment. Only `name` is read, and only as a fallback label. */
  segment: { name: string; slug: string } | null;
  /** A NORMALIZED config. Every visible string below comes from here. */
  config: SegmentExperienceConfig;
  /** Real marketplace content, rendered by the host. Never fabricated here. */
  mentors?: React.ReactNode;
  /** Rendered while the config is loading. */
  isLoading?: boolean;
  /** True when the segment has no configured experience at all. */
  isFallback?: boolean;
  /**
   * Navigation supplied by the host. Internal CTA links resolve through this
   * so a "Browse mentors" button stays a client-side transition instead of a
   * full page load. Omit it and links fall back to plain anchors.
   */
  onNavigate?: (path: string) => void;
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
      className={cn('sk-section', className)}
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

/** The eyebrow + heading pair every content section shares. */
const SectionHeading: React.FC<{ eyebrow?: string; title: string; description?: string }> = ({
  eyebrow,
  title,
  description,
}) => (
  <div className="max-w-2xl">
    {eyebrow && <p className="sk-eyebrow">{eyebrow}</p>}
    <h2 className="mt-2.5 font-display text-2xl font-bold leading-tight tracking-tight text-[var(--sk-brand-text)] sm:text-3xl">
      {title}
    </h2>
    {description && (
      <p className="mt-2 text-[14px] leading-relaxed text-[var(--sk-brand-text-muted)]">{description}</p>
    )}
  </div>
);

/**
 * Resolve an internal link through the host's navigation rather than a full
 * page load, so segment and topic switching stay client-side. External links
 * fall back to a normal (safe, rel-hardened) anchor.
 */
function CtaLink({
  url,
  onNavigate,
  variant = 'primary',
  className,
  children,
}: {
  url: string;
  onNavigate?: (path: string) => void;
  variant?: 'primary' | 'secondary';
  className?: string;
  children: React.ReactNode;
}) {
  if (!isSafeSegmentLink(url)) return null;

  const isInternal = url.startsWith('/');
  const variantClass = variant === 'primary' ? 'sk-btn-primary' : 'sk-btn-secondary';

  if (isInternal && onNavigate) {
    return (
      <Button
        variant="accent"
        size="lg"
        className={cn('sk-btn', variantClass, className)}
        onClick={() => onNavigate(url)}
      >
        {children}
      </Button>
    );
  }

  return (
    <a
      href={url}
      className={cn('sk-btn', variantClass, className)}
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

  // A configured image renders only when it is a validated http(s) URL.
  const heroImageUrl = isSafeSegmentUrl(branding.heroImageUrl) ? branding.heroImageUrl : null;

  // A real image with no alt text is treated as decorative, and an image with
  // alt text is described by it. A missing image is NOT replaced by a
  // fabricated illustration: the CSS composition behind the media panel is an
  // abstract brand gradient that makes no claim to depict anything.
  const heroImageAlt = branding.heroImageAlt?.trim() || '';

  return (
    <Section>
      <div
        className="sk-hero"
        role={headline ? undefined : 'presentation'}
      >
        <div className="grid items-center gap-8 px-5 py-10 sm:px-8 sm:py-12 md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] md:gap-10 md:px-10 lg:px-14 lg:py-20">
          <div className="min-w-0">
            {eyebrow && (
              <p
                className="text-[11px] font-bold uppercase tracking-[0.2em]"
                style={{ color: 'var(--sk-hero-accent)' }}
              >
                {eyebrow}
              </p>
            )}

            {headline && (
              <h1 className="mt-4 font-display text-[30px] font-bold leading-[1.1] tracking-[-0.035em] text-[var(--sk-hero-text)] sm:text-[38px] md:text-[40px] lg:text-[52px]">
                {headline}
              </h1>
            )}

            {branding.heroSubheadline && (
              <p
                className="mt-5 max-w-xl text-[15px] leading-relaxed text-[var(--sk-hero-text-muted)] sm:text-[16px] lg:text-[17px]"
              >
                {branding.heroSubheadline}
              </p>
            )}

            <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-3 lg:mt-8">
              {config.cta?.buttonUrl && config.cta.buttonText && (
                <CtaLink url={config.cta.buttonUrl} onNavigate={onNavigate}>
                  {config.cta.buttonText}
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </CtaLink>
              )}

              {/* Secondary action: the full mentor directory. Structural
                  navigation, not configured copy. */}
              {onNavigate && (
                <button type="button" className="sk-link-light" onClick={() => onNavigate('/mentors')}>
                  Browse every mentor
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Support metadata: only real, configured facts. No invented
                counts, ratings or "specialist" claims. */}
            <SupportMeta segment={segment} />
          </div>

          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.55, delay: 0.1, ease: [0.23, 1, 0.31, 1] }}
            className="min-w-0"
          >
            <div
              className={cn(
                'sk-hero-media h-full w-full',
                heroImageUrl
                  ? 'aspect-[4/3] md:aspect-[5/4]'
                  : 'aspect-[16/9] md:aspect-[5/4]',
              )}
            >
              {heroImageUrl && (
                <img
                  src={heroImageUrl}
                  alt={heroImageAlt}
                  loading="lazy"
                  decoding="async"
                />
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </Section>
  );
};

/**
 * The small factual strip under the hero.
 *
 * It reports only things that are true by construction: that the session is
 * 1:1, and that booking is done in the seeker's own timezone. It is NOT a
 * place for counts, ratings or social proof, because those must come from
 * real data and there is no such data here.
 */
const SupportMeta: React.FC<{ segment: { name: string; slug: string } | null }> = ({ segment }) => {
  const points = [
    'One-to-one session',
    'Book in your own timezone',
    segment?.name ? `Mentors in ${segment.name}` : null,
  ].filter((p): p is string => Boolean(p));

  if (points.length === 0) return null;

  return (
    <ul className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-2.5">
      {points.map((point) => (
        <li
          key={point}
          className="flex items-center gap-2 text-[13px] font-medium text-[var(--sk-hero-text-muted)]"
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: 'var(--sk-hero-accent)' }}
            aria-hidden="true"
          />
          {point}
        </li>
      ))}
    </ul>
  );
};

// ---------------------------------------------------------------------------
// Quick help
// ---------------------------------------------------------------------------

const QuickHelp: React.FC<{ items: SegmentExperienceItem[] }> = ({ items }) => {
  if (items.length === 0) return null;

  return (
    <Section>
      <SectionHeading eyebrow="Quick help" title="Start with what you need today" />
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item, idx) => {
          const Icon = resolveSegmentIcon(item.icon);
          return (
            <motion.div
              key={`${item.title}-${idx}`}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.03, duration: 0.35 }}
              className="sk-card p-5"
            >
              <span
                className="flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ background: 'var(--segment-accent-soft)', color: 'var(--segment-accent)' }}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-[15px] font-semibold leading-snug text-[var(--sk-brand-text)]">
                {item.title}
              </h3>
              {item.description && (
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--sk-brand-text-muted)]">
                  {item.description}
                </p>
              )}
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
  const prefersReducedMotion = useReducedMotion();

  return (
    <Section>
      <SectionHeading eyebrow="How it works" title="Three steps to a booked session" />
      <ol className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((step, idx) => {
          const Icon = resolveSegmentIcon(step.icon);
          const isLast = idx === steps.length - 1;
          return (
            <motion.li
              key={`${step.title}-${idx}`}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.05, duration: 0.4 }}
              className="sk-card relative p-6 pt-7 sm:p-7 sm:pt-8"
            >
              {/* The editorial numeral carries the rhythm; the icon is the
                  supporting mark, not the headline. */}
              <span
                className="absolute right-5 top-4 font-display text-[40px] font-bold leading-none tracking-tight"
                style={{ color: 'var(--segment-accent-soft)' }}
                aria-hidden="true"
              >
                {String(idx + 1).padStart(2, '0')}
              </span>
              <div className="flex items-center gap-3">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{
                    background: 'var(--segment-accent-soft)',
                    color: 'var(--segment-accent)',
                  }}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span
                  className="text-[11px] font-bold uppercase tracking-[0.18em]"
                  style={{ color: 'var(--segment-accent)' }}
                >
                  Step {idx + 1}
                </span>
              </div>
              <h3 className="mt-5 text-[16px] font-semibold text-[var(--sk-brand-text)]">{step.title}</h3>
              {step.description && (
                <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--sk-brand-text-muted)]">
                  {step.description}
                </p>
              )}
              {!isLast && (
                <span
                  aria-hidden="true"
                  className="absolute left-0 right-0 top-1/2 hidden h-px -translate-y-1/2 sm:block sm:-right-3 sm:left-auto sm:w-3"
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
      <SectionHeading eyebrow="Why this helps" title="What a session gives you" />
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item, idx) => {
          const Icon = resolveSegmentIcon(item.icon);
          return (
            <motion.div
              key={`${item.title}-${idx}`}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.03, duration: 0.35 }}
              className="sk-card sk-card-accent p-5"
            >
              <span
                className="flex h-9 w-9 items-center justify-center rounded-xl"
                style={{ background: 'var(--segment-accent)', color: 'var(--segment-on-accent)' }}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-[14px] font-semibold text-[var(--sk-brand-text)]">{item.title}</h3>
              {item.description && (
                <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--sk-brand-text-muted)]">
                  {item.description}
                </p>
              )}
            </motion.div>
          );
        })}
      </div>
    </Section>
  );
};

// ---------------------------------------------------------------------------
// Guides - ONLY from config.guides
// ---------------------------------------------------------------------------

const Guides: React.FC<{
  guides: SegmentGuide[];
  onNavigate?: (path: string) => void;
}> = ({ guides, onNavigate }) => {
  // No configured guides means no section. Guides are never synthesised from
  // mentors: a mentor is a person to book, not an article.
  if (guides.length === 0) return null;

  return (
    <Section>
      <SectionHeading eyebrow="Guides" title="Read before you book" />
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {guides.map((guide, idx) => (
          <motion.article
            key={`${guide.title}-${idx}`}
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: idx * 0.03, duration: 0.35 }}
            className="sk-card flex flex-col p-5"
          >
            {guide.topic && <p className="sk-eyebrow">{guide.topic}</p>}
            <h3 className="mt-2 text-[15px] font-bold leading-snug text-[var(--sk-brand-text)]">
              {guide.title}
            </h3>
            {guide.description && (
              <p className="mt-2 flex-1 text-[13px] leading-relaxed text-[var(--sk-brand-text-muted)]">
                {guide.description}
              </p>
            )}
            <div className="mt-4 flex items-center justify-between gap-3">
              {guide.readingTime && (
                <span className="text-[12px] text-[var(--sk-brand-text-muted)]">{guide.readingTime}</span>
              )}
              {guide.cta?.buttonUrl && guide.cta.buttonText && (
                <CtaLink
                  url={guide.cta.buttonUrl}
                  onNavigate={onNavigate}
                  variant="secondary"
                  className="min-h-[40px] px-4 py-2 text-[13px]"
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
// Stories - ONLY from config.stories
// ---------------------------------------------------------------------------

const Stories: React.FC<{ stories: SegmentStory[] }> = ({ stories }) => {
  // No configured stories means the section is omitted entirely. Testimonials
  // are never generated from mentor names, ratings or review counts.
  if (stories.length === 0) return null;

  return (
    <Section>
      <SectionHeading eyebrow="Stories" title="What seekers say" />
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stories.map((story, idx) => (
          <motion.figure
            key={`${story.name}-${idx}`}
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: idx * 0.03, duration: 0.35 }}
            className="sk-card flex flex-col p-5"
          >
            <MessageSquareQuote
              className="h-5 w-5 shrink-0"
              style={{ color: 'var(--segment-accent)' }}
              aria-hidden="true"
            />
            <blockquote className="mt-3 flex-1 text-[14px] leading-relaxed text-[var(--sk-brand-text)]">
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
                <p className="truncate text-[13px] font-semibold text-[var(--sk-brand-text)]">
                  {story.name}
                </p>
                {story.context && (
                  <p className="truncate text-[12px] text-[var(--sk-brand-text-muted)]">
                    {story.context}
                  </p>
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
    <div className="sk-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--sk-brand-focus)] focus-visible:outline-offset-2"
        aria-expanded={open}
      >
        <span className="text-[14px] font-semibold text-[var(--sk-brand-text)]">{question}</span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')}
          style={{ color: 'var(--segment-accent)' }}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="border-t border-[var(--sk-brand-border)] px-5 py-4">
          <p className="text-[13px] leading-relaxed text-[var(--sk-brand-text-muted)]">{answer}</p>
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
      <SectionHeading eyebrow="FAQ" title="Common questions" />
      <div className="mt-6 flex flex-col gap-2.5">
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
  cta: SegmentExperienceCTA;
  onNavigate?: (path: string) => void;
}> = ({ cta, onNavigate }) => {
  const buttonUrl = isSafeSegmentLink(cta.buttonUrl) ? cta.buttonUrl : null;
  // Nothing to show and nowhere to go => render nothing rather than a dead panel.
  if (!cta.title && !cta.description && !buttonUrl) return null;

  return (
    <Section>
      <div className="sk-hero overflow-hidden">
        <div className="px-5 py-12 text-center sm:px-8 sm:py-16">
          {cta.title && (
            <h2 className="font-display text-[24px] font-bold leading-tight tracking-tight text-[var(--sk-hero-text)] sm:text-[32px]">
              {cta.title}
            </h2>
          )}
          {cta.description && (
            <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-[var(--sk-hero-text-muted)]">
              {cta.description}
            </p>
          )}
          {buttonUrl && cta.buttonText && (
            <div className="mt-8">
              <CtaLink url={buttonUrl} onNavigate={onNavigate}>
                {cta.buttonText}
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </CtaLink>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
};

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

/** Mirrors the real layout so the page never flashes blank while loading. */
const ExperienceSkeleton: React.FC = () => (
  <div className="sk-experience" aria-busy="true" aria-live="polite">
    <div className="sk-section space-y-10">
      <span className="sr-only">Loading experience</span>
      <Skeleton className="h-[420px] w-full rounded-[28px] sm:h-[460px] lg:h-[520px]" />
      <div className="flex gap-2.5 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-32 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

/**
 * The single renderer for segment experience content.
 *
 * Section visibility is resolved ONCE here, from `config.sections`, and every
 * section below honours it. A disabled section is not rendered at all - it is
 * not rendered empty, and it is not replaced by a placeholder.
 */
export const SegmentExperienceRenderer: React.FC<SegmentExperienceRendererProps> = ({
  segment,
  config,
  mentors,
  isLoading = false,
  isFallback = false,
  className,
  onNavigate,
}) => {
  const prefersReducedMotion = useReducedMotion();

  if (isLoading) {
    return <ExperienceSkeleton />;
  }

  const sections = config.sections;
  const on = (key: Parameters<typeof isSegmentSectionEnabled>[1]) =>
    isSegmentSectionEnabled(sections, key);

  const quickHelp = visibleItems(config.quickHelp);
  const journeySteps = visibleItems(config.journeySteps);
  const benefits = visibleItems(config.benefits);
  const guides = config.guides ?? [];
  const stories = config.stories ?? [];
  const faq = config.faq ?? [];
  const cta = config.cta;

  const hasAnySection =
    Boolean(config.branding) ||
    quickHelp.length > 0 ||
    journeySteps.length > 0 ||
    benefits.length > 0 ||
    guides.length > 0 ||
    stories.length > 0 ||
    faq.length > 0 ||
    Boolean(cta);

  return (
    <div className={cn('sk-experience', className)}>
      {/* Keyed on the slug so switching segments remounts the tree and no stale
          content from the previous segment can remain visible. */}
      <motion.div
        key={segment?.slug ?? 'no-segment'}
        initial={prefersReducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35 }}
      >
        {on('hero') && <Hero config={config} segment={segment} onNavigate={onNavigate} />}

        {/* Real mentor/discovery content is supplied by the host, positioned
            where the marketplace section belongs: directly under the topic bar
            the host renders above. */}
        {on('mentors') && mentors}

        {on('quickHelp') && <QuickHelp items={quickHelp} />}
        {on('journey') && <Journey steps={journeySteps} />}
        {on('guides') && <Guides guides={guides} onNavigate={onNavigate} />}
        {on('benefits') && <Benefits items={benefits} />}
        {on('stories') && <Stories stories={stories} />}
        {on('faq') && <Faq faq={faq} />}
        {on('cta') && cta && <FinalCta cta={cta} onNavigate={onNavigate} />}

        {/* An entirely unconfigured segment gets an honest, non-fabricated
            note rather than invented marketing copy or fake testimonials. */}
        {isFallback && !hasAnySection && (
          <Section>
            <div className="rounded-2xl border border-dashed border-[var(--sk-brand-border)] bg-[var(--sk-brand-surface)] px-6 py-10 text-center">
              <p className="text-sm text-[var(--sk-brand-text-muted)]">
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