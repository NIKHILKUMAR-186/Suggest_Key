import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { ArrowRight, Compass, Users, Brain, Briefcase, Heart } from 'reicon-react';
import React, { useMemo } from 'react';
import type { Segment } from '@/src/types/database';
import { deriveSegmentTheme } from '@/src/lib/segmentTheme';
import { resolveSegmentIcon } from '@/src/lib/segmentIcons';
import { useTheme } from '@/src/context/ThemeContext';
import { Reveal, Stagger, StaggerItem } from '@/src/components/landing/Reveal';
import { AREAS_ACTION_LABEL, AREAS_BODY, AREAS_EMPTY_LABEL, AREAS_RETRY_LABEL, AREAS_TITLE } from '@/src/components/landing/landingContent';

const AREAS_ERROR_LABEL = "Couldn't load mentorship areas.";

const SEGMENT_IMAGE_MAP: Record<string, { src: string; alt: string }> = {
  'relationship-advisor': {
    src: '/assets/landing/hero right.png',
    alt: 'Two people in meaningful conversation representing relationship guidance',
  },
  'autism-mentor': {
    src: '/assets/landing/hero.png',
    alt: 'Abstract representation of neurodivergent support and sensory navigation',
  },
  'career-mentor': {
    src: '/assets/landing/hero right.png',
    alt: 'Professional development and career growth visualization',
  },
};

const SEGMENT_ICON_MAP: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  'relationship-advisor': Heart,
  'autism-mentor': Brain,
  'career-mentor': Briefcase,
};

const SEGMENT_TOPIC_HINTS: Record<string, string[]> = {
  'relationship-advisor': ['Communication', 'Conflict Resolution', 'Emotional Intelligence'],
  'autism-mentor': ['Sensory Navigation', 'Life Transitions', 'Executive Function'],
  'career-mentor': ['Leadership', 'Negotiation', 'Career Transitions'],
};

export interface SegmentDiscoveryProps {
  segments: Segment[];
  isLoadingSegments: boolean;
  hasError: boolean;
  onOpenArea: (segment: Segment) => void;
  onRetry: () => void;
}

const SectionSkeleton: React.FC = () => (
  <div className="sk-segment-skeleton" aria-hidden="true">
    <div className="sk-segment-skeleton__header">
      <span className="sk-segment-skeleton__line sk-segment-skeleton__line--eyebrow" />
      <span className="sk-segment-skeleton__line sk-segment-skeleton__line--heading" />
      <span className="sk-segment-skeleton__line sk-segment-skeleton__line--heading" />
      <span className="sk-segment-skeleton__line sk-segment-skeleton__line--body" />
    </div>
    <div className="sk-segment-skeleton__featured">
      <div className="sk-segment-skeleton__image" />
      <div className="sk-segment-skeleton__content">
        <span className="sk-segment-skeleton__line sk-segment-skeleton__line--title" />
        <span className="sk-segment-skeleton__line sk-segment-skeleton__line--desc" />
        <span className="sk-segment-skeleton__line sk-segment-skeleton__line--desc" />
        <span className="sk-segment-skeleton__line sk-segment-skeleton__line--cta" />
      </div>
    </div>
    <div className="sk-segment-skeleton__secondary">
      <div className="sk-segment-skeleton__card">
        <div className="sk-segment-skeleton__image" />
        <div className="sk-segment-skeleton__content">
          <span className="sk-segment-skeleton__line sk-segment-skeleton__line--title" />
          <span className="sk-segment-skeleton__line sk-segment-skeleton__line--desc" />
          <span className="sk-segment-skeleton__line sk-segment-skeleton__line--cta" />
        </div>
      </div>
      <div className="sk-segment-skeleton__card">
        <div className="sk-segment-skeleton__image" />
        <div className="sk-segment-skeleton__content">
          <span className="sk-segment-skeleton__line sk-segment-skeleton__line--title" />
          <span className="sk-segment-skeleton__line sk-segment-skeleton__line--desc" />
          <span className="sk-segment-skeleton__line sk-segment-skeleton__line--cta" />
        </div>
      </div>
    </div>
  </div>
);

const ErrorState: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
  <div className="sk-segment-error">
    <p className="sk-segment-error__message">{AREAS_ERROR_LABEL}</p>
    <button
      type="button"
      className="sk-segment-error__retry"
      onClick={onRetry}
    >
      {AREAS_RETRY_LABEL}
      <ArrowRight className="sk-segment-error__arrow" size={16} />
    </button>
  </div>
);

const EmptyState: React.FC = () => (
  <p className="sk-segment-empty">{AREAS_EMPTY_LABEL}</p>
);

