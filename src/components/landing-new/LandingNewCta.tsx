import React from 'react';
import { cn } from '@/src/lib/utils';

interface LandingNewCtaProps {
  onFindMentor: () => void;
}

export const LandingNewCta: React.FC<LandingNewCtaProps> = ({ onFindMentor }) => {
  return (
    <section className="editorial-section editorial-accent" aria-labelledby="cta-heading">
      <div className="editorial-section__inner">
        {/* Grid pattern */}
        <div className="editorial-grid" aria-hidden="true" />
        
        {/* Spotlight */}
        <div className="editorial-spotlight" aria-hidden="true" />

        <div className="editorial-container" style={{ 
          position: 'relative', 
          zIndex: 1,
          padding: '128px 40px'
        }}>
          <h2 id="cta-heading" className="editorial-display" style={{ 
            color: 'var(--editorial-on-accent)', 
            marginBottom: '32px',
            lineHeight: '0.88',
            textAlign: 'center'
          }}>
            Ready for the conversation<br />
            that changes what comes next?
          </h2>
          
          <p className="editorial-body" style={{ 
            color: 'var(--editorial-on-accent)', 
            opacity: 0.8,
            marginBottom: '48px',
            maxWidth: '560px',
            marginLeft: 'auto',
            marginRight: 'auto',
            textAlign: 'center',
            fontSize: '22px'
          }}>
            One focused session. Real expertise. A practical next step.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'center' }}>
            <button
              onClick={onFindMentor}
              className="editorial-btn-secondary"
              style={{ 
                padding: '20px 40px', 
                fontSize: '16px',
                backgroundColor: 'var(--editorial-charcoal)',
                border: 'none'
              }}
            >
              Find Your Mentor
            </button>
            <button
              onClick={() => onFindMentor()}
              className="editorial-btn-outline"
              style={{ 
                padding: '20px 40px', 
                fontSize: '16px',
                color: 'var(--editorial-on-accent)',
                borderColor: 'var(--editorial-on-accent)'
              }}
            >
              Explore All Mentors
            </button>
          </div>

          {/* Trust indicator */}
          <p className="editorial-caption" style={{ 
            color: 'var(--editorial-on-accent)', 
            opacity: 0.6,
            marginTop: '64px',
            textAlign: 'center',
            textTransform: 'uppercase',
            letterSpacing: '0.22em'
          }}>
            No subscription · Pay per session · Cancel anytime
          </p>
        </div>
      </div>
    </section>
  );
};