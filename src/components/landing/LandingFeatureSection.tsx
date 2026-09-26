import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/src/lib/utils';

// ============================================================
// Shared SVG filter definitions (glow effects)
// ============================================================
function SharedFilters() {
  return (
    <svg
      aria-hidden="true"
      className="absolute w-0 h-0 overflow-hidden"
      style={{ position: 'absolute' }}
    >
      <defs>
          <filter id="sk-glow-purple" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#8b5cf6" floodOpacity="0.55" />
          </filter>
          <filter id="sk-glow-blue" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#60a5fa" floodOpacity="0.55" />
          </filter>
          <filter id="sk-glow-cyan" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#22d3ee" floodOpacity="0.55" />
          </filter>
          <filter id="sk-glow-green" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#34d399" floodOpacity="0.55" />
          </filter>
          <filter id="sk-glow-amber" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#fbbf24" floodOpacity="0.55" />
          </filter>
      </defs>
    </svg>
  );
}

// ============================================================
// SVG Illustration Components
// All use viewBox 0 0 320 200, dark panel, consistent palette
// ============================================================

function ConversationsVisual() {
  return (
    <svg viewBox="0 0 320 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-auto">
      <defs>
        <radialGradient id="grad-panel-c" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#1a1f2d" />
          <stop offset="100%" stopColor="#0d1117" />
        </radialGradient>
        <radialGradient id="grad-av-pur" cx="40%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#c4b5f6" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </radialGradient>
        <radialGradient id="grad-av-blu" cx="40%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#93c5fd" />
          <stop offset="100%" stopColor="#60a5fa" />
        </radialGradient>
      </defs>
      <rect x="24" y="20" width="272" height="160" rx="16" fill="url(#grad-panel-c)" stroke="rgba(186,215,247,0.08)" strokeWidth="1" />
      <g filter="url(#sk-glow-purple)">
        <circle cx="88" cy="102" r="30" fill="url(#grad-av-pur)" />
        <circle cx="82" cy="96" r="3" fill="#0f172a" />
        <circle cx="94" cy="96" r="3" fill="#0f172a" />
        <path d="M78 108 C84 112 96 112 102 108" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" />
      </g>
      <g filter="url(#sk-glow-blue)">
        <circle cx="232" cy="102" r="30" fill="url(#grad-av-blu)" />
        <circle cx="226" cy="96" r="3" fill="#0f172a" />
        <circle cx="238" cy="96" r="3" fill="#0f172a" />
        <path d="M222 108 C228 112 240 112 246 108" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" />
      </g>
      <line x1="128" y1="96" x2="192" y2="96" stroke="rgba(186,215,247,0.15)" strokeWidth="1.5" strokeDasharray="3 3" />
      <circle cx="160" cy="102" r="5" fill="#8b5cf6" />
      <path d="M160 96 V108 M155 102 H165" stroke="white" strokeWidth="1.5" />
      <circle cx="140" cy="88" r="2.5" fill="rgba(186,215,247,0.4)" />
      <circle cx="160" cy="86" r="2.5" fill="rgba(186,215,247,0.6)" />
      <circle cx="180" cy="88" r="2.5" fill="rgba(186,215,247,0.4)" />
      <rect x="62" y="48" width="38" height="20" rx="8" fill="rgba(186,215,247,0.06)" stroke="rgba(186,215,247,0.1)" strokeWidth="1" />
      <path d="M78 68 L72 74 L84 74 Z" fill="rgba(186,215,247,0.06)" />
      <rect x="220" y="48" width="38" height="20" rx="8" fill="rgba(186,215,247,0.06)" stroke="rgba(186,215,247,0.1)" strokeWidth="1" />
      <path d="M236 68 L230 74 L242 74 Z" fill="rgba(186,215,247,0.06)" />
    </svg>
  );
}

