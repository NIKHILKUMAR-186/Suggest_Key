import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  Compass,
  Bell,
  Settings,
  Search,
  ArrowRight,
  Check,
  Sparkles,
  Menu,
  X,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/Button';
import { LandingFeatureSection, LandingHowItWorksSection } from '@/src/components/landing/LandingFeatureSection';
import { Badge } from '@/src/components/ui/Badge';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { ThemeToggle } from '@/src/components/ui/ThemeToggle';
import { fetchActiveSegments } from '@/src/lib/discoveryService';
import { useNavigation } from '@/src/context/NavigationContext';
import type { Segment } from '@/src/types/database';

const NAV_ITEMS = [
  { label: 'Home', href: '#' },
  { label: 'Explore Mentors', href: '/seeker/mentors' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'For Mentors', href: '#for-mentors' },
];

const PRINCIPLES = [
  { title: 'Real mentors', desc: 'Every profile represents a verified professional with genuine expertise.' },
  { title: 'Real availability', desc: 'Open slots reflect actual calendar openings, not fabricated numbers.' },
  { title: 'Secure booking', desc: 'End-to-end protected transactions with clear cancellation policies.' },
  { title: 'Clear session states', desc: 'Every booking has a transparent lifecycle from hold to completion.' },
];

export const LandingPage: React.FC = () => {
  const { navigate } = useNavigation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [isLoadingSegments, setIsLoadingSegments] = useState(true);

  const handleNavClick = (href: string) => {
    if (href === '#') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (href.startsWith('#')) {
      document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' });
    } else {
      navigate(href);
    }
  };

  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    const handleScroll = () => setShowBackToTop(window.scrollY > 400);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function loadSegments() {
      try {
        const { segments: activeSegs } = await fetchActiveSegments();
        if (isMounted) setSegments(activeSegs);
      } catch {
        if (isMounted) setSegments([]);
      } finally {
        if (isMounted) setIsLoadingSegments(false);
      }
    }
    loadSegments();
    return () => { isMounted = false; };
  }, []);

   return (
    <div className="min-h-screen bg-[var(--color-shell-bg)] text-[var(--color-shell-text)] antialiased overflow-x-hidden">
      {/* Background Grid + Spotlight */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="landing-grid absolute inset-0" />
        <div
          className="landing-spotlight absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[600px]"
          style={{ filter: 'blur(60px)' }}
        />
      </div>

      {/* Header */}
      <header className="relative z-50 border-b border-[var(--color-shell-border)] bg-[var(--color-shell-bg)]/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] rounded-lg p-1 transition-transform active:scale-[0.98] cursor-pointer"
          >
            <img src="/logo.png" alt="Suggest Key logo" className="h-9 w-9 rounded-xl object-cover shadow-xs ring-1 ring-[var(--color-shell-border-strong)]" />
            <img src="/name.png" alt="Suggest Key" className="h-6 w-auto block leading-tight" />
          </button>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1" aria-label="Main Navigation">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.label}
                onClick={() => handleNavClick(item.href)}
                className="px-3 py-2 text-xs font-medium text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] hover:bg-[var(--color-shell-surface-hover)] rounded-lg transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)]"
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/auth/login')}
              className="text-xs gap-1.5"
            >
              Sign In
            </Button>
            <Button
              size="sm"
              onClick={() => navigate('/auth/signup')}
              className="text-xs gap-1.5 bg-[var(--color-shell-primary)] hover:bg-[var(--color-shell-primary-hover)] text-[var(--color-shell-text-contrast)] shadow-xs"
            >
              Get Started
            </Button>
          </div>

          {/* Mobile Hamburger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2.5 text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] rounded-lg hover:bg-[var(--color-shell-surface-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] cursor-pointer"
            aria-label="Toggle Navigation"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-[var(--color-shell-border)] bg-[var(--color-shell-bg)]/95 backdrop-blur-md px-5 py-4 space-y-2">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.label}
                onClick={() => { handleNavClick(item.href); setMobileMenuOpen(false); }}
                className="block w-full text-left px-3 py-2.5 text-sm text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] hover:bg-[var(--color-shell-surface-hover)] rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)]"
              >
                {item.label}
              </button>
            ))}
            <div className="pt-2 border-t border-[var(--color-shell-border)] flex flex-col gap-2">
              <Button
                variant="ghost"
                size="md"
                onClick={() => { navigate('/auth/login'); setMobileMenuOpen(false); }}
                className="w-full text-xs"
              >
                Sign In
              </Button>
              <Button
                size="md"
                onClick={() => { navigate('/auth/signup'); setMobileMenuOpen(false); }}
                className="w-full text-xs bg-[var(--color-shell-primary)] hover:bg-[var(--color-shell-primary-hover)] text-[var(--color-shell-text-contrast)]"
              >
                Get Started
              </Button>
            </div>
            <div className="pt-2 border-t border-[var(--color-shell-border)] flex items-center justify-between gap-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-shell-text-subtle)]">
                Theme
              </span>
              <ThemeToggle variant="labeled" />
            </div>
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="relative z-10 flex flex-col items-center justify-center text-center px-4 sm:px-6 lg:px-8 pt-20 sm:pt-28 lg:pt-36 pb-16 sm:pb-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="flex flex-col items-center space-y-6 max-w-3xl mx-auto"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]/60 px-4 py-1.5 text-xs font-medium text-[var(--color-shell-text-muted)]">
            <Sparkles className="h-3.5 w-3.5 text-[var(--color-shell-accent)]" />
            <span className="tracking-wider uppercase">1:1 Mentorship, Built Around You</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-medium tracking-tight text-[var(--color-shell-text)] leading-[1.14]" style={{ fontFamily: 'var(--font-aeonikpro)' }}>
            Find the right mentor.
            <br />
            <span className="hero-text-gradient">
              Book meaningful 1:1 guidance.
            </span>
          </h1>

          <p className="max-w-xl mx-auto text-base sm:text-lg text-[var(--color-shell-text-muted)] leading-relaxed">
            Discover verified mentors, choose a time that works for you, and turn a focused conversation into actionable next steps.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Button
              size="lg"
              onClick={() => navigate('/seeker/mentors')}
              className="gap-2 text-sm bg-[var(--color-shell-primary)] hover:bg-[var(--color-shell-primary-hover)] text-[var(--color-shell-text-contrast)] shadow-xs min-h-[48px] px-6"
            >
              Find a Mentor
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => navigate('/auth/signup')}
              className="gap-2 text-sm border-[var(--color-shell-border-strong)] bg-[var(--color-shell-surface)]/60 text-[var(--color-shell-text)] hover:bg-[var(--color-shell-surface-hover)] min-h-[48px] px-6"
            >
              Become a Mentor
            </Button>
          </div>
        </motion.div>

        {/* Hero Visual - Abstract Glass Cards */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3, ease: 'easeOut' }}
          className="mt-16 sm:mt-20 w-full max-w-4xl relative"
        >
          <div className="relative flex items-center justify-center gap-4 sm:gap-6 perspective-1000">
            {/* Left Card - Mentor Profile */}
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              className="hidden sm:flex flex-col w-52 rounded-2xl glass-card p-5 backdrop-blur-sm shadow-lg shrink-0"
              style={{ transform: 'rotateY(8deg) rotateX(4deg)' }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="h-10 w-10 rounded-full bg-[var(--color-shell-surface-elevated)] flex items-center justify-center text-sm font-bold text-[var(--color-shell-text)] border border-[var(--color-shell-border)]">DR</div>
                <div>
                  <div className="text-xs font-semibold text-[var(--color-shell-text)]">Dana Reyes</div>
                  <div className="text-[10px] text-[var(--color-shell-text-subtle)]">Career Mentor</div>
                </div>
              </div>
              <div className="h-2 w-20 rounded bg-[var(--color-shell-border-strong)] mb-2" />
              <div className="h-2 w-28 rounded bg-[var(--color-shell-border)] mb-4" />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[var(--color-shell-text-muted)]">Next slot</span>
                <span className="text-[10px] font-medium text-[var(--color-shell-accent)]">2:00 PM</span>
              </div>
            </motion.div>

            {/* Center Card - Booking */}
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
              className="flex flex-col w-full sm:w-72 rounded-2xl hero-card p-6 backdrop-blur-md z-10"
            >
              <div className="flex items-center gap-2 mb-4">
                <div className="h-2 w-2 rounded-full bg-[var(--color-shell-primary)]" />
                <span className="text-[10px] font-medium text-[var(--color-shell-text-muted)] uppercase tracking-wider">Confirmed Session</span>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--color-shell-text-subtle)]">Session</span>
                  <span className="text-xs font-medium text-[var(--color-shell-text)]">Career Strategy</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--color-shell-text-subtle)]">Date</span>
                  <span className="text-xs text-[var(--color-shell-text)]">Dec 15, 2026</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--color-shell-text-subtle)]">Time</span>
                  <span className="text-xs text-[var(--color-shell-text)]">10:00 AM IST</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--color-shell-text-subtle)]">Duration</span>
                  <span className="text-xs text-[var(--color-shell-text)]">60 mins</span>
                </div>
                <div className="h-px bg-[var(--color-shell-border)] my-2" />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--color-shell-text-subtle)]">Price</span>
                  <span className="text-xs font-semibold text-[var(--color-shell-text)]">₹2,500 INR</span>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-[var(--color-shell-success)]" />
                <span className="text-[10px] text-[var(--color-shell-success)]">Mentor confirmed</span>
              </div>
            </motion.div>

            {/* Right Card - Outcome */}
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
              className="hidden sm:flex flex-col w-52 rounded-2xl glass-card p-5 backdrop-blur-sm shadow-lg shrink-0"
              style={{ transform: 'rotateY(-8deg) rotateX(4deg)' }}
            >
              <div className="flex items-center gap-2 mb-3">
                <Compass className="h-4 w-4 text-[var(--color-shell-accent)]" />
                <span className="text-[10px] font-medium text-[var(--color-shell-text-muted)] uppercase tracking-wider">Outcome</span>
              </div>
              <div className="space-y-2">
                <div className="h-2 w-24 rounded bg-[var(--color-shell-border-strong)]" />
                <div className="h-2 w-20 rounded bg-[var(--color-shell-border)]" />
                <div className="h-2 w-28 rounded bg-[var(--color-shell-border)]" />
              </div>
              <div className="mt-4 flex flex-wrap gap-1">
                <Badge className="text-[9px] py-0 px-1.5">Action Plan</Badge>
                <Badge className="text-[9px] py-0 px-1.5">Next Steps</Badge>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </section>

      {/* How It Works */}
      <LandingHowItWorksSection />

      {/* Mentorship Categories */}
      <section className="relative z-10 px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
        <div className="max-w-[1200px] mx-auto">
          <div className="text-center space-y-4 mb-12">
            <div className="section-eyebrow">Explore Mentorship</div>
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight text-[var(--color-shell-text)]" style={{ fontFamily: 'var(--font-aeonikpro)' }}>
              Guidance for the things that matter.
            </h2>
          </div>

          {isLoadingSegments ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]/60 p-6 space-y-3">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ))}
            </div>
          ) : segments && segments.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {segments.map((seg) => (
                <motion.div
                  key={seg.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5 }}
                  className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]/60 p-6 hover:border-[var(--color-shell-border-strong)] transition-colors cursor-pointer group"
                  onClick={() => navigate('/auth/login')}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-semibold text-[var(--color-shell-text)] group-hover:text-[var(--color-shell-accent)] transition-colors">{seg.name}</h3>
                    <ArrowRight className="h-4 w-4 text-[var(--color-shell-text-subtle)] group-hover:text-[var(--color-shell-text)] transition-colors" />
                  </div>
                  <p className="text-sm text-[var(--color-shell-text-muted)] leading-relaxed">{seg.description || 'Explore mentors in this category.'}</p>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <p className="text-sm text-[var(--color-shell-text-subtle)]">Mentorship categories will appear here once they are available.</p>
            </div>
          )}
        </div>
      </section>

      {/* Why Suggest Key */}
      <LandingFeatureSection />

      {/* For Mentors */}
      <section id="for-mentors" className="relative z-10 px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
        <div className="max-w-[1200px] mx-auto">
          <div className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]/60 p-8 sm:p-12">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
              <div className="space-y-4">
                <div className="section-eyebrow text-left !before:!w-16 !after:!w-16">For Mentors</div>
                <h2 className="text-3xl sm:text-4xl font-medium tracking-tight text-[var(--color-shell-text)]" style={{ fontFamily: 'var(--font-aeonikpro)' }}>
                  Have knowledge worth sharing?
                </h2>
                <p className="text-base text-[var(--color-shell-text-muted)] leading-relaxed">
                  Help someone move forward with focused 1:1 mentorship.
                </p>
                <ul className="space-y-2 pt-2">
                  {[
                    'Create your mentorship profile',
                    'Configure your sessions',
                    'Manage availability',
                    'Meet seekers',
                    'Provide actionable guidance',
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-2 text-sm text-[var(--color-shell-text-muted)]">
                      <Check className="h-4 w-4 text-[var(--color-shell-primary)] shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
                <Button
                  size="md"
                  onClick={() => navigate('/auth/signup')}
                  className="mt-2 gap-2 text-sm bg-[var(--color-shell-primary)] hover:bg-[var(--color-shell-primary-hover)] text-[var(--color-shell-text-contrast)] shadow-xs"
                >
                  Become a Mentor
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
              <div className="hidden lg:flex items-center justify-center">
                <motion.div
                  animate={{ y: [0, -8, 0] }}
                  transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                  className="rounded-2xl hero-card p-6 w-full max-w-sm"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-10 w-10 rounded-full bg-[var(--color-shell-surface-elevated)] flex items-center justify-center text-sm font-bold text-[var(--color-shell-text)] border border-[var(--color-shell-border)]">SK</div>
                    <div>
                      <div className="text-xs font-semibold text-[var(--color-shell-text)]">Your Mentorship Profile</div>
                      <div className="text-[10px] text-[var(--color-shell-text-subtle)]">Setup in minutes</div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="h-2 w-3/4 rounded bg-[var(--color-shell-border-strong)]" />
                    <div className="h-2 w-1/2 rounded bg-[var(--color-shell-border)]" />
                    <div className="h-2 w-2/3 rounded bg-[var(--color-shell-border)]" />
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <div className="h-2 w-16 rounded bg-[var(--color-shell-border-strong)]" />
                    <div className="h-2 w-12 rounded bg-[var(--color-shell-border)]" />
                  </div>
                </motion.div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust / Platform Principles */}
      <section className="relative z-10 px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
        <div className="max-w-[1200px] mx-auto">
          <div className="text-center space-y-4 mb-16">
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight text-[var(--color-shell-text)]" style={{ fontFamily: 'var(--font-aeonikpro)' }}>
              Built on trust
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {PRINCIPLES.map((principle, i) => (
              <motion.div
                key={principle.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="text-center space-y-2"
              >
                <h3 className="text-sm font-semibold text-[var(--color-shell-text)]">{principle.title}</h3>
                <p className="text-xs text-[var(--color-shell-text-muted)] leading-relaxed max-w-xs mx-auto">{principle.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
        <div className="max-w-2xl mx-auto text-center space-y-6">
          <h2 className="text-3xl sm:text-4xl font-medium tracking-tight text-[var(--color-shell-text)]" style={{ fontFamily: 'var(--font-aeonikpro)' }}>
            Your next step can start with one conversation.
          </h2>
          <p className="text-base text-[var(--color-shell-text-muted)] leading-relaxed">
            Join Suggest Key today and connect with the right mentor for your goals.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Button
              size="lg"
              onClick={() => navigate('/seeker/mentors')}
              className="gap-2 text-sm bg-[var(--color-shell-primary)] hover:bg-[var(--color-shell-primary-hover)] text-[var(--color-shell-text-contrast)] shadow-xs min-h-[48px] px-6"
            >
              Find a Mentor
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => navigate('/auth/signup')}
              className="gap-2 text-sm border-[var(--color-shell-border-strong)] bg-[var(--color-shell-surface)]/60 text-[var(--color-shell-text)] hover:bg-[var(--color-shell-surface-hover)] min-h-[48px] px-6"
            >
              Become a Mentor
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-[var(--color-shell-border)] px-4 sm:px-6 lg:px-8 py-12">
        <div className="max-w-[1200px] mx-auto">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <img src="/logo.png" alt="Suggest Key logo" className="h-8 w-8 rounded-lg object-cover shadow-xs" />
              <img src="/name.png" alt="Suggest Key" className="h-4 w-auto block leading-tight" />
            </div>
            <nav className="flex flex-wrap items-center justify-center gap-6" aria-label="Footer Navigation">
              {[
                { label: 'Home', href: '#' },
                { label: 'About', href: '#' },
                { label: 'How It Works', href: '#how-it-works' },
                { label: 'For Mentors', href: '#for-mentors' },
                { label: 'Sign In', href: '/auth/login' },
                { label: 'Privacy', href: '#' },
                { label: 'Terms', href: '#' },
              ].map((item) => (
                <button
                  key={item.label}
                 onClick={() => handleNavClick(item.href)}
                  className="text-xs text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] rounded"
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
          <div className="mt-8 pt-6 border-t border-[var(--color-shell-border)] text-center">
            <p className="text-[10px] text-[var(--color-shell-text-subtle)]"> Suggest Key. All rights reserved.</p>
          </div>
        </div>
      </footer>

      {showBackToTop && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="fixed bottom-8 right-8 z-40"
          aria-hidden={!showBackToTop}
        >
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="flex items-center justify-center w-12 h-12 rounded-full bg-[var(--color-shell-primary-soft)] border border-[var(--color-shell-primary)]/30 text-[var(--brand-primary-strong)] hover:bg-[var(--color-shell-primary-soft)] hover:border-[var(--color-shell-primary)]/60 hover:text-[var(--color-shell-text)] transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)]"
            aria-label="Back to top"
          >
            <ArrowRight className="h-5 w-5 -rotate-90" />
          </button>
        </motion.div>
      )}
    </div>
  );
};