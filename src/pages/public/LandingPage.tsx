import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { useActiveSegments } from '@/src/hooks/useActiveSegments';
import { useMentorDirectory } from '@/src/hooks/useMentorDirectory';
import { mentorDirectoryPath, mentorProfilePath, segmentLandingPath } from '@/src/lib/mentorNav';
import type { DirectoryMentor } from '@/src/types/database';
import { MagneticButton, ProcessProgress, Reveal, TiltCard } from '@/src/components/landing/motion';
import { landingMotion, useReducedMotion } from '@/src/components/landing/motion';
import { SuperrNav } from '@/src/components/landing/SuperrNav';
import { SuperrHero } from '@/src/components/landing/SuperrHero';
import { HandArrow, StickerSprout } from '@/src/components/landing/SuperrStickers';
import { mentorMeta } from '@/src/components/landing/mentorMeta';
import './LandingPage.css';

const steps = [
  ['01', 'Discover', 'Start with the question or area that brought you here.'],
  ['02', 'Choose', 'Find a person whose lived experience fits the moment.'],
  ['03', 'Book', 'Pick a session and a time that work for you.'],
  ['04', 'Talk', 'Have a focused conversation and leave with a next step.'],
] as const;

const faqs = [
  ['What is a mentorship session?', 'A private 1:1 conversation with someone who has practical experience in the area you are navigating. Bring a real question, decision, or challenge.'],
  ['How does booking work?', 'Choose an area, review mentor profiles and session details, then select a time and complete the booking flow.'],
  ['When do I receive the meeting link?', 'After your booking is confirmed, the mentor adds the meeting details. You will see the link in your booking and receive the relevant notification.'],
  ['What happens after the session?', 'You can revisit your session workspace for notes, takeaways, and next steps shared by your mentor.'],
] as const;

function Portrait({ mentor, large = false }: { mentor: DirectoryMentor; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`landing-portrait${large ? ' landing-portrait--large' : ''}`}>
      {mentor.avatar_url && !failed ? (
        <img src={mentor.avatar_url} alt="" loading={large ? 'eager' : 'lazy'} onError={() => setFailed(true)} />
      ) : (
        <UserRound aria-hidden="true" />
      )}
      <span className="sr-only">{mentor.full_name}</span>
    </span>
  );
}