function VerifiedMentorsVisual() {
  return (
    <svg viewBox="0 0 320 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-auto">
      <defs>
        <radialGradient id="grad-panel-v" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#1a1f2d" />
          <stop offset="100%" stopColor="#0d1117" />
        </radialGradient>
        <radialGradient id="grad-mentor" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#bfdbfe" />
          <stop offset="100%" stopColor="#60a5fa" />
        </radialGradient>
        <radialGradient id="grad-sat" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#e11d48" />
          <stop offset="100%" stopColor="#dc2626" />
        </radialGradient>
        <radialGradient id="grad-sat2" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#f472b6" />
          <stop offset="100%" stopColor="#ec4899" />
        </radialGradient>
      </defs>
      <rect x="24" y="20" width="272" height="160" rx="16" fill="url(#grad-panel-v)" stroke="rgba(186,215,247,0.08)" strokeWidth="1" />
      <g filter="url(#sk-glow-blue)">
        <circle cx="160" cy="100" r="36" fill="url(#grad-mentor)" />
        <circle cx="153" cy="95" r="3.5" fill="#0f172a" />
        <circle cx="167" cy="95" r="3.5" fill="#0f172a" />
        <path d="M148 114 C156 120 164 120 172 114" stroke="#0f172a" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g>
        <circle cx="90" cy="58" r="16" fill="url(#grad-sat)" stroke="rgba(186,215,247,0.1)" strokeWidth="1" />
        <circle cx="230" cy="58" r="16" fill="url(#grad-sat2)" stroke="rgba(186,215,247,0.1)" strokeWidth="1" />
        <circle cx="110" cy="140" r="16" fill="url(#grad-mentor)" stroke="rgba(186,215,247,0.1)" strokeWidth="1" />
      </g>
      <circle cx="160" cy="100" r="44" rx="22" ry="12" stroke="rgba(100,200,150,0.3)" strokeWidth="1.5" fill="none" />
      <g filter="url(#sk-glow-green)" transform="translate(180,70)">
        <circle cx="0" cy="0" r="10" fill="#0f172a" stroke="#34d399" strokeWidth="1.5" />
        <path d="M-3 1 L1 5 L7 -1" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

function RealAvailabilityVisual() {
  return (
    <svg viewBox="0 0 320 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-auto">
      <defs>
        <radialGradient id="grad-panel-a" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#1a1f2d" />
          <stop offset="100%" stopColor="#0d1117" />
        </radialGradient>
        <linearGradient id="grad-cal" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1b253a" />
          <stop offset="100%" stopColor="#0d1117" />
        </linearGradient>
      </defs>
      <rect x="24" y="20" width="272" height="160" rx="16" fill="url(#grad-panel-a)" stroke="rgba(186,215,247,0.08)" strokeWidth="1" />
      <g transform="translate(85, 55)">
        <rect width="160" height="100" rx="10" fill="url(#grad-cal)" stroke="rgba(186,215,247,0.1)" strokeWidth="1" />
        <rect x="0" y="0" width="160" height="22" rx="10" fill="rgba(186,215,247,0.06)" />
        <text x="10" y="14" textAnchor="middle" fill="#9da7ba" fontSize="10" fontFamily="Inter" fontWeight="500">SEP 2026</text>
        <g fill="#9da7ba" fontSize="9" fontFamily="Inter">
          <text x="11" y="44">M</text><text x="33" y="44">T</text><text x="55" y="44">W</text>
          <text x="77" y="44">T</text><text x="99" y="44">F</text><text x="121" y="44">S</text><text x="143" y="44">S</text>
        </g>
        <g transform="translate(11, 52)">
          <g fill="rgba(186,215,247,0.06)" stroke="rgba(186,215,247,0.08)" strokeWidth="0.5" fontSize="9" fontFamily="Inter">
            {Array.from({ length: 35 }).map((_, i) => {
              const row = Math.floor(i / 7);
              const col = i % 7;
              const x = col * 23;
              const y = row * 14;
              const dayNum = i - 5;
              return dayNum > 0 && dayNum <= 30 ? (
                <rect key={i} x={x} y={y} width="18" height="10" rx="2" fill="rgba(186,215,247,0.1)" />
              ) : (
                <rect key={i} x={x} y={y} width="18" height="10" rx="2" />
              );
            })}
          </g>
          <rect x="72" y="68" width="22" height="16" rx="4" fill="#8b5cf6" filter="url(#sk-glow-purple)" />
          <text x="83" y="79" textAnchor="middle" fill="white" fontSize="9" fontFamily="Inter" fontWeight="600">22</text>
        </g>
      </g>
      <g filter="url(#sk-glow-cyan)" transform="translate(228, 120)">
        <circle cx="0" cy="0" r="28" fill="#0f172a" stroke="rgba(186,215,247,0.15)" strokeWidth="1.5" />
        <line x1="0" y1="-16" x2="0" y2="8" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" />
        <line x1="0" y1="-12" x2="12" y2="0" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" />
      </g>
      <g>
        <circle cx="228" cy="112" r="3" fill="#22d3ee" />
        <circle cx="240" cy="128" r="3" fill="#22d3ee" />
        <circle cx="216" cy="128" r="3" fill="#22d3ee" />
      </g>
    </svg>
  );
}

function SessionDetailsVisual() {
  return (
    <svg viewBox="0 0 320 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-auto">
      <defs>
        <radialGradient id="grad-panel-d" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#1a1f2d" />
          <stop offset="100%" stopColor="#0d1117" />
        </radialGradient>
        <linearGradient id="grad-card-d" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#131a27" />
          <stop offset="100%" stopColor="#0d1117" />
        </linearGradient>
      </defs>
      <rect x="24" y="20" width="272" height="160" rx="16" fill="url(#grad-panel-d)" stroke="rgba(186,215,247,0.08)" strokeWidth="1" />
      <g transform="translate(70, 55)">
        <rect width="180" height="110" rx="12" fill="url(#grad-card-d)" stroke="rgba(186,215,247,0.1)" strokeWidth="1" />
        <rect x="0" y="0" width="180" height="26" rx="12" fill="rgba(186,215,247,0.04)" />
        <g filter="url(#sk-glow-amber)">
          <circle cx="30" cy="14" r="6" fill="#fbbf24" />
          <text x="40" y="18" fill="white" fontSize="10" fontFamily="Inter" fontWeight="600">CONFIRMED</text>
        </g>
        <line x1="10" y1="36" x2="170" y2="36" stroke="rgba(186,215,247,0.08)" strokeWidth="1" />
        <g fill="#d1e4fa" fontSize="10" fontFamily="Inter">
          <text x="10" y="52">Career Strategy Session</text>
          <text x="10" y="70">Dec 15, 2026 • 10:00 AM IST</text>
          <text x="10" y="88">Duration: 60 minutes</text>
        </g>
        <g fill="#fbbf24" fontSize="10" fontFamily="Inter" fontWeight="600">
          <text x="10" y="106">₹2,500</text>
        </g>
      </g>
    </svg>
  );
}

function ActionableOutcomesVisual() {
  return (
    <svg viewBox="0 0 320 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-auto">
      <defs>
        <radialGradient id="grad-panel-o" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#1a1f2d" />
          <stop offset="100%" stopColor="#0d1117" />
        </radialGradient>
        <linearGradient id="grad-line-o" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
      </defs>
      <rect x="24" y="20" width="272" height="160" rx="16" fill="url(#grad-panel-o)" stroke="rgba(186,215,247,0.08)" strokeWidth="1" />
      <g transform="translate(60, 130)">
        <line x1="0" y1="0" x2="200" y2="0" stroke="rgba(186,215,247,0.08)" strokeWidth="1" />
        <line x1="0" y1="20" x2="200" y2="20" stroke="rgba(186,215,247,0.04)" strokeWidth="1" />
        <line x1="0" y1="40" x2="200" y2="40" stroke="rgba(186,215,247,0.04)" strokeWidth="1" />
        <line x1="0" y1="60" x2="200" y2="60" stroke="rgba(186,215,247,0.04)" strokeWidth="1" />
        <defs>
          <linearGradient id="grad-area-o" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0 60 L40 40 L80 30 L120 15 L160 6 L200 0 V60 Z"
          fill="url(#grad-area-o)"
        />
        <path
          d="M0 60 L40 40 L80 30 L120 15 L160 6 L200 0"
          fill="none"
          stroke="url(#grad-line-o)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="0" cy="60" r="4" fill="#34d399" />
        <circle cx="40" cy="40" r="4" fill="#34d399" />
        <circle cx="80" cy="30" r="4" fill="#34d399" />
        <circle cx="120" cy="15" r="4" fill="#34d399" />
        <circle cx="160" cy="6" r="4" fill="#34d399" />
        <g filter="url(#sk-glow-green)" transform="translate(200, 0)">
          <circle cx="0" cy="0" r="8" fill="#34d399" />
          <path d="M-2 -2 L2 4 L6 -2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
    </svg>
  );
}

function SecureBookingVisual() {
  return (
    <svg viewBox="0 0 320 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-auto">
      <defs>
        <radialGradient id="grad-panel-s" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#1a1f2d" />
          <stop offset="100%" stopColor="#0d1117" />
        </radialGradient>
        <linearGradient id="grad-shield" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#131a27" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
      </defs>
      <rect x="24" y="20" width="272" height="160" rx="16" fill="url(#grad-panel-s)" stroke="rgba(186,215,247,0.08)" strokeWidth="1" />
      <g filter="url(#sk-glow-green)" transform="translate(160, 95)">
        <path
          d="M-45 -55 L0 -85 L45 -55 L45 5 L0 85 L-45 5 Z"
          fill="url(#grad-shield)"
          stroke="rgba(186,215,247,0.15)"
          strokeWidth="1.5"
        />
        <g transform="translate(0, -5)">
          <rect x="-18" y="-12" width="36" height="24" rx="4" fill="rgba(186,215,247,0.06)" stroke="rgba(186,215,247,0.1)" strokeWidth="1" />
          <rect x="-18" y="-8" width="12" height="6" rx="1" fill="rgba(186,215,247,0.2)" />
          <rect x="-10" y="-3" width="4" height="3" rx="0.5" fill="rgba(186,215,247,0.15)" />
        </g>
        <path
          d="M-8 -8 L0 0 L8 -8 L0 2 L-8 -2 Z M-6 -6 L0 -1 L6 -6 L0 0 Z"
          fill="#34d399"
        />
        <circle cx="0" cy="12" r="3" fill="#34d399" />
      </g>
      <g transform="translate(105, 155)">
        <rect width="110" height="44" rx="8" fill="rgba(186,215,247,0.04)" stroke="rgba(186,215,247,0.1)" strokeWidth="1" />
        <rect x="15" y="20" width="80" height="8" rx="2" fill="rgba(186,215,247,0.08)" />
        <rect x="15" y="31" width="50" height="6" rx="1.5" fill="rgba(186,215,247,0.06)" />
      </g>
    </svg>
  );
}

// ============================================================
// Feature data (static marketing copy only — no business data)
// ============================================================
interface FeatureData {
  id: string;
  title: string;
  description: string;
  label: string;
  dotColor: string;
  glowColor: string;
  Visual: React.FC;
}

const FEATURES: FeatureData[] = [
  {
    id: 'conversations',
    title: '1:1 Conversations',
    description: 'Dedicated sessions tailored to your specific goals and challenges.',
    label: '1:1',
    dotColor: '#8b5cf6',
    glowColor: 'rgba(139, 92, 246, 0.4)',
    Visual: ConversationsVisual,
  },
  {
    id: 'mentors',
    title: 'Verified Mentors',
    description: 'Every mentor profile and approval status is managed by Suggest Key.',
    label: 'Verified',
    dotColor: '#60a5fa',
    glowColor: 'rgba(96, 165, 250, 0.4)',
    Visual: VerifiedMentorsVisual,
  },
  {
    id: 'availability',
    title: 'Real Availability',
    description: 'See genuine open slots and book times that actually work for you.',
    label: 'Calendar',
    dotColor: '#22d3ee',
    glowColor: 'rgba(34, 211, 238, 0.4)',
    Visual: RealAvailabilityVisual,
  },
  {
    id: 'details',
    title: 'Session Details',
    description: 'Know exactly what you are getting — duration, price, and scope before booking.',
    label: 'Scope',
    dotColor: '#fbbf24',
    glowColor: 'rgba(251, 191, 36, 0.4)',
    Visual: SessionDetailsVisual,
  },
  {
    id: 'outcomes',
    title: 'Actionable Outcomes',
    description: 'Leave each session with clear next steps and measurable progress.',
    label: 'Progress',
    dotColor: '#34d399',
    glowColor: 'rgba(52, 211, 153, 0.4)',
    Visual: ActionableOutcomesVisual,
  },
  {
    id: 'booking',
    title: 'Secure Booking',
    description: 'Protected payments, clear booking states, and platform-mediated support.',
    label: 'Secure',
    dotColor: '#34d399',
    glowColor: 'rgba(52, 211, 153, 0.4)',
    Visual: SecureBookingVisual,
  },
];

// ============================================================
// Card component
// ============================================================
interface LandingFeatureCardProps {
  feature: FeatureData;
  index: number;
  canAnimate: boolean;
}

export const LandingFeatureCard: React.FC<LandingFeatureCardProps> = ({ feature, index, canAnimate }) => {
  const { title, description, label, dotColor, glowColor, Visual } = feature;

  return (
    <motion.div
      initial={canAnimate ? { opacity: 0, y: 24 } : false}
      whileInView={canAnimate ? { opacity: 1, y: 0 } : undefined}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.6, delay: index * 0.08, ease: 'easeOut' }}
      whileHover={{ y: -6 }}
      className={cn(
        'group relative rounded-2xl border border-[var(--color-shell-border)]',
        'bg-[var(--color-shell-surface)]/60 p-7',
        'hover:border-[var(--color-shell-border-strong)] transition-colors duration-200',
        'focus-within:border-[var(--color-shell-border-strong)] focus-within:outline-none',
        'dark-scene'
      )}
      style={{
        boxShadow: 'var(--hero-card-shadow)',
      }}
    >
      <div className="absolute -inset-px rounded-2xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <div
          className="absolute -inset-3 rounded-[22px] blur-[20px] opacity-0 group-hover:opacity-100 transition-opacity duration-250"
          style={{ background: `radial-gradient(circle at 50% 30%, ${glowColor}, transparent 70%)` }}
        />
      </div>

      <div className="relative mb-4 flex justify-center transition-transform duration-250 group-hover:scale-[1.03]">
        <div className="absolute inset-0 rounded-xl blur-[8px] opacity-0 group-hover:opacity-60 transition-opacity duration-250"
          style={{ background: `radial-gradient(circle, ${glowColor}, transparent 70%)` }} />
        <Visual />
      </div>

      <div className="relative space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: dotColor }} />
          <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-shell-text-muted)]">
            {label}
          </span>
        </div>
        <h3 className="text-[18px] font-medium text-[var(--color-shell-text)] leading-snug">
          {title}
        </h3>
        <p className="text-xs text-[var(--color-shell-text-muted)] leading-relaxed">
          {description}
        </p>
      </div>
    </motion.div>
  );
};

