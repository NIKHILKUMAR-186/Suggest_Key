import React from 'react';
import { cn } from '@/src/lib/utils';

const steps = [
  {
    number: '01',
    title: 'Choose what you need',
    description: 'Browse mentorship areas — career, relationships, health, creativity, and more. Each area has mentors who specialize in that domain.'
  },
  {
    number: '02',
    title: 'Find your mentor',
    description: 'Review mentor profiles with their experience, focus areas, and session types. Pick someone whose background matches what you\'re figuring out.'
  },
  {
    number: '03',
    title: 'Pick a time',
    description: 'Select a session length and book a slot that works for your schedule. No back-and-forth — real availability, confirmed instantly.'
  },
  {
    number: '04',
    title: 'Talk 1:1',
    description: 'Join a focused video conversation. Get practical guidance, a clear next step, and a session workspace with notes and action items.'
  }
];

export const LandingNewHowItWorks: React.FC = () => {
  return (
    <section id="how-it-works" className="editorial-section" aria-labelledby="how-heading">
      <div className="editorial-section__inner">
        <div className="editorial-container" style={{ marginBottom: '80px', maxWidth: '640px' }}>
          <p className="editorial-caption" style={{ color: 'var(--editorial-accent)', marginBottom: '16px' }}>
            How it works
          </p>
          <h2 id="how-heading" className="editorial-heading-lg" style={{ marginBottom: '24px' }}>
            Four steps to a focused conversation
          </h2>
          <p className="editorial-body" style={{ color: 'var(--editorial-muted)' }}>
            No endless browsing. No unclear commitments. Just a clear path to the right conversation.
          </p>
        </div>

        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
          gap: '48px',
          maxWidth: '1200px',
          margin: '0 auto'
        }}>
          {steps.map((step, index) => (
            <article key={step.number} className="editorial-step">
              <span className="editorial-step__number">{step.number}</span>
              <div className="editorial-step__content">
                <h3 className="editorial-heading-sm" style={{ color: 'var(--editorial-charcoal)' }}>
                  {step.title}
                </h3>
                <p className="editorial-body" style={{ color: 'var(--editorial-muted)' }}>
                  {step.description}
                </p>
              </div>
              
              {/* Connecting line between steps on desktop */}
              {index < steps.length - 1 && (
                <div 
                  style={{ 
                    position: 'absolute', 
                    left: '50%', 
                    top: '120px',
                    bottom: '-48px',
                    width: '1px',
                    background: 'var(--editorial-border)',
                    transform: 'translateX(-50%)',
                    display: 'none'
                  }}
                  aria-hidden="true"
                />
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};