const SegmentImage: React.FC<{
  segment: Segment;
  isFeatured: boolean;
  canAnimate: boolean;
  scrollY?: ReturnType<typeof useScroll>['scrollY'];
}> = ({ segment, isFeatured, canAnimate, scrollY }) => {
  const { theme } = useTheme();
  const imageMap = SEGMENT_IMAGE_MAP[segment.slug] ?? SEGMENT_IMAGE_MAP['relationship-advisor'];
  const segmentTheme = deriveSegmentTheme(segment.experience_config, theme);
  const accent = segmentTheme.accent ?? 'var(--editorial-accent)';

  const style: React.CSSProperties = {
    '--segment-accent': accent,
  } as React.CSSProperties;

  if (!canAnimate) {
    return (
      <div className="sk-segment-image" style={style}>
        <img
          src={imageMap.src}
          alt={imageMap.alt}
          loading={isFeatured ? 'eager' : 'lazy'}
          decoding="async"
          className="sk-segment-image__img"
        />
      </div>
    );
  }

  const clipPath = scrollY
    ? useTransform(scrollY, [0, 300], ['inset(8% 8% 8% 8%)', 'inset(0% 0% 0% 0%)'])
    : undefined;

  const scale = scrollY
    ? useTransform(scrollY, [0, 300], [1.04, 1])
    : undefined;

  return (
    <motion.div
      className="sk-segment-image"
      style={style}
      initial={{ opacity: 0, scale: 1.04, clipPath: 'inset(8% 8% 8% 8%)' }}
      whileInView={{ opacity: 1, scale: 1, clipPath: 'inset(0% 0% 0% 0%)' }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
    >
      <img
        src={imageMap.src}
        alt={imageMap.alt}
        loading={isFeatured ? 'eager' : 'lazy'}
        decoding="async"
        className="sk-segment-image__img"
        style={{
          transform: scale ? `scale(${scale.get()})` : undefined,
          clipPath: clipPath,
        }}
      />
      {isFeatured && (
        <div className="sk-segment-image__glow" aria-hidden="true" />
      )}
    </motion.div>
  );
};

const FeaturedSegment: React.FC<{
  segment: Segment;
  onOpenArea: (segment: Segment) => void;
  index: number;
}> = ({ segment, onOpenArea, index }) => {
  const { theme } = useTheme();
  const canAnimate = useReducedMotion() !== true;
  const segmentTheme = deriveSegmentTheme(segment.experience_config, theme);
  const accent = segmentTheme.accent ?? 'var(--editorial-accent)';
  const iconComponent = SEGMENT_ICON_MAP[segment.slug] ?? Compass;
  const topics = SEGMENT_TOPIC_HINTS[segment.slug] ?? [];
  const description = segment.description?.trim() ?? '';
  const { scrollY } = useScroll();

  const style: React.CSSProperties = {
    '--segment-accent': accent,
  } as React.CSSProperties;

  const handleClick = () => onOpenArea(segment);
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpenArea(segment);
    }
  };

  return (
    <Reveal
      as="article"
      className="sk-segment-card sk-segment-card--featured"
      delay={index * 0.12}
      y={24}
    >
      <div className="sk-segment-card__visual" style={style}>
        <SegmentImage
          segment={segment}
          isFeatured={true}
          canAnimate={canAnimate}
          scrollY={scrollY}
        />
        <div className="sk-segment-card__icon" aria-hidden="true">
          <iconComponent className="sk-segment-card__icon-svg" size={32} strokeWidth={1.5} />
        </div>
      </div>

      <div className="sk-segment-card__content">
        <span className="sk-segment-card__eyebrow">Primary Focus</span>
        <h3 className="sk-segment-card__title">{segment.name}</h3>
        {description && <p className="sk-segment-card__description">{description}</p>}
        {topics.length > 0 && (
          <ul className="sk-segment-card__topics" aria-label="Key topics">
            {topics.slice(0, 3).map((topic) => (
              <li key={topic} className="sk-segment-card__topic">
                {topic}
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="sk-segment-card__cta"
          style={style}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          aria-label={`${AREAS_ACTION_LABEL} ${segment.name}`}
        >
          <span>{AREAS_ACTION_LABEL}</span>
          <ArrowRight className="sk-segment-card__arrow" size={18} strokeWidth={2} />
        </button>
      </div>
    </Reveal>
  );
};

const SecondarySegment: React.FC<{
  segment: Segment;
  onOpenArea: (segment: Segment) => void;
  index: number;
}> = ({ segment, onOpenArea, index }) => {
  const { theme } = useTheme();
  const canAnimate = useReducedMotion() !== true;
  const segmentTheme = deriveSegmentTheme(segment.experience_config, theme);
  const accent = segmentTheme.accent ?? 'var(--editorial-accent)';
  const iconComponent = SEGMENT_ICON_MAP[segment.slug] ?? Compass;
  const topics = SEGMENT_TOPIC_HINTS[segment.slug] ?? [];
  const description = segment.description?.trim() ?? '';

  const style: React.CSSProperties = {
    '--segment-accent': accent,
  } as React.CSSProperties;

  const handleClick = () => onOpenArea(segment);
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpenArea(segment);
    }
  };

  return (
    <StaggerItem key={segment.id} y={20} as="article" className="sk-segment-card sk-segment-card--secondary" delay={index * 0.08}>
      <motion.div
        className="sk-segment-card__visual"
        style={style}
        initial={canAnimate ? { opacity: 0, scale: 1.02 } : false}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, amount: 0.25 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        whileHover={canAnimate ? { scale: 1.03 } : undefined}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <SegmentImage
          segment={segment}
          isFeatured={false}
          canAnimate={canAnimate}
        />
        <div className="sk-segment-card__icon" aria-hidden="true">
          <iconComponent className="sk-segment-card__icon-svg" size={24} strokeWidth={1.7} />
        </div>
      </motion.div>

      <div className="sk-segment-card__content">
        <h3 className="sk-segment-card__title">{segment.name}</h3>
        {description && <p className="sk-segment-card__description">{description}</p>}
        {topics.length > 0 && (
          <ul className="sk-segment-card__topics" aria-label="Key topics">
            {topics.slice(0, 2).map((topic) => (
              <li key={topic} className="sk-segment-card__topic">
                {topic}
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="sk-segment-card__cta"
          style={style}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          aria-label={`${AREAS_ACTION_LABEL} ${segment.name}`}
        >
          <span>{AREAS_ACTION_LABEL}</span>
          <ArrowRight className="sk-segment-card__arrow" size={16} strokeWidth={2} />
        </button>
      </div>
    </StaggerItem>
  );
};

const BrowseAllLink: React.FC<{ onNavigate: () => void }> = ({ onNavigate }) => {
  const canAnimate = useReducedMotion() !== true;

  return (
    <Reveal as="div" className="sk-segment-browse" delay={0.3} y={16}>
      <button
        type="button"
        className="sk-segment-browse__link"
        onClick={onNavigate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onNavigate();
          }
        }}
        whileHover={canAnimate ? { x: 8 } : undefined}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <Compass className="sk-segment-browse__icon" size={20} strokeWidth={1.5} />
        <span className="sk-segment-browse__text">Explore all mentors</span>
        <ArrowRight className="sk-segment-browse__arrow" size={18} strokeWidth={2} />
      </button>
    </Reveal>
  );
};

export const SegmentDiscovery: React.FC<SegmentDiscoveryProps> = ({
  segments,
  isLoadingSegments,
  hasError,
  onOpenArea,
  onRetry,
}) => {
  const canAnimate = useReducedMotion() !== true;
  const featuredSegment = segments[0];
  const secondarySegments = segments.slice(1);

  if (isLoadingSegments) {
    return (
      <section id="segment-discovery" className="sk-segment-discovery" aria-labelledby="segment-discovery-title">
        <div className="sk-segment-discovery__inner">
          <SectionSkeleton />
        </div>
      </section>
    );
  }

  if (hasError) {
    return (
      <section id="segment-discovery" className="sk-segment-discovery" aria-labelledby="segment-discovery-title">
        <div className="sk-segment-discovery__inner">
          <ErrorState onRetry={onRetry} />
        </div>
      </section>
    );
  }

  if (segments.length === 0) {
    return (
      <section id="segment-discovery" className="sk-segment-discovery" aria-labelledby="segment-discovery-title">
        <div className="sk-segment-discovery__inner">
          <EmptyState />
        </div>
      </section>
    );
  }

  return (
    <section id="segment-discovery" className="sk-segment-discovery" aria-labelledby="segment-discovery-title">
      <div className="sk-segment-discovery__inner">
        <header className="sk-segment-discovery__header">
          <Reveal as="div" className="sk-segment-discovery__eyebrow" delay={0} y={12}>
            <span className="editorial-caption editorial-tracking-wide">Start with what&apos;s on your mind</span>
          </Reveal>
          <Reveal as="h2" id="segment-discovery-title" className="editorial-display editorial-heading-xl editorial-text-normal editorial-leading-tight" delay={0.06} y={16}>
            What are you<br />figuring out?
          </Reveal>
          <Reveal as="p" className="editorial-lead editorial-text-normal" delay={0.12} y={16}>
            Begin with an area that feels close to your question. Then explore the people who can help.
          </Reveal>
          <Reveal as="div" className="sk-segment-discovery__browse-header" delay={0.18} y={12}>
            <BrowseAllLink onNavigate={() => onOpenArea({ ...featuredSegment, slug: 'all' } as Segment)} />
          </Reveal>
        </header>

        <div className="sk-segment-discovery__grid">
          {featuredSegment && (
            <FeaturedSegment
              segment={featuredSegment}
              onOpenArea={onOpenArea}
              index={0}
            />
          )}

          <div className="sk-segment-discovery__secondary">
            <Stagger step={0.08} as="div" className="sk-segment-discovery__secondary-grid">
              {secondarySegments.map((segment, idx) => (
                <SecondarySegment
                  key={segment.id}
                  segment={segment}
                  onOpenArea={onOpenArea}
                  index={idx}
                />
              ))}
            </Stagger>
          </div>
        </div>
      </div>
    </section>
  );
};

export default SegmentDiscovery;