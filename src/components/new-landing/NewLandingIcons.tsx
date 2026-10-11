/**
 * NEW LANDING PAGE ICONS.
 *
 * The supplied design ships its iconography as inline SVG paths. They are
 * reproduced here as self-contained React components so the new variant owns
 * its art and imports nothing from the legacy landing design.
 *
 * Every icon is decorative by default (`aria-hidden`), which keeps the
 * accessible name on the surrounding text where the label actually lives.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

/** Sparkle that leads the hero pill. */
export function SparkleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M12 2c.9 6 4 9.1 10 10-6 .9-9.1 4-10 10-.9-6-4-9.1-10-10 6-.9 9.1-4 10-10z"
        fill="#fbd83d"
      />
    </Svg>
  );
}

/** Calendar glyph inside the primary hero button. */
export function CalendarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect
        x="3.5"
        y="5"
        width="17"
        height="15.5"
        rx="2.6"
        stroke="#241600"
        strokeWidth="1.9"
      />
      <path
        d="M8 2.8v4M16 2.8v4M3.5 10h17M7.5 14.2h2.2M12 14.2h.1M16 14.2h.1M7.5 17.2h3"
        stroke="#241600"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Trailing arrow inside the primary hero button. */
export function ArrowRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M3.5 12h17M14.5 5.8 20.7 12l-6.2 6.2"
        stroke="#241600"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Play glyph inside the secondary hero button. */
export function PlayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="10" stroke="#fbd83d" strokeWidth="2.1" />
      <path
        d="M10 8.3 15.6 12 10 15.7z"
        stroke="#fbd83d"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Shield-with-tick trust mark. */
export function VerifiedIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M12 2.4 20 5.6v6c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10v-6z"
        stroke="#fbd83d"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="m8.2 12.2 2.7 2.7 5-5.4"
        stroke="#fbd83d"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Heart trust mark. */
export function ConfidentialIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M12 20.6C5.2 15.2 2.4 11.8 2.4 8.4A4.9 4.9 0 0 1 7.4 3.4c1.9 0 3.6.9 4.6 2.7 1-1.8 2.7-2.7 4.6-2.7a4.9 4.9 0 0 1 5 5c0 3.4-2.8 6.8-9.6 12.2z"
        stroke="#fbd83d"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Chat trust mark. */
export function HybridIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M4 3h16a1.6 1.6 0 0 1 1.6 1.6v12.6a1.6 1.6 0 0 1-1.6 1.6h-9.6L4.6 22l.6-3.2H4a1.6 1.6 0 0 1-1.6-1.6V4.6A1.6 1.6 0 0 1 4 3z"
        stroke="#fbd83d"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />
      <path
        d="M9.6 14v-3.6M12.6 14V7.8M15.6 14v-4.6"
        stroke="#fbd83d"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Heart badge for the Relationships bubble. */
export function RelationshipBadgeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M12 20.6C5.2 15.2 2.4 11.8 2.4 8.4A4.9 4.9 0 0 1 7.4 3.4c1.9 0 3.6.9 4.6 2.7 1-1.8 2.7-2.7 4.6-2.7a4.9 4.9 0 0 1 5 5c0 3.4-2.8 6.8-9.6 12.2z"
        stroke="#7c1d3f"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Briefcase badge for the Career bubble. */
export function CareerBadgeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect
        x="3"
        y="7.5"
        width="18"
        height="12.5"
        rx="2.2"
        stroke="#3b2c00"
        strokeWidth="2"
      />
      <path
        d="M9 7.5V6a1.6 1.6 0 0 1 1.6-1.6h2.8A1.6 1.6 0 0 1 15 6v1.5M3 13h18M11 13h2"
        stroke="#3b2c00"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </Svg>
  );
}

/**
 * Autism badge mark.
 *
 * The source HTML carries this glyph as a 100KB+ inline base64 PNG. Rather
 * than copy that blob into the bundle, the mark is drawn here: a puzzle
 * piece over the badge's circular teal field, which is the symbol the design
 * itself uses for the autism category.
 */
export function AutismBadgeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M9.6 3.2h2.1a1 1 0 0 1 1 1v1.2a2.4 2.4 0 0 1 0 4.6v2.1a2.4 2.4 0 0 0 0 4.7v2.1a1 1 0 0 1-1 1H9.6a2 2 0 0 1-2-2v-3.7a2.4 2.4 0 0 1 0-4.2V5.2a2 2 0 0 1 2-2z"
        fill="#0b6b2f"
      />
      <path
        d="M14.8 6.4h1.9a1 1 0 0 1 1 1v1.3a2.3 2.3 0 0 1 0 4.4v3.5a1 1 0 0 1-1 1h-2.3a2.4 2.4 0 0 1-2.4-2.4V8.8A2.4 2.4 0 0 1 14.8 6.4z"
        fill="#0b6b2f"
      />
    </Svg>
  );
}
