import React from 'react';
import type { DirectoryMentor } from '@/src/types/database';
import { cn } from '@/src/lib/utils';

interface LandingNewMentorsProps {
  mentors: DirectoryMentor[];
  isLoading: boolean;
  hasError: boolean;
  onOpenMentor: (mentor: DirectoryMentor) => void;
}

export const LandingNewMentors: React.FC<LandingNewMentorsProps> = ({ 
  mentors, 
  isLoading, 
  hasError, 
  onOpenMentor 
}) => {
  if (isLoading) {
    return (
      <section className="editorial-section" aria-labelledby="mentors-heading">
        <div className="editorial-section__inner">
          <div className="editorial-container" style={{ padding: '96px 40px' }}>
            <div className="editorial-caption" style={{ color: 'var(--editorial-accent)' }}>Loading mentors...</div>
          </div>
        </div>
      </section>
    );
  }

  if (hasError || mentors.length === 0) {
    return (
      <section className="editorial-section" aria-labelledby="mentors-heading">
        <div className="editorial-section__inner">
          <div className="editorial-container" style={{ padding: '96px 40px' }}>
            <p className="editorial-body" style={{ color: 'var(--editorial-muted)' }}>
              No mentors available at the moment. Check back soon.
            </p>
          </div>
        </div>
      </section>
    );
  }

  // Show first 4 featured mentors
  const featuredMentors = mentors.slice(0, 4);

  return (
    <section className="editorial-section" aria-labelledby="mentors-heading">
      <div className="editorial-section__inner">
        <div className="editorial-container" style={{ marginBottom: '64px', maxWidth: '640px' }}>
          <p className="editorial-caption" style={{ color: 'var(--editorial-accent)', marginBottom: '16px' }}>
            Meet the mentors
          </p>
          <h2 id="mentors-heading" className="editorial-heading-lg" style={{ marginBottom: '24px' }}>
            A few of the mentors you can book
          </h2>
          <p className="editorial-body" style={{ color: 'var(--editorial-muted)' }}>
            Every mentor is vetted, active, and ready for a focused 1:1 conversation.
          </p>
        </div>

        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
          gap: '24px',
          maxWidth: '1200px',
          margin: '0 auto 48px'
        }}>
          {featuredMentors.map((mentor) => (
            <article
              key={mentor.id}
              className="editorial-card"
              onClick={() => onOpenMentor(mentor)}
              style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column' }}
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenMentor(mentor); }}}
              role="button"
              aria-label={`View ${mentor.full_name}'s profile`}
            >
              {/* Mentor Portrait */}
              <div className="editorial-image" style={{ 
                aspectRatio: '1/1', 
                margin: '-24px -24px 24px -24px',
                borderRadius: 'var(--editorial-radius-btn) var(--editorial-radius-btn) 0 0',
                backgroundColor: 'var(--editorial-charcoal)',
                overflow: 'hidden'
              }}>
                {mentor.avatar_url ? (
                  <img 
                    src={mentor.avatar_url} 
                    alt="" 
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div style={{ 
                    width: '100%', 
                    height: '100%', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    background: 'linear-gradient(135deg, var(--editorial-charcoal) 0%, var(--editorial-charcoal-light) 100%)'
                  }}>
                    <svg 
                      width="64" 
                      height="64" 
                      viewBox="0 0 24 24" 
                      fill="none" 
                      stroke="var(--editorial-accent)" 
                      strokeWidth="1.5"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="8" r="4" />
                      <path d="M12 14c-4 0-8 3-8 6v2h16v-2c0-3-4-6-8-6z" />
                    </svg>
                  </div>
                )}
              </div>

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <h3 className="editorial-heading-sm" style={{ 
                  color: 'var(--editorial-charcoal)', 
                  marginBottom: '8px',
                  fontSize: '22px'
                }}>
                  {mentor.full_name}
                </h3>
                <p className="editorial-body-sm" style={{ 
                  color: 'var(--editorial-muted)', 
                  marginBottom: '16px',
                  fontSize: '15px',
                  lineHeight: '1.5'
                }}>
                  {mentor.headline}
                </p>

                {/* Metadata row */}
                <div style={{ 
                  display: 'flex', 
                  flexWrap: 'wrap', 
                  gap: '12px', 
                  marginBottom: '20px',
                  paddingBottom: '16px',
                  borderBottom: '1px solid var(--editorial-border)'
                }}>
                  {mentor.experience_years > 0 && (
                    <span className="editorial-caption" style={{ 
                      color: 'var(--editorial-muted)',
                      background: 'var(--editorial-accent-soft)',
                      padding: '4px 10px',
                      borderRadius: 'var(--editorial-radius-pill)'
                    }}>
                      {mentor.experience_years}+ yrs exp
                    </span>
                  )}
                  {mentor.rating > 0 && (
                    <span className="editorial-caption" style={{ 
                      color: 'var(--editorial-charcoal)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--editorial-accent)" aria-hidden="true">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                      {mentor.rating.toFixed(1)}
                    </span>
                  )}
                  {mentor.starting_price_inr && (
                    <span className="editorial-caption" style={{ color: 'var(--editorial-charcoal)' }}>
                      from ₹{mentor.starting_price_inr.toLocaleString()}/session
                    </span>
                  )}
                </div>

                {/* Segments */}
                {mentor.segments && mentor.segments.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
                    {mentor.segments.slice(0, 3).map((segment) => (
                      <span key={segment.id} className="editorial-caption" style={{ 
                        color: 'var(--editorial-accent)',
                        background: 'var(--editorial-accent-soft)',
                        padding: '4px 10px',
                        borderRadius: 'var(--editorial-radius-pill)',
                        textTransform: 'capitalize'
                      }}>
                        {segment.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <button className="editorial-btn-outline" style={{ marginTop: 'auto', width: '100%', textAlign: 'center' }}>
                View Mentor
              </button>
            </article>
          ))}
        </div>

        <div className="editorial-container">
          <button className="editorial-ghost-link" style={{ fontSize: '16px', padding: '8px 0' }}>
            Browse all mentors
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
};