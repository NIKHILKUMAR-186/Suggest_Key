import React from 'react';
import { cn } from '@/src/lib/utils';

const reasons = [
  {
    title: 'Relevant human expertise',
    description: 'Every mentor is vetted for real experience in their domain. You\'re not getting generic advice — you\'re talking to someone who\'s navigated what you\'re facing.'
  },
  {
    title: 'Focused 1:1 conversation',
    description: 'No courses, no group sessions, no async messaging. One dedicated video call where your question gets full attention and a practical next step.'
  },
  {
    title: 'Curated mentor discovery',
    description: 'Browse by mentorship area, not by algorithm. See mentors organized by what they actually help with — career transitions, relationship dynamics, health decisions, creative blocks.'
  },
  {
    title: 'Practical next steps',
    description: 'Every session ends with a clear action item. You leave with a session workspace containing notes, takeaways, and follow-up recommendations — not just a good conversation.'
  },
  {
    title: 'Mentor-authored guidance',
    description: 'Mentors create their own session types, set their own prices, and write their own workspace templates. The guidance reflects their actual practice, not a platform script.'
  },
  {
    title: 'No subscription, no lock-in',
    description: 'Book one session or ten. Pay per conversation with transparent pricing. No monthly fees, no packages, no pressure to continue.'
  }
];

export const LandingNewWhy: React.FC = () => {
  return (
    <section id="why" className="editorial-section" aria-labelledby="why-heading">
      <div className="editorial-section__inner">
        <div className="editorial-container" style={{ marginBottom: '80px', maxWidth: '640px' }}>
          <p className="editorial-caption" style={{ color: 'var(--editorial-accent)', marginBottom: '16px' }}>
            Why Suggest Key
          </p>
          <h2 id="why-heading" className="editorial-heading-lg" style={{ marginBottom: '24px' }}>
            Built for the conversation that matters
          </h2>
          <p className="editorial-body" style={{ color: 'var(--editorial-muted)' }}>
            We don\'t match you with a coach. We connect you with a mentor for one focused conversation. Here\'s why that difference matters.
          </p>
        </div>

        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', 
          gap: '24px',
          maxWidth: '1200px',
          margin: '0 auto'
        }}>
          {reasons.map((reason, index) => (
            <article key={index} className="editorial-card" style={{ padding: '32px' }}>
              <h3 className="editorial-heading-sm" style={{ 
                color: 'var(--editorial-charcoal)', 
                marginBottom: '16px',
                fontSize: '24px'
              }}>
                {reason.title}
              </h3>
              <p className="editorial-body" style={{ color: 'var(--editorial-muted)' }}>
                {reason.description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};