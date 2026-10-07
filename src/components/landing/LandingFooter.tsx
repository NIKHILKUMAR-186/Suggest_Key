import React from 'react';
import { useReducedMotion } from 'motion/react';
import { LandingWordmark } from '@/src/components/landing/LandingWordmark';
import { Reveal } from '@/src/components/landing/Reveal';
import { FOOTER_GROUPS, FOOTER_LEGAL, FOOTER_PROMISE } from '@/src/components/landing/landingContent';

/**
 * FOOTER.
 *
 * Carries the routes a visitor is most likely to want next — including the one the
 * page deliberately does not surface higher up, which is where "Become a mentor"
 * lives. A visitor who has not chosen a mentor is not in the market for becoming
 * one, and giving both offers equal weight in the bar would split the only
 * conversion this page has. Here, at the end of the document, the question is live
 * again and the link is free to be there.
 *
 * It continues the brand field from the final call, one step deeper, so the page
 * closes on one continuous dark surface instead of a change of tone at the last
 * screen.
 *
 * THE LINEWORK IS THE ONLY DECORATION.
 *
 * One wide arc across the top of the footer, drawn in the same vocabulary as the
 * hero's connection field and the closing section's converging arcs, so the last
 * thing on the page is drawn rather than boxed. It carries no information and
 * takes no pointer; it exists so the footer does not read as a settings panel
 * bolted onto the bottom of a landing page.
 *
 * In-page entries go through the same scroll handler as the bar, so the anchor
 * scrolls rather than reloading the route — and the scroll honours the visitor's
 * reduced-motion setting, because "smooth" is the one scroll animation on this page
 * a visitor cannot opt out of from where they are.
 */

export interface LandingFooterProps {
  onNavigate: (path: string) => void;
}

export const LandingFooter: React.FC<LandingFooterProps> = ({ onNavigate }) => {
  const reducedMotion = useReducedMotion();
  const behavior: ScrollBehavior = reducedMotion ? 'auto' : 'smooth';
  const currentYear = new Date().getFullYear();

  return (
    <footer className="sk-lg-footer sk-lg-band--deep">
      <svg
        className="sk-lg-footer__linework"
        viewBox="0 0 1440 220"
        fill="none"
        focusable="false"
        aria-hidden="true"
        preserveAspectRatio="xMidYMin slice"
      >
        {/*
          Three arcs of increasing span, all rising out of the bottom-left and
          running off the right edge. None of them closes and none of them is
          labelled, because the footer's only job is to hand over three lists of
          real routes and a year.
        */}
        <path d="M-20 220C240 220 420 96 700 60 960 26 1120 44 1460 8" className="sk-lg-footer__arc" />
        <path d="M-20 220C300 220 520 128 820 96 1080 68 1240 78 1460 52" className="sk-lg-footer__arc sk-lg-footer__arc--2" />
        <path d="M-20 220C360 220 620 168 960 140 1200 120 1320 124 1460 106" className="sk-lg-footer__arc sk-lg-footer__arc--3" />
        <circle cx="700" cy="60" r="3.5" className="sk-lg-footer__node" />
        <circle cx="1120" cy="46" r="2.5" className="sk-lg-footer__node sk-lg-footer__node--2" />
      </svg>

      {/* One reveal for the whole footer: it is chrome, not an argument, and it
          is the last thing on the page, so it settles once and stops. */}
      <Reveal>
        <div className="sk-lg__wrap">
          <div className="sk-lg-footer__grid">
          <div className="sk-lg-footer__brand">
            <a
              href="/"
              onClick={(event) => {
                event.preventDefault();
                /**
                 * The footer only renders on the landing page, so re-navigating to
                 * `/` here would unmount and rebuild the entire page — the catalogue
                 * would refetch, every reveal would replay, and the visitor would
                 * land at the top having watched all of it. This is the same answer
                 * the bar's Home link gives, for the same reason.
                 */
                window.scrollTo({ top: 0, behavior });
              }}
              aria-label="Suggest Key — back to the top of the home page"
            >
              <LandingWordmark size={30} />
            </a>
            <p className="sk-lg-footer__promise">{FOOTER_PROMISE}</p>
          </div>

          {FOOTER_GROUPS.map((group) => (
            <nav key={group.heading} aria-label={group.heading}>
              {/*
                A label, not a document heading. These are 11px tracked caps; a real
                h2 at that size would be a heading the outline advertises and the eye
                cannot find, and the footer follows every section heading on the page
                rather than nesting under one.
              */}
              <p className="sk-lg-footer__heading">{group.heading}</p>
              <ul className="sk-lg-footer__links">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.route}
                      onClick={(event) => {
                        event.preventDefault();
                        if (link.route.startsWith('/#')) {
                          document
                            .getElementById(link.route.slice(2))
                            ?.scrollIntoView({ behavior, block: 'start' });
                          return;
                        }
                        onNavigate(link.route);
                      }}
                    >
                      <span>{link.label}</span>
                      {/*
                        The underline is drawn rather than underlined, so it can
                        grow from the left on approach instead of appearing. Same
                        gesture as the bar's links and the area rows; it is the one
                        repeated motion on the page and it is deliberately the
                        quietest possible one.
                      */}
                      <span className="sk-lg-footer__rule" aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="sk-lg-footer__base">
          <p>
            © {currentYear} Suggest Key. {FOOTER_LEGAL}
          </p>
          <p>Mentorship marketplace · India</p>
        </div>
        </div>
      </Reveal>
    </footer>
  );
};

export default LandingFooter;