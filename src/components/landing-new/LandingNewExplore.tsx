import React from 'react';
import type { Segment } from '@/src/types/database';
import { cn } from '@/src/lib/utils';

interface LandingNewExploreProps {
  segments: Segment[];
  isLoading: boolean;
  error: string | null;
  onOpenArea: (segment: Segment) => void;
}

export const LandingNewExplore: React.FC<LandingNewExploreProps> = ({ 
  segments, 
  isLoading, 
  error, 
  onOpenArea 
}) => {
  if (isLoading) {
    return (
      <section className="editorial-section editorial-charcoal" aria-labelledby="explore-heading">
        <div className="editorial-section__inner">
          <div className="editorial-container" style={{ padding: '96px 40px' }}>
            <div className="editorial-caption" style={{ color: 'var(--editorial-accent)' }}>Loading...</div>
          </div>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="editorial-section editorial-charcoal" aria-labelledby="explore-heading">
        <div className="editorial-section__inner">
          <div className="editorial-container" style={{ padding: '96px 40px' }}>
            <p className="editorial-body" style={{ color: 'var(--editorial-accent)' }}>
              Unable to load mentorship areas. Please try again later.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="editorial-section editorial-charcoal" aria-labelledby="explore-heading">
      <div className="editorial-section__inner">
        <div className="editorial-container" style={{ marginBottom: '64px' }}>
          <p className="editorial-caption" style={{ color: 'var(--editorial-accent)', marginBottom: '16px' }}>
            Explore Mentorship
          </p>
          <h2 id="explore-heading" className="editorial-heading-lg" style={{ color: 'var(--editorial-on-canvas)', marginBottom: '24px' }}>
            Areas where mentors can help
          </h2>
          <p className="editorial-body" style={{ color: 'var(--editorial-muted)' }}>
            Each area connects you with mentors who specialize in that domain. Browse to find the right fit for what you're figuring out.
          </p>
        </div>

        {/* Editorial segment grid - asymmetric layout */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
          gap: '24px',
          maxWidth: '1200px',
          margin: '0 auto'
        }}>
          {segments.map((segment, index) => (
            <article
              key={segment.id}
              className="editorial-card editorial-card--asymmetric"
              onClick={() => onOpenArea(segment)}
              style={{ 
                cursor: 'pointer',
                transition: 'transform 200ms ease, box-shadow 200ms ease',
                display: 'flex',
                flexDirection: 'column',
                minHeight: '200px',
                position: 'relative',
                overflow: 'hidden'
              }}
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenArea(segment); }}}
              role="button"
              aria-label={`Explore ${segment.name} mentors`}
            >
              {/* Accent bar at top */}
              <div style={{ 
                height: '4px', 
                background: 'var(--editorial-accent)',
                width: index % 2 === 0 ? '60%' : '40%',
                marginLeft: index % 2 === 0 ? 0 : 'auto'
              }} />
              
              <div style={{ 
                flex: 1, 
                display: 'flex', 
                flexDirection: 'column', 
                justifyContent: 'space-between',
                padding: '32px'
              }}>
                <div>
                  <h3 className="editorial-heading-sm" style={{ 
                    color: 'var(--editorial-charcoal)', 
                    marginBottom: '12px',
                    lineHeight: '1.2'
                  }}>
                    {segment.name}
                  </h3>
                  {segment.description && (
                    <p className="editorial-body-sm" style={{ color: 'var(--editorial-muted)' }}>
                      {segment.description}
                    </p>
                  )}
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '24px' }}>
                  <span className="editorial-caption" style={{ color: 'var(--editorial-accent)', textTransform: 'uppercase' }}>
                    View mentors
                  </span>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--editorial-accent)' }}>
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </article>
          ))}
        </div>

        {/* CTA to view all */}
        <div className="editorial-container" style={{ marginTop: '64px' }}>
          <button className="editorial-ghost-link" style={{ fontSize: '16px', padding: '8px 0' }}>
            View all mentorship areas
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
};