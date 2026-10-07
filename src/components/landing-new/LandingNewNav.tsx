import React from 'react';
import { cn } from '@/src/lib/utils';

interface LandingNewNavProps {
  findMentorPath: string;
  onNavigate: (path: string) => void;
}

export const LandingNewNav: React.FC<LandingNewNavProps> = ({ findMentorPath, onNavigate }) => {
  const navLinks = [
    { label: 'Explore Mentors', href: '/seeker' },
    { label: 'How It Works', href: '#how-it-works' },
    { label: 'Why Suggest Key', href: '#why' },
  ];

  return (
    <nav className="editorial-nav" role="navigation" aria-label="Main navigation">
      <div className="editorial-nav__inner">
        <a href="/" className="editorial-nav__brand" aria-label="Suggest Key Home">
          Suggest Key
        </a>

        <div className="editorial-nav__links" role="menubar">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="editorial-nav__link"
              role="menuitem"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="editorial-nav__actions">
          <button
            onClick={() => onNavigate('/auth/login')}
            className="editorial-btn-outline"
            style={{ padding: '12px 16px', fontSize: '12px' }}
          >
            Sign In
          </button>
          <button
            onClick={() => onNavigate(findMentorPath)}
            className="editorial-btn-primary"
            style={{ padding: '12px 16px', fontSize: '12px' }}
          >
            Get Started
          </button>
        </div>
      </div>
    </nav>
  );
};