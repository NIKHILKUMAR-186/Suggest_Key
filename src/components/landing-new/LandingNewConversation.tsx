import React from 'react';
import { cn } from '@/src/lib/utils';

interface LandingNewConversationProps {
  onFindMentor: () => void;
}

export const LandingNewConversation: React.FC<LandingNewConversationProps> = ({ onFindMentor }) => {
  return (
    <section className="editorial-section editorial-charcoal" aria-labelledby="conversation-heading">
      <div className="editorial-section__inner">
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr', 
          gap: '96px', 
          alignItems: 'center',
          minHeight: '60vh'
        }}>
          {/* Left: Image */}
          <div className="editorial-image" style={{ 
            aspectRatio: '4/5', 
            borderRadius: 'var(--editorial-radius-asymmetric) var(--editorial-radius-btn) var(--editorial-radius-btn) var(--editorial-radius-asymmetric)',
            backgroundColor: 'var(--editorial-canvas)',
            position: 'relative',
            overflow: 'hidden'
          }}>
            <div style={{ 
              width: '100%', 
              height: '100%', 
              background: 'linear-gradient(135deg, var(--editorial-canvas) 0%, var(--editorial-charcoal-light) 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <svg 
                width="140" 
                height="140" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="var(--editorial-accent)" 
                strokeWidth="1.2"
                aria-hidden="true"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                <path d="M17 10h-10" />
                <path d="M17 14h-10" />
              </svg>
            </div>
            {/* Decorative accent bar */}
            <div style={{ 
              position: 'absolute', 
              top: 0, 
              left: 0, 
              width: '6px', 
              height: '100%', 
              background: 'var(--editorial-accent)' 
            }} />
          </div>

          {/* Right: Typography */}
          <div className="editorial-container--left" style={{ maxWidth: '520px' }}>
            <p className="editorial-caption" style={{ color: 'var(--editorial-accent)', textTransform: 'uppercase', letterSpacing: '0.22em', marginBottom: '24px' }}>
              The conversation
            </p>
            <h2 id="conversation-heading" className="editorial-heading-lg" style={{ 
              color: 'var(--editorial-on-canvas)', 
              marginBottom: '32px',
              lineHeight: '0.88'
            }}>
              A focused conversation<br />
              <span style={{ color: 'var(--editorial-accent)' }}>can change what comes next.</span>
            </h2>
            <p className="editorial-body" style={{ 
              color: 'var(--editorial-muted)', 
              marginBottom: '40px',
              maxWidth: '480px',
              fontSize: '22px',
              lineHeight: '1.5'
            }}>
              Not a course. Not a coaching program. One focused session with someone who\'s been there. You bring the question. They bring the perspective. Together you find the next step.
            </p>
            
            {/* Key benefits as editorial list */}
            <ul style={{ 
              listStyle: 'none', 
              padding: 0, 
              margin: '0 0 48px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}>
              {[
                'Real expertise, not generic advice',
                'Practical next steps, not vague suggestions', 
                'A session workspace with notes & action items',
                'No long-term commitment required'
              ].map((benefit, i) => (
                <li key={i} style={{ 
                  display: 'flex', 
                  alignItems: 'flex-start', 
                  gap: '12px',
                  color: 'var(--editorial-charcoal-light)'
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--editorial-accent)" strokeWidth="2" style={{ flexShrink: 0, marginTop: '2px' }}>
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  <span className="editorial-body-sm" style={{ color: 'var(--editorial-charcoal-light)', fontSize: '18px' }}>
                    {benefit}
                  </span>
                </li>
              ))}
            </ul>

            <button
              onClick={onFindMentor}
              className="editorial-btn-primary"
              style={{ padding: '20px 32px', fontSize: '16px' }}
            >
              Start Your Conversation
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};