// ============================================================
// Section component
// ============================================================
export const LandingFeatureSection: React.FC = () => {
  const shouldReduceMotion = useReducedMotion();
  const canAnimate = shouldReduceMotion === false;

  return (
    <section className="relative z-10 px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
      <SharedFilters />

      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[480px] opacity-50"
          style={{
            background: 'var(--landing-aurora-1)',
            filter: 'blur(90px)',
          }}
        />
        <div className="absolute inset-0 landing-grid opacity-[0.03]" />
      </div>

      <div className="relative max-w-[1240px] mx-auto">
        <motion.div
          initial={canAnimate ? { opacity: 0, y: 20 } : false}
          whileInView={canAnimate ? { opacity: 1, y: 0 } : undefined}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="text-center mb-12 sm:mb-16"
        >
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-medium tracking-tight text-[var(--color-shell-text)] leading-[1.15]" style={{ fontFamily: 'var(--font-aeonikpro)' }}>
            A better way to
            <br />
            <span className="hero-text-gradient">
              Ask, Learn and Move Forward.
            </span>
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((feature, i) => (
            <LandingFeatureCard
              key={feature.id}
              feature={feature}
              index={i}
              canAnimate={canAnimate}
            />
          ))}
        </div>
      </div>
    </section>
  );
};

