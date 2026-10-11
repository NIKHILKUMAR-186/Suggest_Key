import { useNavigation } from '@/src/context/NavigationContext';
import { mentorDirectoryPath } from '@/src/lib/mentorNav';
import { LANDING_SEGMENTS } from '@/src/components/landing/landingSegments';

/**
 * NEW LANDING PAGE — FOOTER.
 *
 * The footer's structural columns carry over from the supplied design. Its
 * links are wired to real routes wherever the app has one — the segment
 * filters, the mentor directory, mentor sign-up and sign-in — so nothing
 * here presents an unavailable destination as though it worked.
 *
 * Links with no route in this application are rendered in a disabled state
 * rather than pointing at `#`, which would look like a live link and then do
 * nothing.
 */

/** Routes that exist in this app, keyed by the design's link label. */
interface FooterLink {
  label: string;
  disabled?: boolean;
}

const SECTIONS: FooterLink[] = LANDING_SEGMENTS.map((segment) => ({
  label: segment.title,
}));

const EXPLORE: FooterLink[] = [
  { label: 'Find an expert' },
  { label: 'Guides & articles', disabled: true },
  { label: 'Ask a question', disabled: true },
  { label: 'Join as an expert' },
];

const COMPANY: FooterLink[] = [
  { label: 'About', disabled: true },
  { label: 'Contact', disabled: true },
  { label: 'Privacy', disabled: true },
  { label: 'Terms', disabled: true },
];

export interface NewLandingFooterProps {
  /** Where "Sign in" goes. */
  onSignIn: () => void;
  /** Where the brand mark returns the visitor to. */
  onHome: () => void;
}

export function NewLandingFooter({ onSignIn, onHome }: NewLandingFooterProps) {
  const { navigate } = useNavigation();

  /** Resolve an enabled link to a real destination. */
  const resolve = (
    column: 'sections' | 'explore' | 'company',
    label: string,
  ): string | null => {
    const segment = LANDING_SEGMENTS.find((item) => item.title === label);
    if (column === 'sections' && segment) return mentorDirectoryPath({ segmentSlug: segment.id });
    if (label === 'Find an expert') return mentorDirectoryPath();
    if (label === 'Join as an expert') return '/mentor/signup';
    return null;
  };

  /** Every row is a real button or a real anchor — never a dead `#` link. */
  const renderLink = (
    column: 'sections' | 'explore' | 'company',
    link: FooterLink,
  ) => {
    const destination = resolve(column, link.label);
    if (link.disabled || destination === null) {
      return (
        <span key={link.label} className="nlg-footer__disabled" aria-disabled="true">
          {link.label}
        </span>
      );
    }
    return (
      <a
        key={link.label}
        href={destination}
        onClick={(event) => {
          event.preventDefault();
          navigate(destination);
        }}
      >
        {link.label}
      </a>
    );
  };

  return (
    <footer className="nlg-footer">
      <div className="nlg-wrap">
        <div className="nlg-footer__grid">
          <div>
            <button type="button" className="nlg-footer__brand" onClick={onHome}>
              suggest key
            </button>
            <p className="nlg-footer__blurb">
              Suggest Key connects you with verified experts for autism support,
              relationship counselling and career guidance across India.
            </p>
            <p>hello@suggestkey.in</p>
            <p>+91 99999 99999</p>
          </div>
          <div>
            <b>Sections</b>
            {SECTIONS.map((link) => renderLink('sections', link))}
          </div>
          <div>
            <b>Explore</b>
            {EXPLORE.map((link) => renderLink('explore', link))}
          </div>
          <div>
            <b>Company</b>
            {COMPANY.map((link) => renderLink('company', link))}
            <button type="button" className="nlg-footer__signin" onClick={onSignIn}>
              Sign in
            </button>
          </div>
        </div>

        <p className="nlg-footer__fine">
          <b>Not an emergency service.</b> Suggest Key connects you with
          independent experts and does not provide medical or crisis care. If you
          or someone else is in immediate danger, call 112. For emotional
          distress, Tele-MANAS is available 24&times;7 at 14416.
          <br />
          <br />
          &copy; 2026 Suggest Key. Ask the Wise.
        </p>
      </div>
    </footer>
  );
}
