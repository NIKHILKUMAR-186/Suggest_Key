export const landingMotion = {
  duration: {
    instant: 0,
    feedback: 0.16,
    transition: 0.28,
    reveal: 0.62,
    hero: 0.82,
    chapter: 1.1,
    heroVisual: 1.2,
  },
  ease: [0.22, 1, 0.36, 1] as const,
  stagger: {
    compact: 0.08,
    editorial: 0.12,
    hero: 0.14,
  },
  displacement: {
    micro: 4,
    reveal: 18,
    parallax: 24,
  },
  scale: {
    press: 0.98,
    hover: 1.03,
  },
  scroll: {
    process: ['start 0.78', 'end 0.34'] as ['start 0.78', 'end 0.34'],
  },
  spring: {
    type: 'spring' as const,
    stiffness: 260,
    damping: 24,
    mass: 0.6,
  },
};
