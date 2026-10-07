import React from 'react';
import { cn } from '@/src/lib/utils';

interface LandingNewFooterProps {
  onNavigate: (path: string) => void;
}

const footerColumns = [
  {
    heading: 'Explore',
    links: [
      { label: 'All Mentors', href: '/mentors' },
      { label: 'Mentorship Areas', href: '/seeker' },
      { label: 'How It Works', href: '#how-it-works' },
      { label: 'Why Suggest Key', href: '#why' },
    ]
  },
  {
    heading: 'For Seekers',
    links: [
      { label: 'Find a Mentor', href: '/seeker' },
      { label: 'Book a Session', href: '/seeker' },
      { label: 'My Bookings', href: '/seeker/bookings' },
      { label: 'Session Workspaces', href: '/seeker/workspace' },
    ]
  },
  {
    heading: 'For Mentors',
    links: [
      { label: 'Become a Mentor', href: '/mentor/signup' },
      { label: 'Mentor Dashboard', href: '/mentor' },
      { label: 'Availability', href: '/mentor/availability' },
      { label: 'Earnings', href: '/mentor/bookings' },
    ]
  },
  {
    heading: 'Company',
    links: [
      { label: 'About Us', href: '/about' },
      { label: 'Careers', href: '/careers' },
      { label: 'Press', href: '/press' },
      { label: 'Contact', href: '/contact' },
    ]
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
      { label: 'Cookie Policy', href: '/cookies' },
      { label: 'Security', href: '/security' },
    ]
  },
];

export const LandingNewFooter: React.FC<LandingNewFooterProps> = ({ onNavigate }) => {
  const handleClick = (path: string, e: React.MouseEvent) => {
    if (path.startsWith('#')) {
      // Let anchor links work naturally
      return;
    }
    e.preventDefault();
    onNavigate(path);
  };

  return (
    <footer className="editorial-footer" role="contentinfo">
      <div className="editorial-footer__inner">
        <div className="editorial-footer__grid">
          {/* Brand column */}
          <div className="editorial-footer__brand">
            <a href="/" className="editorial-footer__logo" aria-label="Suggest Key Home">
              Suggest Key
            </a>
            <p className="editorial-footer__tagline">
              Find the right mentor for what you're figuring out. One focused conversation at a time.
            </p>
          </div>

          {/* Navigation columns */}
          {footerColumns.map((column) => (
            <div key={column.heading} className="editorial-footer__column">
              <h3 className="editorial-footer__heading">{column.heading}</h3>
              <div className="editorial-footer__links">
                {column.links.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    className="editorial-footer__link"
                    onClick={(e) => handleClick(link.href, e)}
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="editorial-footer__base">
          <p>&copy; {new Date().getFullYear()} Suggest Key. All rights reserved.</p>
          <div style={{ display: 'flex', gap: '24px' }}>
            <a href="/privacy" className="editorial-footer__link" onClick={(e) => handleClick('/privacy', e)}>Privacy</a>
            <a href="/terms" className="editorial-footer__link" onClick={(e) => handleClick('/terms', e)}>Terms</a>
            <a href="/cookies" className="editorial-footer__link" onClick={(e) => handleClick('/cookies', e)}>Cookies</a>
          </div>
        </div>
      </div>
    </footer>
  );
};