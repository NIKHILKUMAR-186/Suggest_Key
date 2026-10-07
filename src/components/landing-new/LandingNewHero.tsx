import React from 'react';
import { cn } from '@/src/lib/utils';

interface LandingNewHeroProps {
  onFindMentor: () => void;
}

export const LandingNewHero: React.FC<LandingNewHeroProps> = ({ onFindMentor }) => {
  return (
    <section className="editorial-section" aria-labelledby="hero-heading">
      <div className="editorial-section__inner" style={{ position: 'relative' }}>
        {/* Subtle grid pattern */}
        <div className="editorial-grid" aria-hidden="true" />

        {/* Spotlight */}
        <div className="editorial-spotlight" aria-hidden="true" />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '96px', alignItems: 'center', minHeight: '70vh' }}>
          {/* Left: Typography */}
          <div className="editorial-container--left" style={{ maxWidth: '560px' }}>
            <p className="editorial-caption" style={{ color: 'var(--editorial-accent)', textTransform: 'uppercase', letterSpacing: '0.22em', marginBottom: '24px' }}>
              Find your mentor
            </p>
            <h1 id="hero-heading" className="editorial-display" style={{ 
              color: 'var(--editorial-charcoal)', 
              marginBottom: '32px',
              lineHeight: '0.88'
            }}>
              Find the right mentor<br />
              <span style={{ color: 'var(--editorial-accent)' }}>for what you're figuring out.</span>
            </h1>
            <p className="editorial-body" style={{ 
              color: 'var(--editorial-muted)', 
              marginBottom: '40px',
              maxWidth: '480px'
            }}>
              One focused conversation can change what comes next. Connect with vetted mentors for 1:1 guidance on career, relationships, health, and more.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center' }}>
              <button
                onClick={onFindMentor}
                className="editorial-btn-primary"
                style={{ padding: '20px 32px', fontSize: '16px' }}
              >
                Find Your Mentor
              </button>
              <button
                onClick={() => onFindMentor()}
                className="editorial-btn-outline"
                style={{ padding: '20px 32px', fontSize: '16px' }}
              >
                Explore All Mentors
              </button>
            </div>
          </div>

          {/* Right: Human Image */}
          <div className="editorial-image" style={{ 
            aspectRatio: '4/5', 
            borderRadius: 'var(--editorial-radius-asymmetric) var(--editorial-radius-btn) var(--editorial-radius-btn) var(--editorial-radius-asymmetric)',
            backgroundColor: 'var(--editorial-charcoal)',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: '0 1px 2px rgba(31, 16, 55, 0.08), 0 24px 48px -22px rgba(31, 16, 55, 0.32)'
          }}>
            <div style={{ 
              width: '100%', 
              height: '100%', 
              backgroundImage: 'linear-gradient(135deg, rgba(31, 16, 55, 0.86) 0%, rgba(31, 16, 55, 0.76) 100%), url("/assets/landing/seeker-hero.svg")',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }} aria-label="Mentor guidance illustration" role="img" />

            <div style={{
              position: 'absolute',
              left: '24px',
              bottom: '24px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 16px',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(247, 210, 67, 0.18)',
              borderRadius: '999px',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 10px 28px -18px rgba(0, 0, 0, 0.7)'
            }}>
              <span style={{
                width: '12px',
                height: '12px',
                borderRadius: '999px',
                background: 'var(--editorial-accent)',
                display: 'inline-block',
                boxShadow: '0 0 0 5px rgba(247, 210, 67, 0.22)'
              }} aria-hidden="true" />
              <span style={{
                color: 'var(--editorial-on-canvas)',
                fontSize: '12px',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                fontWeight: 700
              }}>
                1:1 guidance
              </span>
            </div>
            {/* Decorative accent bar */}
            <div style={{ 
              position: 'absolute', 
              bottom: 0, 
              left: 0, 
              right: 0, 
              height: '6px', 
              background: 'var(--editorial-accent)' 
            }} />
          </div>
        </div>
      </div>
    </section>
  );
};