// ============================================================
// How It Works SVG Illustrations
// ============================================================

function DiscoverVisual() {
  return (
    <svg viewBox="0 0 320 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-auto">
      <defs>
        <radialGradient id="grad-panel-dw" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#1a1f2d" />
          <stop offset="100%" stopColor="#0d1117" />
        </radialGradient>
      </defs>
      <rect x="24" y="20" width="272" height="160" rx="16" fill="url(#grad-panel-dw)" stroke="rgba(186,215,247,0.08)" strokeWidth="1" />
      <g filter="url(#sk-glow-purple)">
        <circle cx="112" cy="100" r="34" fill="rgba(139,92,246,0.12)" stroke="rgba(186,215,247,0.18)" strokeWidth="2" />
        <line x1="142" y1="128" x2="166" y2="152" stroke="rgba(186,215,247,0.45)" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g>
        <circle cx="52" cy="62" r="12" fill="rgba(186,214,247,0.12)" stroke="rgba(186,215,247,0.1)" strokeWidth="1" />
        <circle cx="172" cy="62" r="12" fill="rgba(186,214,247,0.12)" stroke="rgba(186,215,247,0.1)" strokeWidth="1" />
        <circle cx="48" cy="138" r="12" fill="rgba(186,214,247,0.12)" stroke="rgba(186,215,247,0.1)" strokeWidth="1" />
        <circle cx="176" cy="138" r="12" fill="rgba(186,214,247,0.12)" stroke="rgba(186,215,247,0.1)" strokeWidth="1" />
      </g>
      <g fill="#8b5cf6">
        <circle cx="78" cy="44" r="1.5" />
        <circle cx="140" cy="48" r="1.5" />
        <circle cx="115" cy="42" r="2" />
      </g>
      <text x="160" y="172" textAnchor="middle" fill="#64748b" fontSize="10" fontFamily="Inter">Discovered mentors</text>
    </svg>
  );
}

