/**
 * NEW LANDING PAGE — FAQ.
 *
 * The four questions below are the supplied design's own informational copy,
 * not claims about the marketplace, so they carry over unchanged. The answer
 * is a real disclosure region controlled by a button, so the open state is
 * tracked in React rather than left to the browser's default marker.
 */
const QUESTIONS = [
  [
    'Is Suggest Key a clinic?',
    'No. We connect you with independent, verified experts. We do not provide medical care ourselves.',
  ],
  [
    'How much does it cost?',
    "Each expert's fee is shown upfront on their card. Finding the right expert through a guide is free.",
  ],
  [
    'Is it confidential?',
    'Yes. Your enquiry is shared only with the expert you choose.',
  ],
  [
    'Can I book for someone else?',
    'Yes. Many parents and family members book on behalf of a child or relative.',
  ],
] as const;

export interface NewLandingFaqProps {
  openFaq: number | null;
  onToggle: (index: number | null) => void;
}

export function NewLandingFaq({ openFaq, onToggle }: NewLandingFaqProps) {
  return (
    <section className="nlg-section" aria-labelledby="faq-title">
      <div className="nlg-eyebrow">Questions</div>
      <h2 id="faq-title">Good to know</h2>
      <div className="nlg-faq">
        {QUESTIONS.map(([question, answer], index) => {
          const open = openFaq === index;
          const answerId = `nlg-faq-answer-${index}`;
          const questionId = `nlg-faq-question-${index}`;
          return (
            <div className="nlg-faq__item" key={question}>
              <button
                type="button"
                id={questionId}
                className="nlg-faq__summary"
                aria-expanded={open}
                aria-controls={answerId}
                onClick={() => onToggle(open ? null : index)}
              >
                <span>{question}</span>
              </button>
              {open && (
                <p
                  className="nlg-faq__answer"
                  id={answerId}
                  role="region"
                  aria-labelledby={questionId}
                >
                  {answer}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
