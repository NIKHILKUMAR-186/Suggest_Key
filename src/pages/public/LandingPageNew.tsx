import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowRight,
  ArrowUp,
  Calendar,
  Chat,
  Check,
  Compass,
  DocumentText,
  Menu,
  Plus,
  Search,
  ShieldCheck,
  User,
  X,
  MessageCircle,
} from 'reicon-react';
import { getInitials } from '@/src/lib/avatar';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { useActiveSegments } from '@/src/hooks/useActiveSegments';
import { useFeaturedMentors, type FeaturedMentor } from '@/src/hooks/useFeaturedMentors';
import { FAQ_ITEMS } from '@/src/components/landing/landingContent';
import { formatInr, formatNextAvailableLabel } from '@/src/lib/seekerFormat';
import { getDateStringInTimezone } from '@/src/lib/slotEngine';
import { mentorDirectoryPath, mentorProfilePath, segmentLandingPath } from '@/src/lib/mentorNav';
import type { DirectoryMentor, Segment } from '@/src/types/database';
import './LandingPageNew.css';

const steps = [
  {
    number: '01',
    title: 'Discover',
    detail: 'Start with an active mentorship area that fits what you are working through.',
    Icon: Compass,
  },
  {
    number: '02',
    title: 'Choose',
    detail: 'Read real mentor profiles, session lengths, and prices before deciding.',
    Icon: User,
  },
  {
    number: '03',
    title: 'Book',
    detail: 'Choose an available time and complete the payment shown for that session.',
    Icon: Calendar,
  },
  {
    number: '04',
    title: 'Talk',
    detail: 'Your mentor confirms with a meeting link. Meet, then revisit your session workspace.',
    Icon: Chat,
  },
];

const journeyVariants = {
  container: {
    hidden: { opacity: 0 },
    show: { opacity: 1 },
  },
  node: {
    hidden: { opacity: 0, y: 22 },
    show: { opacity: 1, y: 0 },
  },
  connector: {
    hidden: { scaleX: 0 },
    show: { scaleX: 1 },
  },
};

const principles = [
  {
    title: 'Profiles reviewed before they go live',
    detail: 'Only approved, active mentors appear in the public directory.',
    Icon: ShieldCheck,
  },
  {
    title: 'A conversation focused on you',
    detail: 'Choose a mentor and a session that fits the question you want to talk through.',
    Icon: Chat,
  },
  {
    title: 'Clear session details up front',
    detail: 'Each mentor sets their session format, duration, and price for you to review.',
    Icon: Check,
  },
  {
    title: 'Guidance you can return to',
    detail: 'After the session, your workspace keeps mentor-shared notes and next steps together.',
    Icon: DocumentText,
  },
];