function ChooseVisual() {
  return (
    <svg viewBox="0 0 320 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-auto">
      <defs>
        <radialGradient id="grad-panel-cw" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#1a1f2d" />
          <stop offset="100%" stopColor="#0d1117" />
        </radialGradient>
        <linearGradient id="grad-card-cw" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#131a27" />
          <stop offset="100%" stopColor="#0d1117" />
        </linearGradient>
      </defs>
      <rect x="24" y="20" width="272" height="160" rx="16" fill="url(#grad-panel-cw)" stroke="rgba(186,215,247,0.08)" strokeWidth="1" />
      <g transform="translate(70, 60)">
        <rect width="180" height="100" rx="12" fill="url(#grad-card-cw)" stroke="rgba(186,215,247,0.12)" strokeWidth="1" />
        <circle cx="40" cy="28" r="18" fill="url(#grad-mentor)" stroke="rgba(186,215,247,0.1)" strokeWidth="1" />
        <rect x="75" y="20" width="70" height="6" rx="3" fill="rgba(186,215,247,0.35)" />
        <rect x="75" y="32" width="50" height="5" rx="2.5" fill="rgba(186,215,247,0.2)" />
        <rect x="15" y="58" width="150" height="24" rx="6" fill="rgba(186,215,247,0.05)" stroke="rgba(186,215,247,0.1)" strokeWidth="1" />
        <rect x="15" y="88" width="150" height="8" rx="4" fill="rgba(186,215,247,0.08)" />
      </g>
      <g filter="url(#sk-glow-blue)">
        <rect x="135" y="118" width="50" height="22" rx="6" fill="#60a5fa" />
        <text x="160" y="133" textAnchor="middle" fill="white" fontSize="10" fontFamily="Inter" fontWeight="600">10:00 AM</text>
      </g>
      <g transform="translate(240, 132)">
        <path d="M0 0 L14 16 L6 16 L6 26 L-6 26 L-6 16 L-8 16 Z" fill="#60a5fa" filter="url(#sk-glow-blue)" />
        <rect x="-2" y="-16" width="16" height="14" rx="2" fill="rgba(96,165,250,0.08)" stroke="rgba(96,165,250,0.3)" strokeWidth="1" />
      </g>
    </svg>
  );
}