export function LandingPage() {
  const { isAuthenticated } = useAuth();
  const { navigate } = useNavigation();
  const { segments, isLoading: segmentsLoading, error: segmentsError, reload: reloadSegments } = useActiveSegments();
  const { mentors, isLoading: mentorsLoading, isLoadingMore, hasError: mentorsError, hasMore, loadMore, reload: reloadMentors } = useMentorDirectory();
  const [backTop, setBackTop] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const journeyRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const findPath = isAuthenticated ? '/seeker' : '/auth/signup';

  useEffect(() => {
    const onScroll = () => {
      setBackTop(window.scrollY > 620);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const go = (path: string) => {
    navigate(path);
  };
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  };
  const openMentor = (mentor: DirectoryMentor) => go(isAuthenticated
    ? mentorProfilePath({ mentorId: mentor.id, origin: 'mentor-list' })
    : findPath);

  return (
    <div className="landing-page" id="top">
      <a className="landing-skip" href="#main">Skip to content</a>

      <SuperrNav findMentorPath={findPath} />

      <main id="main">
        <SuperrHero featured={mentors.length > 0 ? mentors[0] : null} findMentorPath={findPath} />

        <section className="landing-discovery landing-wrap" id="explore" aria-labelledby="explore-title">
          <Reveal className="landing-section-intro" mode="mask">
            <p className="landing-note">Start somewhere specific</p>
            <h2 id="explore-title">What are you<br /><em>figuring out?</em></h2>
            <p>Choose the part of life or work that feels closest to your question. From there, the right conversation gets easier to find.</p>
            <a className="landing-text-link" href={mentorDirectoryPath()}>Browse all mentors <ArrowRight size={17} /></a>
            {/* The hand-drawn arrow points from the introduction to the
                catalogue it describes — the notebook's own way of saying
                "this way". */}
            <HandArrow className="landing-section-intro__arrow" />
          </Reveal>
          <div className="landing-segments">
            {segmentsLoading && <div className="landing-state" role="status">Reading the current mentorship areas…</div>}
            {segmentsError && <div className="landing-state landing-state--error" role="alert">{segmentsError} <button type="button" onClick={reloadSegments}>Try again</button></div>}
            {!segmentsLoading && !segmentsError && segments.length === 0 && <div className="landing-state">No mentorship areas are available yet.</div>}
            {!segmentsLoading && !segmentsError && segments.slice(0, 3).map((segment, index) => (
              <Reveal as="article" className={`landing-segment landing-segment--${index + 1}`} key={segment.id} mode="lift" delay={index * landingMotion.stagger.compact}>
                <a href={segmentLandingPath({ segmentSlug: segment.slug })}>
                  <span className="landing-segment__index">0{index + 1}</span>
                  <span className="landing-segment__body"><strong>{segment.name}</strong><span>{segment.description || 'Find a focused conversation for the next step.'}</span></span>
                  <ArrowUp className="landing-segment__arrow" />
                </a>
              </Reveal>
            ))}
          </div>
          {/* One sprout, placed by hand rather than on a grid. */}
          <Reveal as="span" className="landing-sticker landing-sticker--sprout" mode="settle" delay={0.2}>
            <StickerSprout />
          </Reveal>
        </section>

        <section ref={journeyRef} className="landing-journey" id="how-it-works" aria-labelledby="journey-title">
          <div className="landing-wrap">
            <Reveal className="landing-journey__heading" mode="mask"><p className="landing-note">A simple route forward</p><h2 id="journey-title">From a question<br /><em>to a next step.</em></h2></Reveal>
            <div className="landing-steps">
              <span className="landing-steps__line" aria-hidden="true" />
              <ProcessProgress target={journeyRef} />
              {steps.map(([number, title, detail], index) => <Reveal as="article" className="landing-step" key={number} mode="lift" delay={index * landingMotion.stagger.editorial}>
                <span className="landing-step__number">{number}</span><span className="landing-step__dot" aria-hidden="true" />
                <h3>{title}</h3><p>{detail}</p>
              </Reveal>)}
            </div>
            {/* The route ends where the conversation begins. */}
            <Reveal className="landing-journey__next" mode="settle" delay={0.3}>
              <a className="landing-text-link" href={mentorDirectoryPath()}>
                Start the conversation <ArrowRight size={17} />
              </a>
            </Reveal>
          </div>
        </section>

        <section className="landing-mentors landing-wrap" id="mentors" aria-labelledby="mentors-title">
          <Reveal className="landing-section-intro landing-section-intro--wide" mode="mask"><p className="landing-note">The human centre</p><h2 id="mentors-title">Meet mentors<br /><em>who&rsquo;ve been there.</em></h2><p>Real experience. Focused conversations. Practical next steps.</p></Reveal>
          {mentorsLoading && <div className="landing-mentor-state" role="status">Finding mentors for you…</div>}
          {mentorsError && <div className="landing-state landing-state--error" role="alert">Mentors could not be loaded. <button type="button" onClick={reloadMentors}>Try again</button></div>}
          {!mentorsLoading && !mentorsError && mentors.length === 0 && <div className="landing-mentor-state">No mentors are available yet.</div>}
          {!mentorsLoading && !mentorsError && mentors.length > 0 && <Reveal className="landing-mentor-showcase" mode="clip">
            <button className="landing-featured-mentor" type="button" onClick={() => openMentor(mentors[0].mentor)}>
              <Portrait mentor={mentors[0].mentor} large /><span className="landing-featured-mentor__copy"><span className="landing-note">Featured conversation</span><strong>{mentors[0].mentor.full_name}</strong><span>{mentors[0].mentor.headline || mentors[0].mentor.about}</span><small>{mentorMeta(mentors[0]).join(' · ')}</small><span className="landing-text-link">View mentor <ArrowRight size={17} /></span></span>
            </button>
            <div className="landing-supporting-mentors">{mentors.slice(1).map((item) => <TiltCard as="button" className="landing-supporting-mentor" key={item.mentor.id} onClick={() => openMentor(item.mentor)}><Portrait mentor={item.mentor} /><span><strong>{item.mentor.full_name}</strong><small>{item.mentor.headline || item.mentor.segments[0]?.name}</small><small>{mentorMeta(item).slice(1, 3).join(' · ')}</small></span><ArrowRight size={17} /></TiltCard>)}</div>
          </Reveal>}
          {hasMore && !mentorsLoading && <button className="landing-load-more" type="button" onClick={loadMore} disabled={isLoadingMore}>{isLoadingMore ? 'Loading more mentors…' : 'Load more mentors'} <ArrowRight size={17} /></button>}
        </section>

        <section className="landing-why" id="why" aria-labelledby="why-title">
          <Reveal className="landing-wrap landing-why__inner" mode="mask"><div><p className="landing-note">A better kind of guidance</p><h3 id="why-title">Guidance grounded in<br /><em>real experience.</em></h3></div>          <div className="landing-principles">{[
            { number: '01', text: 'Profiles reviewed before they go live', Icon: ShieldCheck },
            { number: '02', text: 'A conversation focused on you', Icon: MessageCircle },
            { number: '03', text: 'Clear session details upfront', Icon: Check },
            { number: '04', text: 'Guidance you can return to', Icon: Sparkles },
          ].map(({ number, text, Icon }, index) => <Reveal as="article" className="landing-principle" key={number} mode="settle" delay={index * landingMotion.stagger.editorial}><span>{number}</span><Icon size={18} /><strong>{text}</strong></Reveal>)}</div></Reveal>
        </section>

        <section className="landing-faq landing-wrap" aria-labelledby="faq-title"><div className="landing-section-intro"><p className="landing-note">Before you begin</p><h2 id="faq-title">A few things<br /><em>worth knowing.</em></h2><p>A good conversation starts with knowing what to expect.</p></div><div className="landing-faq__list">{faqs.map(([question, answer], index) => { const open = openFaq === index; const answerId = `landing-faq-answer-${index}`; const questionId = `landing-faq-question-${index}`; return <div className={`landing-faq__item${open ? ' is-open' : ''}`} key={question}><button id={questionId} type="button" aria-expanded={open} aria-controls={answerId} onClick={() => setOpenFaq(open ? null : index)}><span>{question}</span><ChevronDown size={19} aria-hidden="true" /></button><AnimatePresence initial={false}>{open && <motion.div id={answerId} className="landing-faq__answer" role="region" aria-labelledby={questionId} initial={reduceMotion ? false : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={reduceMotion ? undefined : { height: 0, opacity: 0 }} transition={{ duration: reduceMotion ? 0 : landingMotion.duration.transition, ease: landingMotion.ease }}><p>{answer}</p></motion.div>}</AnimatePresence></div>; })}</div></section>
      </main>

      <footer className="landing-footer"><Reveal className="landing-wrap" mode="mask"><div className="landing-footer__lead"><p className="landing-note">The next step can start here</p><h2>Ready to talk<br /><em>it through?</em></h2><MagneticButton className="landing-button landing-button--gold" onClick={() => go(findPath)}>Find a mentor <ArrowRight size={17} /></MagneticButton></div><div className="landing-footer__links"><div><strong>Explore</strong><a href={mentorDirectoryPath()}>All mentors</a><a href="#explore">Mentorship areas</a><a href="#how-it-works">How it works</a><a href="#why">Why Suggest Key</a></div><div><strong>For mentors</strong><a href="/mentor/signup">Become a Mentor</a></div><div><strong>Help & account</strong><a href="/seeker/support">Support</a><button type="button" onClick={() => go('/auth/login')}>Sign in</button></div></div><div className="landing-footer__base"><span>© Suggest Key</span><a href="#top" onClick={(event) => { event.preventDefault(); scrollTo('top'); }}>Back to beginning <ArrowUp size={15} /></a></div></Reveal></footer>

      {/* Back to top. It appears only once the visitor is genuinely past the
          first viewport, and it stays a real button with a real label so it is
          usable by keyboard and screen reader alike. */}
      <AnimatePresence>
        {backTop && (
          <motion.button
            className="landing-back-top"
            type="button"
            aria-label="Back to top"
            initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: 10, scale: 0.94 }}
            transition={{ duration: reduceMotion ? 0 : landingMotion.duration.transition, ease: landingMotion.ease }}
            whileHover={reduceMotion ? undefined : { y: -2 }}
            onClick={() => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })}
          >
            <ArrowUp size={18} aria-hidden="true" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

export default LandingPage;
