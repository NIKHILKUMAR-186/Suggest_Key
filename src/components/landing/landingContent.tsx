import type { Segment } from '@/src/types/database';

export const HERO_EYEBROW = 'Suggest Key';
export const HERO_PRIMARY_LABEL = 'Explore mentors';
export const HERO_SECONDARY_LABEL = 'How it works';
export const HERO_SECONDARY_TARGET = 'how-it-works';
export const HERO_BODY =
  'One focused conversation with someone who has done exactly what you are about to do. No course, no cohort, no filler — just the thing you need and the person who can give it to you.';
export const HERO_TITLE_LINES = ['Find the right mentor', 'for what you\'re', 'figuring out.'] as const;

export const STAGE_ACTION_LABEL = 'Book session';
export const STAGE_AVAILABLE_LABEL = 'Available';
export const STAGE_LOADING_LABEL = 'Loading mentor profile';

export const MENTORS_TITLE = 'Mentors';
export const MENTORS_BODY = 'Real profiles from the live directory. No seed data, no fallback cards.';
export const MENTORS_LINK_LABEL = 'Browse every mentor';
export const MENTORS_EMPTY_TITLE = 'No mentors are listed yet.';
export const MENTORS_ERROR_TITLE = 'Couldn’t load mentors.';
export const MENTORS_RETRY_LABEL = 'Try again';

export const AREAS_TITLE = 'Who do you want to talk to?';
export const AREAS_BODY = 'Pick a real area. Every row below is a live mentorship catalogue.';
export const AREAS_ACTION_LABEL = 'See mentors';
export const AREAS_EMPTY_LABEL = 'No mentorship areas are published yet.';
export const AREAS_RETRY_LABEL = 'Try again';

export const STEPS_TITLE = 'How it works';
export const STEPS = [
  {
    index: 1,
    title: 'Pick your key',
    description: 'Choose the area that matches your next move.',
  },
  {
    index: 2,
    title: 'Meet the mentor',
    description: 'Read their profile and pick a time that works.',
  },
  {
    index: 3,
    title: 'Talk, then act',
    description: 'Have the conversation and move forward with clarity.',
  },
] as const;

export const STORY_QUOTE_LINES = [
  'One hour',
  'one question',
  'two people',
] as const;
export const STORY_BODY =
  'A focused conversation with someone who has done exactly what you are about to do. No course, no cohort, no filler — just the thing you need and the person who can give it to you.';
export const STORY_CTA_LABEL = 'Find a mentor';
export const APPROVAL_STAMP = 'Applications reviewed. ID checked. Only approved mentors listed.';

export const FAQ_TITLE = 'Good to know';
export const FAQ_ITEMS = [
  {
    question: 'What is a mentorship session?',
    answer:
      'A private one-to-one conversation with a mentor, shaped around the question you bring. Session length and price are shown with each session before you book.',
  },
  {
    question: 'How does booking work?',
    answer:
      'Choose an available time and complete the payment shown. Your slot is held while you pay; once payment is verified, the booking goes to the mentor to confirm.',
  },
  {
    question: 'When do I get the meeting link?',
    answer:
      'The mentor adds the link when they confirm your booking. You can open it shortly before the session begins.',
  },
  {
    question: 'What happens after the session?',
    answer:
      'Return to your session workspace to revisit the notes, takeaways, suggestions, and next steps your mentor shares.',
  },
] as const;

export const TRUST_TITLE = 'Why Suggest Key';
export const WHY_STATEMENT =
  'The platform does one thing: it connects you with a real person who has done what you are trying to do. Everything below is how it keeps that promise honest.';
export const WHY_ITEMS = [
  {
    title: 'Verified experience',
    description:
      'Every mentor submits proof of relevant experience and a government-issued ID. An admin reviews both before the profile appears.',
  },
  {
    title: 'Structured conversations',
    description:
      'Sessions are booked by the hour, with a clear topic and a single outcome. No open-ended coaching, no vague promises.',
  },
  {
    title: 'Private by design',
    description:
      'Your session notes and booking details are visible only to you and the mentor. The directory is the only public surface.',
  },
] as const;

export const FINAL_TITLE = 'Ready to have the conversation?';

export const FOOTER_PROMISE = 'Mentorship that is private, verified, and one hour long.';
export const FOOTER_LEGAL = 'All rights reserved.';
export const FOOTER_GROUPS = [
  {
    heading: 'Product',
    links: [
      { label: 'Explore Mentors', route: '/seeker' },
      { label: 'How it works', route: '/#how-it-works' },
      { label: 'Why Suggest Key', route: '/#why' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', route: '/#' },
      { label: 'Contact', route: '/#' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy', route: '/#' },
      { label: 'Terms', route: '/#' },
    ],
  },
] as const;
