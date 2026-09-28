/**
 * Safe icon registry for segment experience content.
 *
 * A configured `icon` value is DATA — an identifier, never a component name.
 * This module is the single place where an identifier is turned into a real
 * component, and it does so through an explicit `Record` lookup. There is no
 * dynamic import, no `require`, and no property access on a component
 * namespace, so a value coming from the database can never select or execute an
 * arbitrary component.
 *
 * Normalization already rejects identifiers outside `SEGMENT_ICON_KEYS`, so
 * `resolveSegmentIcon` is a second, structural line of defence: even a value
 * that bypassed normalization lands on the default icon.
 */

import {
  BookOpen,
  Brain,
  Briefcase,
  Calendar,
  Clock,
  Compass,
  Globe,
  GraduationCap,
  Heart,
  HeartHandshake,
  LifeBuoy,
  Lightbulb,
  Map,
  MessageCircle,
  Mic,
  PenLine,
  Puzzle,
  Scale,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Users,
  Video,
  Phone,
  type LucideIcon,
} from 'lucide-react';
import {
  isSafeSegmentIcon,
  type SegmentIconKey,
} from '@/src/lib/segmentExperience';

/**
 * The closed identifier -> component map.
 *
 * Adding an icon means adding an entry HERE and to `SEGMENT_ICON_KEYS`. It is
 * never driven by a string from the database.
 */
const SEGMENT_ICON_COMPONENTS: Record<SegmentIconKey, LucideIcon> = {
  sparkles: Sparkles,
  briefcase: Briefcase,
  heart: Heart,
  'message-circle': MessageCircle,
  'graduation-cap': GraduationCap,
  compass: Compass,
  'life-buoy': LifeBuoy,
  users: Users,
  calendar: Calendar,
  clock: Clock,
  target: Target,
  'book-open': BookOpen,
  lightbulb: Lightbulb,
  'shield-check': ShieldCheck,
  star: Star,
  map: Map,
  phone: Phone,
  video: Video,
  globe: Globe,
  brain: Brain,
  'heart-handshake': HeartHandshake,
  scale: Scale,
  puzzle: Puzzle,
  mic: Mic,
  'pen-line': PenLine,
};

/** Used whenever an icon is missing or unrecognised. */
export const DEFAULT_SEGMENT_ICON: LucideIcon = Sparkles;

/**
 * Resolve a configured icon identifier to a component.
 *
 * Always returns a real component, so a caller can render it unconditionally
 * rather than guarding every call site.
 */
export function resolveSegmentIcon(icon: unknown): LucideIcon {
  if (!isSafeSegmentIcon(icon)) return DEFAULT_SEGMENT_ICON;
  return SEGMENT_ICON_COMPONENTS[icon] ?? DEFAULT_SEGMENT_ICON;
}