function mentorDuration(mentor: DirectoryMentor): string | null {
  const minutes = mentor.gigs?.[0]?.duration_minutes;
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr`;
}

function mentorPrice(mentor: DirectoryMentor): string | null {
  const price = mentor.starting_price_inr;
  return price == null ? null : `From ${formatInr(price)}`;
}

function mentorSpecialty(mentor: DirectoryMentor): string | null {
  return mentor.expertise?.[0]?.trim() || mentor.segments[0]?.name || null;
}

function mentorIntro(mentor: DirectoryMentor): string | null {
  return mentor.headline?.trim() || mentor.about?.trim() || null;
}

/**
 * The availability date is resolved in the viewer's own timezone, exactly as
 * the directory resolves it, so "today" on this card means the same day it
 * means on the page the visitor is sent to.
 */
function getTodayString(timezone: string | null | undefined): string {
  return getDateStringInTimezone(new Date(), timezone || 'Asia/Kolkata');
}

const MentorPortrait: React.FC<{
  name: string;
  src?: string | null;
  className: string;
  priority?: boolean;
  variant?: 'feature' | 'compact';
}> = ({ name, src, className, priority = false, variant = 'feature' }) => {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const showImage = Boolean(src && failedSource !== src);
  const initials = getInitials(name);

  return (
    <span className={`sk-ref-person ${className}`} aria-hidden={showImage ? undefined : true}>
      {showImage ? (
        <img
          src={src ?? undefined}
          alt=""
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          onError={() => setFailedSource(src ?? null)}
        />
      ) : (
        <span className="sk-ref-person__fallback" aria-hidden="true">
          <User className="sk-ref-person__icon" size={22} weight="Outline" aria-hidden="true" />
          <span className="sk-ref-person__initials">{initials}</span>
        </span>
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
};

const MentorDetails: React.FC<{
  featured: FeaturedMentor;
  onOpen: (mentor: DirectoryMentor) => void;
  variant: 'feature' | 'compact';
}> = ({ featured, onOpen, variant }) => {
  const { mentor, availability } = featured;
  const specialty = mentorSpecialty(mentor);
  const intro = mentorIntro(mentor);
  const duration = mentorDuration(mentor);
  const price = mentorPrice(mentor);
  const today = getTodayString(mentor.timezone);
  const availabilityLabel =
    availability?.state === 'available' && availability.nextLocalStartTime
      ? formatNextAvailableLabel(null, availability.nextLocalStartTime, today)
      : null;

  return (
    <button
      className={`sk-ref-mentor${variant === 'feature' ? ' sk-ref-mentor--feature' : ' sk-ref-mentor--compact'}`}
      type="button"
      onClick={() => onOpen(mentor)}
      aria-label={`View ${mentor.full_name}’s profile`}
    >
      <MentorPortrait
        name={mentor.full_name}
        src={mentor.avatar_url}
        className="sk-ref-mentor__portrait"
        variant={variant}
      />
      <span className="sk-ref-mentor__content">
        {specialty && <span className="sk-ref-mentor__specialty">{specialty}</span>}
        <strong>{mentor.full_name}</strong>
        {intro && <span className="sk-ref-mentor__bio">{intro}</span>}
        <span className="sk-ref-mentor__meta">
          {duration && <span>{duration}</span>}
          {price && <span>{price}</span>}
          {availabilityLabel && <span>{availabilityLabel}</span>}
        </span>
        <span className="sk-ref-mentor__link">
          View mentor <ArrowRight size={18} weight="Outline" aria-hidden="true" />
        </span>
      </span>
    </button>
  );
};

export const LandingPageNew: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const { navigate } = useNavigation();
  const reduceMotion = useReducedMotion() === true;
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);

  const {
    segments,
    isLoading: isLoadingSegments,
    error: segmentError,
    reload: reloadSegments,
  } = useActiveSegments();

  const {
    mentors: featuredMentors,
    isLoading: isLoadingMentors,
    hasError: hasMentorError,
    reload: reloadMentors,
  } = useFeaturedMentors();

  const findMentorPath = isAuthenticated ? '/seeker' : '/auth/signup';
  const directoryPath = mentorDirectoryPath();

  // Headline the feature slot with a mentor who actually has a photo so that
  // photography stays the primary visual; preserve database order otherwise.
  const featuredHero = featuredMentors.find((f) => Boolean(f.mentor.avatar_url)) ?? featuredMentors[0];
  const supporting = featuredMentors.filter((f) => f.mentor.id !== featuredHero?.mentor.id).slice(0, 3);

  useEffect(() => {
    const updateScrollState = () => {
      const scrollTop = window.scrollY;
      setIsScrolled(scrollTop > 56);
      setShowBackToTop(scrollTop > 620);
    };

    updateScrollState();
    window.addEventListener('scroll', updateScrollState, { passive: true });
    return () => window.removeEventListener('scroll', updateScrollState);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [menuOpen]);

  const go = (path: string) => {
    setMenuOpen(false);
    navigate(path);
  };

  const scrollToTop = (event?: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
    event?.preventDefault();
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  const openSegment = (segment: Segment) => go(segmentLandingPath({ segmentSlug: segment.slug }));

  const openMentor = (mentor: DirectoryMentor) => go(
    isAuthenticated
      ? mentorProfilePath({ mentorId: mentor.id, origin: 'mentor-list' })
      : findMentorPath
  );

  return (
    <div className="sk-ref" id="top">
      <a className="sk-ref__skip" href="#main">Skip to content</a>

      <header className={`sk-ref-nav${isScrolled ? ' is-scrolled' : ''}`}>
        <div className="sk-ref-nav__inner sk-ref__wrap">
          <a className="sk-ref-brand" href="#top" onClick={scrollToTop} aria-label="Suggest Key, home">
            <img src="/logo.png" width="96" height="96" alt="" />
            <img src="/name.png" width="431" height="72" alt="Suggest Key" />
          </a>

          <nav
            id="main-navigation"
            className={`sk-ref-nav__links${menuOpen ? ' is-open' : ''}`}
            aria-label="Main navigation"
          >
            <a href="#top" onClick={scrollToTop}>Home</a>
            <a href="#mentors" onClick={() => setMenuOpen(false)}>Explore Mentors</a>
            <a href="#how-it-works" onClick={() => setMenuOpen(false)}>How It Works</a>
            <a href="#why" onClick={() => setMenuOpen(false)}>Why Suggest Key</a>
            <button className="sk-ref-nav__signin" type="button" onClick={() => go('/auth/login')}>Sign In</button>
            <button
              className="sk-ref-button sk-ref-button--gold sk-ref-nav__start"
              type="button"
              onClick={() => go(findMentorPath)}
            >
              Get Started <ArrowRight size={17} weight="Outline" aria-hidden="true" />
            </button>
          </nav>

          <button
            className="sk-ref-nav__toggle"
            type="button"
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={menuOpen}
            aria-controls="main-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen
              ? <X size={22} weight="Outline" aria-hidden="true" />
              : <Menu size={22} weight="Outline" aria-hidden="true" />}
          </button>
        </div>
      </header>

<main id="main">
        <section className="sk-ref-hero" aria-labelledby="hero-title">
          <div className="sk-ref-hero__inner sk-ref__wrap">
            <div className="sk-ref-hero__content">
              <motion.h1
                id="hero-title"
                className="sk-ref-hero__title"
                initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.7, delay: reduceMotion ? 0 : 0.1, ease: [0.22, 1, 0.36, 1] }}
              >
                Find the right mentor<br />
                for what you&apos;re<br />
                <em>figuring out.</em>
              </motion.h1>

              <motion.p
                className="sk-ref-hero__summary"
                initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.6, delay: reduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
              >
                Have a question, decision, or challenge you&apos;re working through? Find a mentor whose experience can help you see the next step.
              </motion.p>

              <motion.div
                className="sk-ref-hero__actions"
                initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.6, delay: reduceMotion ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <button
                  className="sk-ref-button sk-ref-button--gold"
                  type="button"
                  onClick={() => go(findMentorPath)}
                >
                  Explore mentors <ArrowRight size={19} weight="Outline" aria-hidden="true" />
                </button>
                <a className="sk-ref-button sk-ref-button--outline" href="#how-it-works">
                  How it works <ArrowRight size={18} weight="Outline" aria-hidden="true" />
                </a>
              </motion.div>

              <motion.div
                className="sk-ref-hero__indicators"
                initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.6, delay: reduceMotion ? 0 : 0.4, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="sk-ref-hero__indicator">
                  <ShieldCheck size={18} weight="Outline" aria-hidden="true" style={{ color: 'var(--sk-brand-gold)' }} />
                  <div>
                    <strong>Reviewed mentor profiles</strong>
                  </div>
                </div>
                <div className="sk-ref-hero__indicator">
                  <MessageCircle size={18} weight="Outline" aria-hidden="true" style={{ color: 'var(--sk-brand-gold)' }} />
                  <div>
                    <strong>Focused 1:1 sessions</strong>
                  </div>
                </div>
                <div className="sk-ref-hero__indicator">
                  <Calendar size={18} weight="Outline" aria-hidden="true" style={{ color: 'var(--sk-brand-gold)' }} />
                  <div>
                    <strong>Clear session details</strong>
                  </div>
                </div>
              </motion.div>
            </div>

            <div className="sk-ref-hero__visual" aria-hidden="true">
              <img
                className="sk-ref-hero__art"
                src="/assets/landing/hero.png"
                alt=""
                loading="eager"
                fetchPriority="high"
                decoding="async"
              />
              <div className="sk-ref-hero__scrim" />
              <div className="sk-ref-hero__floating-pills" aria-hidden="true">
                {segments.slice(0, 3).map((segment, index) => (
                  <motion.span
                    key={segment.id}
                    className="sk-ref-hero__pill"
                    initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: reduceMotion ? 0 : 0.5, delay: reduceMotion ? 0 : 0.5 + index * 0.12, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <Search size={14} weight="Outline" aria-hidden="true" />
                    {segment.name}
                  </motion.span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="sk-ref-explore sk-ref__wrap" id="explore" aria-labelledby="explore-title">
          <div className="sk-ref-explore__intro">
            <h2 id="explore-title">What are you figuring out?</h2>
            <p>Begin with an area that feels close to your question. Then explore the people who can help.</p>
            <a className="sk-ref-text-link" href={directoryPath} onClick={(event) => { event.preventDefault(); go(directoryPath); }}>
              Browse all mentors <ArrowRight size={18} weight="Outline" aria-hidden="true" />
            </a>
          </div>

          {isLoadingSegments ? (
            <div className="sk-ref-segment-skeleton" role="status" aria-label="Loading mentorship areas">
              {Array.from({ length: 4 }, (_, index) => <span key={index} />)}
            </div>
          ) : segmentError ? (
            <div className="sk-ref-state sk-ref-state--error" role="alert">
              <p>Mentorship areas aren’t available just now.</p>
              <button type="button" onClick={reloadSegments}>Try again</button>
            </div>
          ) : segments.length > 0 ? (
            <div className="sk-ref-segments">
              {segments.map((segment) => (
                <button
                  className="sk-ref-segment"
                  key={segment.id}
                  type="button"
                  onClick={() => openSegment(segment)}
                  aria-label={`Explore ${segment.name} mentors`}
                >
                  <span className="sk-ref-segment__icon" aria-hidden="true">
                    <Search size={21} weight="Outline" />
                  </span>
                  <span className="sk-ref-segment__copy">
                    <strong>{segment.name}</strong>
                    {segment.description && <span>{segment.description}</span>}
                  </span>
                  <ArrowRight size={19} weight="Outline" aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <div className="sk-ref-state">
              <p>Mentorship areas will appear here as they become available.</p>
              <button type="button" onClick={() => go(directoryPath)}>Browse mentors</button>
            </div>
          )}
        </section>

        <section className="sk-ref-process" id="how-it-works" aria-labelledby="process-title">
          <div className="sk-ref__wrap">
            <div className="sk-ref-process__head">
              <h2 id="process-title">
                From a question
                <br />
                to a next step.
              </h2>
              <p>A straightforward path to the conversation you came for.</p>
            </div>

            <motion.ol
              className="sk-ref-journey"
              variants={journeyVariants.container}
              initial={reduceMotion ? false : 'hidden'}
              whileInView={reduceMotion ? undefined : 'show'}
              viewport={reduceMotion ? undefined : { once: true, amount: 0.3 }}
            >
              {steps.map(({ number, title, detail, Icon }, index) => (
                <React.Fragment key={number}>
                  <motion.li
                    className="sk-ref-journey__step"
                    aria-current={index === 0 ? 'step' : undefined}
                    variants={journeyVariants.node}
                  >
                    <div className="sk-ref-journey__node" aria-hidden="true">
                      <span className="sk-ref-journey__number">{number}</span>
                      <span className="sk-ref-journey__icon">
                        <Icon size={23} weight={index === 0 ? 'Filled' : 'Outline'} />
                      </span>
                    </div>
                    <div className="sk-ref-journey__content">
                      <h3>{title}</h3>
                      <p>{detail}</p>
                    </div>
                  </motion.li>
                  {index < steps.length - 1 && (
                    <motion.li className="sk-ref-journey__connector" variants={journeyVariants.connector} aria-hidden="true">
                      <span className="sk-ref-journey__track" />
                    </motion.li>
                  )}
                </React.Fragment>
              ))}
            </motion.ol>
          </div>
        </section>

        <section className="sk-ref-mentors sk-ref__wrap" id="mentors" aria-labelledby="mentors-title">
          <div className="sk-ref-mentors__head">
            <div>
              <p className="sk-ref-mentors__eyebrow">MEET THE MENTORS</p>
              <h2 id="mentors-title">People you can talk to.</h2>
              <p>Real mentor profiles, with session details to help you find the right fit.</p>
            </div>
            <button className="sk-ref-text-link" type="button" onClick={() => go(directoryPath)}>
              Browse all mentors <ArrowRight size={18} weight="Outline" aria-hidden="true" />
            </button>
          </div>

          {isLoadingMentors ? (
            <div className="sk-ref-mentor-skeleton" role="status" aria-label="Loading mentor profiles">
              <div className="sk-ref-mentor-skeleton__feature">
                <span />
                <div><span /><span /><span /><span /></div>
              </div>
              <div className="sk-ref-mentor-skeleton__list">
                {Array.from({ length: 3 }, (_, index) => <span key={index} />)}
              </div>
            </div>
          ) : hasMentorError ? (
            <div className="sk-ref-state sk-ref-state--error" role="alert">
              <p>Mentor profiles aren’t available just now.</p>
              <button type="button" onClick={reloadMentors}>Try again</button>
            </div>
          ) : featuredMentors.length > 0 && featuredHero ? (
            <div className={`sk-ref-mentor-showcase${supporting.length === 0 ? ' is-solo' : ''}`}>
              <MentorDetails featured={featuredHero} onOpen={openMentor} variant="feature" />
              {supporting.length > 0 && (
                <div className="sk-ref-mentor-showcase__list">
                  {supporting.map((featured) => (
                    <MentorDetails
                      featured={featured}
                      key={featured.mentor.id}
                      onOpen={openMentor}
                      variant="compact"
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="sk-ref-state">
              <p>Mentor profiles will appear here as they become available.</p>
              <a href="#explore">Explore mentorship areas</a>
            </div>
          )}
        </section>

        <section className="sk-ref-why" id="why" aria-labelledby="why-title">
          <div className="sk-ref-why__inner sk-ref__wrap">
            <div className="sk-ref-why__intro">
              <h2 id="why-title">Guidance grounded in real experience.</h2>
              <p>Suggest Key is built around one clear idea: the right conversation can help you see what to do next.</p>
            </div>
            <div className="sk-ref-reasons">
              {principles.map(({ title, detail, Icon }) => (
                <article className="sk-ref-reason" key={title}>
                  <span className="sk-ref-reason__icon" aria-hidden="true">
                    <Icon size={22} weight="Outline" />
                  </span>
                  <div>
                    <h3>{title}</h3>
                    <p>{detail}</p>
                  </div>
                  <Check className="sk-ref-reason__check" size={18} weight="Outline" aria-hidden="true" />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="sk-ref-faq" id="faq" aria-labelledby="faq-title">
          <div className="sk-ref-faq__inner sk-ref__wrap">
            <div className="sk-ref-faq__intro">
              <h2 id="faq-title">A few things worth knowing.</h2>
              <p>Practical details, before you choose a mentor.</p>
            </div>
            <div className="sk-ref-faq__list">
              {FAQ_ITEMS.map((item, index) => {
                const expanded = openFaq === index;
                const answerId = `landing-faq-answer-${index}`;
                return (
                  <article className={`sk-ref-faq__item${expanded ? ' is-open' : ''}`} key={item.question}>
                    <h3>
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={answerId}
                        onClick={() => setOpenFaq(expanded ? null : index)}
                      >
                        <span>{item.question}</span>
                        <Plus size={20} weight="Outline" aria-hidden="true" />
                      </button>
                    </h3>
                    <motion.div
                      id={answerId}
                      className="sk-ref-faq__answer"
                      aria-hidden={!expanded}
                      initial={false}
                      animate={{ height: expanded ? 'auto' : 0, opacity: expanded ? 1 : 0 }}
                      transition={{ duration: reduceMotion ? 0 : 0.22, ease: 'easeOut' }}
                    >
                      <p>{item.answer}</p>
                    </motion.div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="sk-ref-cta" aria-labelledby="cta-title">
          <div className="sk-ref-cta__inner sk-ref__wrap">
            <div>
              <h2 id="cta-title">Ready to talk it through?</h2>
              <p>Explore mentor profiles and choose a session that feels right for you.</p>
            </div>
            <button
              className="sk-ref-button sk-ref-button--gold"
              type="button"
              onClick={() => go(findMentorPath)}
            >
              Find a mentor <ArrowRight size={19} weight="Outline" aria-hidden="true" />
            </button>
          </div>
        </section>
      </main>

      <footer className="sk-ref-footer">
        <div className="sk-ref-footer__main sk-ref__wrap">
          <div className="sk-ref-footer__brand">
            <a className="sk-ref-brand" href="#top" onClick={scrollToTop} aria-label="Suggest Key, back to top">
              <img src="/logo.png" width="96" height="96" alt="" loading="lazy" />
              <img src="/name.png" width="431" height="72" alt="Suggest Key" loading="lazy" />
            </a>
            <p>Find a mentor for the question you’re carrying.</p>
            <a href="mailto:hello@suggestkey.in">hello@suggestkey.in</a>
          </div>
          <nav aria-label="Explore">
            <h2>Explore</h2>
            <a href={directoryPath} onClick={(event) => { event.preventDefault(); go(directoryPath); }}>All mentors</a>
            <a href="#explore">Mentorship areas</a>
            <a href="#how-it-works">How it works</a>
            <a href="#why">Why Suggest Key</a>
          </nav>
          <nav aria-label="For mentors">
            <h2>For mentors</h2>
            <a href="/mentor/signup" onClick={(event) => { event.preventDefault(); go('/mentor/signup'); }}>Become a Mentor</a>
          </nav>
          <nav aria-label="Help and account">
            <h2>Help &amp; account</h2>
            <a href="/seeker/support" onClick={(event) => { event.preventDefault(); go('/seeker/support'); }}>Support</a>
            <a href="/auth/login" onClick={(event) => { event.preventDefault(); go('/auth/login'); }}>Sign in</a>
            <a href="mailto:hello@suggestkey.in?subject=Privacy%20policy%20request">Privacy</a>
            <a href="mailto:hello@suggestkey.in?subject=Terms%20of%20service%20request">Terms</a>
          </nav>
        </div>
        <div className="sk-ref-footer__base sk-ref__wrap">
          <span>© {new Date().getFullYear()} Suggest Key</span>
          <span>Thoughtful guidance, one conversation at a time.</span>
        </div>
      </footer>

      <AnimatePresence>
        {showBackToTop && (
          <motion.button
            className="sk-ref-back-to-top"
            type="button"
            aria-label="Back to top"
            onClick={() => scrollToTop()}
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: 10 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
          >
            <ArrowUp size={21} weight="Outline" aria-hidden="true" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
};

export default LandingPageNew;
