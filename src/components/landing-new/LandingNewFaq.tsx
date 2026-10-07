import React, { useState } from 'react';
import { cn } from '@/src/lib/utils';

const faqs = [
  {
    question: 'How do I choose the right mentor?',
    answer: 'Browse by mentorship area to see mentors who specialize in what you\'re figuring out. Each profile shows their experience, focus areas, session types, and pricing. You can also view their public profile to learn more before booking.'
  },
  {
    question: 'What happens during a session?',
    answer: 'You join a video call at your booked time. The mentor listens to your situation, asks clarifying questions, and shares perspective from their experience. You leave with a practical next step. After the session, you get a workspace with notes, takeaways, and any follow-up recommendations.'
  },
  {
    question: 'How long are sessions and what do they cost?',
    answer: 'Mentors set their own session lengths (30, 45, 60, 90, or 120 minutes) and prices. You\'ll see the duration and price before booking. There are no hidden fees — the price shown is what you pay.'
  },
  {
    question: 'What if I need to reschedule or cancel?',
    answer: 'You can reschedule up to 24 hours before the session. Cancellations within 24 hours may be subject to the mentor\'s cancellation policy, which is shown before you book. We\'ll notify you of any fees upfront.'
  },
  {
    question: 'Are mentors verified?',
    answer: 'Yes. Every mentor goes through an application review where we verify their experience, credentials, and ability to provide meaningful mentorship. Only approved, active mentors appear on the platform.'
  },
  {
    question: 'What if the session isn\'t helpful?',
    answer: 'If a session doesn\'t meet your expectations, contact support within 48 hours. We review each case and offer a refund or rebook with another mentor when appropriate. Our goal is that every conversation moves you forward.'
  },
  {
    question: 'Can I book multiple sessions with the same mentor?',
    answer: 'Absolutely. Many seekers book follow-up sessions as they work through a challenge. You can book another session anytime from the mentor\'s profile or your session workspace.'
  },
  {
    question: 'Is there a subscription or membership fee?',
    answer: 'No. You pay per session. No monthly fees, no packages, no minimum commitments. Book one session or as many as you need.'
  }
];

export const LandingNewFaq: React.FC = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggleFaq = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section className="editorial-section" aria-labelledby="faq-heading">
      <div className="editorial-section__inner">
        <div className="editorial-container" style={{ marginBottom: '48px', maxWidth: '720px' }}>
          <p className="editorial-caption" style={{ color: 'var(--editorial-accent)', marginBottom: '16px' }}>
            Questions
          </p>
          <h2 id="faq-heading" className="editorial-heading-lg" style={{ marginBottom: '16px' }}>
            Good to know
          </h2>
        </div>

        <div style={{ maxWidth: '720px', margin: '0 auto' }}>
          <div className="editorial-accordion" role="region" aria-label="Frequently asked questions">
            {faqs.map((faq, index) => (
              <div key={index} className="editorial-accordion__item">
                <button
                  className="editorial-accordion__trigger"
                  onClick={() => toggleFaq(index)}
                  aria-expanded={openIndex === index}
                  aria-controls={`faq-content-${index}`}
                  id={`faq-trigger-${index}`}
                >
                  {faq.question}
                  <svg
                    className="editorial-accordion__icon"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                <div
                  id={`faq-content-${index}`}
                  role="region"
                  aria-labelledby={`faq-trigger-${index}`}
                  className={cn('editorial-accordion__content', openIndex === index && 'editorial-accordion__content--open')}
                  style={{ 
                    maxHeight: openIndex === index ? '500px' : '0',
                    opacity: openIndex === index ? 1 : 0
                  }}
                >
                  <div className="editorial-accordion__panel">
                    {faq.answer}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};