function BookVisual() {
  return (
    <svg viewBox="0 0 320 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-auto">
      <defs>
        <radialGradient id="grad-panel-bk" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#1a1f2d" />
          <stop offset="100%" stopColor="#0d1117" />
        </radialGradient>
        <linearGradient id="grad-card-bk" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#131a27" />
          <stop offset="100%" stopColor="#0d1117" />
        </linearGradient>
      </defs>
      <rect x="24" y="20" width="272" height="160" rx="16" fill="url(#grad-panel-bk)" stroke="rgba(186,215,247,0.08)" strokeWidth="1" />
      <g filter="url(#sk-glow-cyan)">
        <rect x="80" y="50" width="160" height="100" rx="10" fill="url(#grad-card-bk)" stroke="rgba(186,215,247,0.1)" strokeWidth="1" />
        <rect x="80" y="50" width="160" height="22" rx="10" fill="rgba(186,215,247,0.05)" />
        <rect x="100" y="60" width="120" height="6" rx="3" fill="rgba(186,215,247,0.08)" />
        <text x="100" y="80" fill="#d1e4fa" fontSize="9" fontFamily="Inter" fontWeight="500">Calendar</text>
        <rect x="100" y="88" width="8" height="8" rx="1" fill="#22d3ee" />
        <text x="100" y="100" fill="#9da7ba" fontSize="9" fontFamily="Inter">Dec 15</text>
      </g>
      <g transform="translate(80, 165)">
        <rect width="80" height="36" rx="6" fill="rgba(186,215,247,0.04)" stroke="rgba(186,215,247,0.1)" strokeWidth="1" />
        <rect x="8" y="8" width="12" height="8" rx="1.5" fill="rgba(186,215,247,0.25)" />
        <rect x="28" y="8" width="12" height="8" rx="1.5" fill="rgba(186,215,247,0.15)" />
        <rect x="48" y="20" width="24" height="4" rx="2" fill="rgba(186,215,247,0.1)" />
        <rect x="48" y="26" width="16" height="3" rx="1.5" fill="rgba(186,215,247,0.08)" />
      </g>
      <g filter="url(#sk-glow-green)" transform="translate(240, 160)">
        <circle cx="0" cy="0" r="12" fill="#0f172a" stroke="#34d399" strokeWidth="1.5" />
        <path d="M-3 0 L-1 2 L3 -2" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

function GrowVisual() {
  return (
    <svg viewBox="0 0 320 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-auto">
      <defs>
        <radialGradient id="grad-panel-gw" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#1a1f2d" />
          <stop offset="100%" stopColor="#0d1117" />
        </radialGradient>
        <linearGradient id="grad-line-gw" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
        <linearGradient id="grad-area-gw" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="24" y="20" width="272" height="160" rx="16" fill="url(#grad-panel-gw)" stroke="rgba(186,215,247,0.08)" strokeWidth="1" />
      <g transform="translate(55, 135)">
        <line x1="0" y1="0" x2="210" y2="0" stroke="rgba(186,215,247,0.06)" strokeWidth="1" />
        <path
          d="M0 0 L45 -25 L90 -40 L135 -35 L180 -18 L210 0 V20 H0 Z"
          fill="url(#grad-area-gw)"
        />
        <path
          d="M0 0 L45 -25 L90 -40 L135 -35 L180 -18 L210 0"
          fill="none"
          stroke="url(#grad-line-gw)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="0" cy="0" r="4" fill="#34d399" />
        <circle cx="45" cy="-25" r="4" fill="#34d399" />
        <circle cx="90" cy="-40" r="4" fill="#34d399" />
        <circle cx="135" cy="-35" r="4" fill="#34d399" />
        <circle cx="180" cy="-18" r="4" fill="#34d399" />
        <g filter="url(#sk-glow-green)" transform="translate(210, 0)">
          <circle cx="0" cy="0" r="9" fill="#34d399" />
          <path d="M-2.5 -2.5 L0 3 L4 -3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
      <g transform="translate(230, 100)">
        <circle cx="0" cy="0" r="18" fill="#0f172a" stroke="rgba(186,215,247,0.1)" strokeWidth="1" filter="url(#sk-glow-green)" />
        <path d="M0 -6 L4 0 L0 4 Z M-4 0 L0 4 L0 -2 Z" fill="#fbbf24" />
        <line x1="-5" y1="8" x2="5" y2="8" stroke="rgba(186,215,247,0.2)" strokeWidth="1.5" strokeLinecap="round" />
      </g>
      <text x="160" y="172" textAnchor="middle" fill="#64748b" fontSize="10" fontFamily="Inter">Clear next steps</text>
    </svg>
  );
}

// ============================================================
// How It Works data
// ============================================================
interface StepData {
  num: string;
  title: string;
  description: string;
  dotColor: string;
  glowColor: string;
  Visual: React.FC;
}

const HOW_IT_WORKS_STEPS: StepData[] = [
  {
    num: '01',
    title: 'Discover',
    description: 'Find a mentor relevant to what you need.',
    dotColor: '#8b5cf6',
    glowColor: 'rgba(139, 92, 246, 0.4)',
    Visual: DiscoverVisual,
  },
  {
    num: '02',
    title: 'Choose',
    description: 'Explore their session and select a valid time.',
    dotColor: '#60a5fa',
    glowColor: 'rgba(96, 165, 250, 0.4)',
    Visual: ChooseVisual,
  },
  {
    num: '03',
    title: 'Book',
    description: 'Secure your session through the platform.',
    dotColor: '#22d3ee',
    glowColor: 'rgba(34, 211, 238, 0.4)',
    Visual: BookVisual,
  },
  {
    num: '04',
    title: 'Grow',
    description: 'Attend the session and receive useful next steps.',
    dotColor: '#34d399',
    glowColor: 'rgba(52, 211, 153, 0.4)',
    Visual: GrowVisual,
  },
];

// ============================================================
// How It Works section component
// ============================================================
export const LandingHowItWorksSection: React.FC = () => {
  const shouldReduceMotion = useReducedMotion();
  const canAnimate = shouldReduceMotion === false;

  return (
    <section id="how-it-works" className="relative z-10 px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
      <SharedFilters />

      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[480px] opacity-50"
          style={{
            background: 'var(--landing-aurora-2)',
            filter: 'blur(90px)',
          }}
        />
        <div className="absolute inset-0 landing-grid opacity-[0.03]" />
      </div>

      <div className="relative max-w-[1240px] mx-auto">
        <motion.div
          initial={canAnimate ? { opacity: 0, y: 20 } : false}
          whileInView={canAnimate ? { opacity: 1, y: 0 } : undefined}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="text-center mb-12 sm:mb-16"
        >
          <div className="section-eyebrow">How It Works</div>
          <h2 className="text-3xl sm:text-4xl font-medium tracking-tight text-[var(--color-shell-text)] leading-[1.15]" style={{ fontFamily: 'var(--font-aeonikpro)' }}>
            From a question to a conversation.
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {HOW_IT_WORKS_STEPS.map((step, i) => (
            <motion.div
              key={step.num}
              initial={canAnimate ? { opacity: 0, y: 24 } : false}
              whileInView={canAnimate ? { opacity: 1, y: 0 } : undefined}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.6, delay: i * 0.08, ease: 'easeOut' }}
              whileHover={{ y: -6 }}
              className={cn(
                'group relative rounded-2xl border border-[var(--color-shell-border)]',
                'bg-[var(--color-shell-surface)]/60 p-6',
                'hover:border-[var(--color-shell-border-strong)] transition-colors duration-200',
                'focus-within:border-[var(--color-shell-border-strong)] focus-within:outline-none',
                'dark-scene'
              )}
              style={{
                boxShadow: 'var(--hero-card-shadow)',
              }}
            >
              <div className="absolute -inset-px rounded-2xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <div
                  className="absolute -inset-3 rounded-[22px] blur-[20px] opacity-0 group-hover:opacity-100 transition-opacity duration-250"
                  style={{ background: `radial-gradient(circle at 50% 30%, ${step.glowColor}, transparent 70%)` }}
                />
              </div>

              <div className="flex justify-center mb-4">
                <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-[var(--color-shell-primary-soft)] border border-[var(--color-shell-primary)]/30 text-[var(--color-shell-primary)] text-xs font-mono font-medium">
                  {step.num}
                </span>
              </div>

              <div className="relative mb-4 flex justify-center">
                <div className="absolute inset-0 rounded-xl blur-[8px] opacity-0 group-hover:opacity-60 transition-opacity duration-250"
                  style={{ background: `radial-gradient(circle, ${step.glowColor}, transparent 70%)` }} />
                <step.Visual />
              </div>

              <div className="relative space-y-2">
                <h3 className="text-[18px] font-medium text-[var(--color-shell-text)] leading-tight">
                  {step.title}
                </h3>
                <p className="text-xs text-[var(--color-shell-text-muted)] leading-relaxed">
                  {step.description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};
