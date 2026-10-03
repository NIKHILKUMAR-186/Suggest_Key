import React from 'react';
import { LandingWordmark } from '@/src/components/landing/LandingWordmark';
import { FOOTER_GROUPS, FOOTER_LEGAL, FOOTER_PROMISE } from '@/src/components/landing/landingContent';

/**
 * FOOTER.
 *
 * Carries the routes a visitor is most likely to want next — including the ones
 * the hero does not surface, such as the mentor verification status and support
 * — grouped by who they are for. It continues the brand field from the final
 * call, so the page closes on one continuous dark surface instead of a change of
 * tone at the last screen.
 *
 * In-page entries go through the same navigation handler as everything else, so
 * the anchor scrolls rather than reloading the route.
 */

export interface LandingFooterProps {
  onNavigate: (path: string) => void;
}

export const LandingFooter: React.FC<LandingFooterProps> = ({ onNavigate }) => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="sk-lp-footer sk-lp-on-plum">
      <div className="sk-lp-wrap">
        <div className="sk-lp-footer__grid">
          <div>
            <a
              href="/"
              onClick={(event) => {
                event.preventDefault();
                onNavigate('/');
              }}
              className="inline-flex items-center"
              aria-label="Suggest Key — home"
            >
              <LandingWordmark size={16} />
            </a>
            <p className="mt-5 max-w-[30ch] text-sm leading-relaxed">{FOOTER_PROMISE}</p>
          </div>

          {FOOTER_GROUPS.map((group) => (
            <nav key={group.heading} aria-label={group.heading}>
              {/*
                A label, not a document heading. These are 11px tracked caps; a
                real h2 at that size would be a heading the outline advertises
                and the eye cannot find, and the footer follows every section
                heading on the page rather than nesting under one.
              */}
              <p className="sk-lp-footer__heading">{group.heading}</p>
              <ul className="sk-lp-footer__links">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.route}
                      className="sk-lp-footer__link"
                      onClick={(event) => {
                        if (link.route.startsWith('/#')) {
                          event.preventDefault();
                          document
                            .getElementById(link.route.slice(2))
                            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          return;
                        }
                        event.preventDefault();
                        onNavigate(link.route);
                      }}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="sk-lp-footer__base">
          <p>
            © {currentYear} Suggest Key. {FOOTER_LEGAL}
          </p>
          <p>Mentorship marketplace · India</p>
        </div>
      </div>
    </footer>
  );
};