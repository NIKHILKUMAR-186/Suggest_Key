import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/src/lib/utils';

/**
 * HERO HUMAN VISUAL — an abstract, non-identifying conversation scene.
 *
 * WHY AN ILLUSTRATION AND NOT A PHOTO. The project ships no mentor photography,
 * and this page may not invent a person: a stock "counsellor" photo would
 * manufacture an identity the product does not have, and a generated face would
 * imply a specific, real, bookable individual that does not exist. So the scene
 * is drawn from layered light and two deliberately featureless, faceless figures
 * in conversation. It reads as human warmth and attention while making no claim
 * about who anyone is.
 *
 * WHY IT IS NOT A BOXED IMAGE. The figure is built from gradients and blurred
 * shapes that bleed past the edges of its container, so it sits IN the hero's
 * purple environment instead of being a rectangle pasted onto it. The ambient
 * halo behind the figures is part of the same composition, and the vignette
 * dissolves into the hero's own background.
 *
 * The scene is decorative: it carries no information the adjacent copy does not
 * already state, so it is hidden from assistive technology rather than described.
 */

/** Deterministic, purely decorative float offsets. Not data, and not random. */
const DRIFT = [
  { x: -6, y: -8, duration: 7.5, delay: 0 },
  { x: 5, y: -4, duration: 8.5, delay: 0.6 },
];

export const HeroConversationVisual: React.FC<{ className?: string }> = ({ className }) => {
  const prefersReducedMotion = useReducedMotion();
  const canAnimate = prefersReducedMotion === false;

  const drift = (index: number) =>
    canAnimate
      ? {
          animate: { x: DRIFT[index].x, y: DRIFT[index].y },
          transition: {
            duration: DRIFT[index].duration,
            delay: DRIFT[index].delay,
            repeat: Infinity,
            repeatType: 'mirror' as const,
            ease: 'easeInOut' as const,
          },
        }
      : {};

  return (
    <motion.div
      aria-hidden="true"
      initial={canAnimate ? { opacity: 0, y: 20 } : false}
      animate={canAnimate ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.7, ease: [0.23, 1, 0.31, 1] }}
      className={cn('relative', className)}
    >
      {/* Ambient halo: the "light in the room" the two figures sit inside. */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[140%] w-[140%] -translate-x-1/2 -translate-y-1/2"
        style={{
          background:
            'radial-gradient(ellipse at 50% 42%, rgba(124,58,237,0.45) 0%, rgba(91,33,182,0.22) 38%, transparent 62%)',
          filter: 'blur(32px)',
        }}
      />
      {/* Subtle brand key motif: a soft geometric shape behind the figures. */}
      <div
        className="pointer-events-none absolute left-1/2 top-[38%] -z-10 h-[55%] w-[70%] -translate-x-1/2 -translate-y-1/2 opacity-[0.07]"
        style={{
          background:
            'conic-gradient(from 45deg at 50% 50%, rgba(247,210,67,0.0) 0deg, rgba(247,210,67,0.5) 90deg, rgba(247,210,67,0.0) 180deg, rgba(247,210,67,0.3) 270deg, rgba(247,210,67,0.0) 360deg)',
          filter: 'blur(60px)',
        }}
        aria-hidden="true"
      />
      <svg
        viewBox="0 0 560 620"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full w-full overflow-visible"
        role="presentation"
      >
        <defs>
          <linearGradient id="sk-hero-key" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f7d243" stopOpacity="0.85" />
            <stop offset="55%" stopColor="#c4b5fd" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#663af3" stopOpacity="0.25" />
          </linearGradient>
          <linearGradient id="sk-hero-figure-a" x1="0.2" y1="0" x2="0.9" y2="1">
            <stop offset="0%" stopColor="#fde68a" />
            <stop offset="45%" stopColor="#f7d243" />
            <stop offset="100%" stopColor="#a16207" />
          </linearGradient>
          <linearGradient id="sk-hero-figure-b" x1="0.8" y1="0" x2="0.1" y2="1">
            <stop offset="0%" stopColor="#ddd6fe" />
            <stop offset="50%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#5b21b6" />
          </linearGradient>
          <linearGradient id="sk-hero-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1f1037" stopOpacity="0" />
            <stop offset="100%" stopColor="#1f1037" stopOpacity="1" />
          </linearGradient>
          <radialGradient id="sk-hero-vignette" cx="50%" cy="42%" r="58%">
            <stop offset="0%" stopColor="#2e1065" stopOpacity="0" />
            <stop offset="100%" stopColor="#150a28" stopOpacity="0.92" />
          </radialGradient>
          <filter id="sk-hero-soft" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
          <filter id="sk-hero-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="20" />
          </filter>
          <filter id="sk-hero-deep-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="28" />
          </filter>
        </defs>

        <motion.g {...drift(0)} style={{ transformOrigin: 'center' }}>
          <circle cx="196" cy="188" r="86" fill="#f7d243" opacity="0.18" filter="url(#sk-hero-glow)" />
          <circle cx="404" cy="252" r="104" fill="#8b5cf6" opacity="0.24" filter="url(#sk-hero-glow)" />
        </motion.g>

        <ellipse cx="280" cy="470" rx="196" ry="34" fill="url(#sk-hero-key)" opacity="0.22" filter="url(#sk-hero-soft)" />

        <motion.g {...drift(1)} style={{ transformOrigin: 'center' }}>
          <path d="M392 620c0-84 42-136 108-136s108 52 108 136H392Z" fill="url(#sk-hero-figure-b)" opacity="0.92" />
          <circle cx="500" cy="404" r="52" fill="url(#sk-hero-figure-b)" />
          <path d="M452 396a48 48 0 0 1 96 0" fill="#ede9fe" opacity="0.24" />
        </motion.g>

        <motion.g {...drift(0)} style={{ transformOrigin: 'center' }}>
          <path d="M64 620c0-108 54-172 138-172s138 64 138 172H64Z" fill="url(#sk-hero-figure-a)" opacity="0.95" />
          <path d="M168 452l34 46 34-46-18-12h-32l-18 12Z" fill="#fffbeb" opacity="0.34" />
          <circle cx="202" cy="368" r="62" fill="url(#sk-hero-figure-a)" />
          <path d="M148 350a56 56 0 0 1 108 0" stroke="#fffbeb" strokeWidth="7" strokeLinecap="round" opacity="0.38" fill="none" />
        </motion.g>

        {/* Deep background glow — adds depth behind the figures. */}
        <circle cx="280" cy="320" r="180" fill="#663af3" opacity="0.08" filter="url(#sk-hero-deep-glow)" aria-hidden="true" />

        <ellipse cx="252" cy="556" rx="230" ry="60" fill="url(#sk-hero-fade)" />
        <ellipse cx="280" cy="300" rx="300" ry="330" fill="url(#sk-hero-vignette)" />
      </svg>
    </motion.div>
  );
};
