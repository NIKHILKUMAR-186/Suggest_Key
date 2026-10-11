import {
  ArrowRightIcon,
  AutismBadgeIcon,
  CalendarIcon,
  CareerBadgeIcon,
  ConfidentialIcon,
  HybridIcon,
  PlayIcon,
  RelationshipBadgeIcon,
  SparkleIcon,
  VerifiedIcon,
} from './NewLandingIcons';
import { useSectionScroll } from './useSectionScroll';

/**
 * NEW LANDING PAGE — HERO BANNER.
 *
 * A conversion of the supplied standalone HTML hero: a deep-purple field with
 * a pill, a display headline, a lede, two actions and a trust row on the left,
 * and three floating category bubbles with connector tails on the right.
 *
 * Only the left column holds real navigation. The right-hand bubbles and the
 * decorative tails are illustrative: they are inert graphics, not links, so
 * the design's visual composition is preserved without inventing destinations
 * or pretending a static bubble is bookable.
 *
 * The layout uses container queries (`cqw`) exactly as the source design does,
 * and collapses to the mobile composition at 1000px.
 */
export interface NewLandingHeroProps {
  /** Where "Book a Session" goes. Resolved by the page from auth state. */
  onBookSession: () => void;
}

/** Connector tails behind the bubbles. Decorative, so hidden from a11y tree. */
function BannerTails() {
  return (
    <svg
      className="nlg-banner__tails"
      viewBox="0 0 1672 941"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d="M1019 234C1020 262 1030 280 1051 292" />
      <path d="M1539 256C1537 282 1525 300 1504 312" />
      <path d="M999 494C1000 520 1010 540 1036 553" />
    </svg>
  );
}

export function NewLandingHero({ onBookSession }: NewLandingHeroProps) {
  const scrollTo = useSectionScroll();

  return (
    <header className="nlg-banner">
      <div className="nlg-banner__wrap">
        <section className="nlg-banner__stage" aria-label="Suggest Key hero">
          <BannerTails />

          <div className="nlg-banner__copy">
            <span className="nlg-banner__pill">
              <SparkleIcon />
              <span>Professional Counselling Services</span>
            </span>

            <h1 className="nlg-banner__title">
              <span>Better Guidance for</span>{' '}
              <span>
                a <em>Healthier, Happier</em> You
              </span>
            </h1>

            <p className="nlg-banner__lead">
              Get expert counselling for relationship issues, autism support,<br></br>
              and career guidance. We&rsquo;re here to listen, understand,<br></br> and
              help you move forward with confidence.
            </p>

            <div className="nlg-banner__cta">
              <button
                type="button"
                className="nlg-banner__btn nlg-banner__btn--primary"
                onClick={onBookSession}
              >
                <CalendarIcon />
                <span>Book a Session</span>
                <ArrowRightIcon className="nlg-banner__arrow" />
              </button>

              <button
                type="button"
                className="nlg-banner__btn nlg-banner__btn--secondary"
                onClick={() => scrollTo('how')}
              >
                <PlayIcon />
                <span>Watch How It Works</span>
              </button>
            </div>

            <div className="nlg-banner__trust">
              <span className="nlg-banner__trust-item">
                <VerifiedIcon />
                <span>
                  Verified
                  <br />
                  Experts
                </span>
              </span>
              <span className="nlg-banner__trust-item">
                <ConfidentialIcon />
                <span>
                  Confidential
                  <br />
                  &amp; Safe
                </span>
              </span>
              <span className="nlg-banner__trust-item">
                <HybridIcon />
                <span>
                  Online &amp;
                  <br />
                  In-Person
                </span>
              </span>
            </div>
          </div>

          <div className="nlg-banner__photo">
            <span className="nlg-banner__bubble nlg-bubble--relationships">
              <span className="nlg-banner__badge nlg-banner__badge--pink">
                <RelationshipBadgeIcon />
              </span>
              <span>
                Relationship
                <br />
                Counselling
              </span>
            </span>
            <span className="nlg-banner__bubble nlg-bubble--career">
              <span className="nlg-banner__badge nlg-banner__badge--yellow">
                <CareerBadgeIcon />
              </span>
              <span>
                Career
                <br />
                Guidance
              </span>
            </span>
            <span className="nlg-banner__bubble nlg-bubble--autism">
              <span className="nlg-banner__badge nlg-banner__badge--teal">
                <AutismBadgeIcon />
              </span>
              <span>
                Autism
                <br />
                Support
              </span>
            </span>
          </div>
        </section>
      </div>
    </header>
  );
}
