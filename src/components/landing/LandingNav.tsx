import React from 'react';

interface LandingNavProps {
  findMentorPath: string;
  onNavigate: (path: string) => void;
}

export const LandingNav: React.FC<LandingNavProps> = ({ findMentorPath, onNavigate }) => {
  const navLinks = [
    { label: 'Explore Mentors', href: '/seeker' },
    { label: 'How It Works', href: '#how-it-works' },
    { label: 'Why Suggest Key', href: '#why' },
  ];

  return (
    <nav className="sk-lg-nav" role="navigation" aria-label="Main navigation">
      <div className="sk-lg-nav__inner">
        <a href="/" className="sk-lg-nav__brand" aria-label="Suggest Key Home">
          Suggest Key
        </a>

        <div className="sk-lg-nav__links">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="sk-lg-nav__link"
              onClick={(event) => {
                event.preventDefault();
                onNavigate(link.href);
              }}
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="sk-lg-nav__actions">
          <button
            type="button"
            className="sk-lg-btn sk-lg-btn--ghost"
            onClick={() => onNavigate('/auth/login')}
          >
            Sign In
          </button>
          <button
            type="button"
            className="sk-lg-btn sk-lg-btn--gold"
            onClick={() => onNavigate(findMentorPath)}
          >
            Get Started
          </button>
        </div>
      </div>
    </nav>
  );
};

export default LandingNav;
