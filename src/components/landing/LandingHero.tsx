import React from 'react';
import { Button } from '@/src/components/ui/Button';
import { Enter } from '@/src/components/landing/Reveal';
import { HeroConversationVisual } from '@/src/components/landing/HeroConversationVisual';
import { HeroSegmentBubbles } from '@/src/components/landing/HeroSegmentBubbles';
import { HERO_ARROW, ROUTE_MENTOR_SIGNUP, TRUST_POINTS } from '@/src/components/landing/landingContent';
import type { Segment } from '@/src/types/database';

export interface LandingHeroProps {
  findMentorPath: string;
  onNavigate: (href: string) => void;
  /** The same live catalogue the section below the hero renders from. */
  segments: Segment[];
  isLoadingSegments: boolean;
  onSegmentOpen: (segment: Segment) => void;
}

/**
 * HERO.
 *
 * Composition, left to right: the message, then a human scene, with the LIVE
 * mentorship areas floating around that scene. The bubbles sit on the visual
 * because they are the bridge between "a conversation" and "here are the areas we
 * actually cover" — they are the first thing a visitor can actually click.
 *
 * Everything on the left is a mechanic the product implements (approval, fees
 * shown before payment, private 1:1). There is no rating, review count or
 * testimonial on this page, because there is no review system behind any of it.
 */
export const LandingHero: React.FC<LandingHeroProps> = ({
  findMentorPath,
  onNavigate,
  segments,
  isLoadingSegments,
  onSegmentOpen,
}) => (
  <section className="relative isolate overflow-hidden bg-[var(--sk-brand-plum)]">
    {/* Ambient lighting. Clipped by `isolate overflow-hidden`, so the large
        blurred shapes below can never widen the document at any viewport. */}
    <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
      <div className="landing-grid absolute inset-0 opacity-50" />
      <div
        className="absolute -left-48 -top-64 h-[640px] w-[640px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(102,58,243,0.5), transparent 62%)', filter: 'blur(40px)' }}
      />
      <div
        className="absolute -right-40 top-0 h-[560px] w-[560px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(37,99,235,0.3), transparent 64%)', filter: 'blur(40px)' }}
      />
      <div
        className="absolute bottom-[-220px] left-1/4 h-[420px] w-[520px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(247,210,67,0.11), transparent 66%)', filter: 'blur(40px)' }}
      />
    </div>
    <div className="mx-auto grid max-w-[1280px] grid-cols-1 items-center gap-8 px-4 pb-24 pt-10 sm:px-6 sm:pb-28 sm:pt-14 lg:grid-cols-[47fr_53fr] lg:gap-6 lg:px-8 lg:pb-32 lg:pt-16">
      {/* LEFT - the message */}
      <div className="max-w-xl lg:pr-2">
        <Enter>
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--sk-brand-header-border)] bg-white/[0.06] px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--sk-brand-gold)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--sk-brand-gold)]" aria-hidden="true" />
            1:1 mentorship marketplace
          </span>
        </Enter>

        <Enter delay={0.06}>
          <h1
            className="mt-5 text-[34px] font-medium leading-[1.05] tracking-tight text-[var(--sk-brand-header-text)] sm:text-[48px] lg:text-[64px]"
            style={{ fontFamily: 'var(--font-aeonikpro)' }}
          >
            The right mentor
            <br />
            for the questions
            <br />
            <span className="text-[var(--sk-brand-gold)]">that matter.</span>
          </h1>
        </Enter>

        <Enter delay={0.12}>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-[var(--sk-brand-header-muted)] sm:text-base">
            Find a verified mentor, choose a time that works for you, and have a private 1:1 conversation built
            around your situation.
          </p>
        </Enter>

        <Enter delay={0.18}>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              size="lg"
              onClick={() => onNavigate(findMentorPath)}
              className="min-h-[52px] gap-2 rounded-xl bg-[var(--sk-brand-gold)] px-7 text-[15px] font-semibold text-[var(--sk-brand-on-gold)] hover:bg-[var(--sk-brand-gold-deep)] hover:shadow-[0_14px_34px_-14px_rgba(247,210,67,0.7)]"
            >
              Find a Mentor {HERO_ARROW}
            </Button>
            <Button
              size="lg"
              onClick={() => onNavigate(ROUTE_MENTOR_SIGNUP)}
              className="min-h-[52px] rounded-xl border border-white/20 bg-white/[0.06] px-7 text-[15px] text-[var(--sk-brand-header-text)] hover:bg-white/[0.12]"
            >
              Become a Mentor
            </Button>
          </div>
        </Enter>

        <Enter delay={0.24}>
          <ul className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            {TRUST_POINTS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2 text-[13px] text-[var(--sk-brand-header-muted)]">
                <Icon className="h-4 w-4 shrink-0 text-[var(--sk-brand-gold)]" aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
        </Enter>
      </div>

      {/* RIGHT - the human scene, with live areas floating around it */}
      <div className="relative mx-auto w-full max-w-[560px] lg:max-w-none">
        <HeroConversationVisual className="mx-auto aspect-[560/620] w-full max-w-[480px] sm:max-w-[520px] lg:max-w-[560px]" />

        {/* The bubbles share the live catalogue with the section below, and are
            positioned against this relatively-positioned box so they orbit the
            figure rather than escaping into the page. */}
        <HeroSegmentBubbles segments={segments} isLoading={isLoadingSegments} onOpen={onSegmentOpen} />
      </div>
    </div>
  </section>
);
