import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  Compass,
  Calendar,
  Bell,
  Settings,
  Search,
  ArrowRight,
  Check,
  Shield,
  Clock,
  Lock,
  Sparkles,
  Menu,
  X,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { fetchActiveSegments } from '@/src/lib/discoveryService';
import { useNavigation } from '@/src/context/NavigationContext';
import type { Segment } from '@/src/types/database';

const NAV_ITEMS = [
  { label: 'Explore Mentors', href: '/seeker/mentors' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'For Mentors', href: '#for-mentors' },
];

const FEATURES = [
  { icon: Sparkles, title: 'Focused 1:1 conversations', description: 'Dedicated sessions tailored to your specific goals and challenges.' },
  { icon: Shield, title: 'Verified mentors', description: 'Every mentor is vetted for expertise, experience, and communication quality.' },
  { icon: Clock, title: 'Real availability', description: 'See genuine open slots and book at times that actually work for you.' },
  { icon: Calendar, title: 'Transparent session details', description: 'Know exactly what you are getting — duration, price, and scope before booking.' },
  { icon: Check, title: 'Actionable outcomes', description: 'Leave each session with clear next steps and measurable progress.' },
  { icon: Lock, title: 'Secure booking', description: 'Protected payments, cancellation policies, and platform-mediated dispute resolution.' },
];

const HOW_STEPS = [
  { num: '01', title: 'Discover', desc: 'Find a mentor relevant to what you need.' },
  { num: '02', title: 'Choose', desc: 'Explore their session and select a valid time.' },
  { num: '03', title: 'Book', desc: 'Secure your session through the platform.' },
  { num: '04', title: 'Grow', desc: 'Attend the session and receive useful next steps.' },
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
    <div className="min-h-screen bg-[#05060f] text-[#d1e4fa] antialiased overflow-x-hidden">
      {/* Background Grid + Spotlight */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `
              linear-gradient(rgba(186,215,247,0.06) 1px, transparent 1px),
              linear-gradient(90deg, rgba(186,215,247,0.06) 1px, transparent 1px)
            `,
            backgroundSize: '80px 80px',
            maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 70%)',
            WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 70%)',
          }}
        />
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[600px]"
          style={{
            background: 'conic-gradient(from 90deg at 50% 50%, transparent 45%, rgba(124,145,182,0.3) 49%, rgba(124,145,182,0.5) 50%, rgba(124,145,182,0.3) 51%, transparent 55%)',
            filter: 'blur(60px)',
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-50 border-b border-[rgba(186,215,247,0.12)] bg-[#05060f]/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d1e4fa] rounded-lg p-1 transition-transform active:scale-[0.98] cursor-pointer"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#05060f] font-bold text-base shadow-xs ring-1 ring-white/20">
              <Sparkles className="h-5 w-5 text-[#663af3]" />
            </div>
            <span className="text-base font-bold tracking-tight text-white block leading-tight font-[var(--font-aeonikpro)]">
              Suggest Key
            </span>
          </button>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1" aria-label="Main Navigation">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.label}
                onClick={() => {
                  if (item.href.startsWith('#')) {
                    const el = document.querySelector(item.href);
                    el?.scrollIntoView({ behavior: 'smooth' });
                  } else {
                    navigate(item.href);
                  }
                }}
                className="px-3 py-2 text-xs font-medium text-[#c7d3ea] hover:text-white hover:bg-white/5 rounded-lg transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d1e4fa]"
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-3">
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
              className="text-xs gap-1.5 bg-[#663af3] hover:bg-[#663af3]/90 text-white shadow-xs"
            >
              Get Started
            </Button>
          </div>

          {/* Mobile Hamburger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2.5 text-[#c7d3ea] hover:text-white rounded-lg hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d1e4fa] cursor-pointer"
            aria-label="Toggle Navigation"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-[rgba(186,215,247,0.12)] bg-[#05060f]/95 backdrop-blur-md px-5 py-4 space-y-2">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.label}
                onClick={() => {
                  if (item.href.startsWith('#')) {
                    const el = document.querySelector(item.href);
                    el?.scrollIntoView({ behavior: 'smooth' });
                  } else {
                    navigate(item.href);
                  }
                  setMobileMenuOpen(false);
                }}
                className="block w-full text-left px-3 py-2.5 text-sm text-[#c7d3ea] hover:text-white hover:bg-white/5 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d1e4fa]"
              >
                {item.label}
              </button>
            ))}
            <div className="pt-2 border-t border-[rgba(186,215,247,0.12)] flex flex-col gap-2">
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
                className="w-full text-xs bg-[#663af3] hover:bg-[#663af3]/90 text-white"
              >
                Get Started
              </Button>
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
          className="space-y-6 max-w-3xl mx-auto"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(186,215,247,0.12)] bg-white/[0.03] px-4 py-1.5 text-xs font-medium text-[#c7d3ea]">
            <Sparkles className="h-3.5 w-3.5 text-[#b6d9fc]" />
            <span className="tracking-wider uppercase">1:1 Mentorship, Built Around You</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-medium tracking-tight text-white leading-[1.14]" style={{ fontFamily: 'var(--font-aeonikpro)' }}>
            Find the right mentor.
            <br />
            <span className="bg-gradient-to-b from-[#d8ecf8] to-[#98c0ef] bg-clip-text text-transparent">
              Book meaningful 1:1 guidance.
            </span>
          </h1>

          <p className="max-w-xl mx-auto text-base sm:text-lg text-[#c7d3ea] leading-relaxed">
            Discover verified mentors, choose a time that works for you, and turn a focused conversation into actionable next steps.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Button
              size="lg"
              onClick={() => navigate('/seeker/mentors')}
              className="gap-2 text-sm bg-[#663af3] hover:bg-[#663af3]/90 text-white shadow-xs min-h-[48px] px-6"
            >
              Find a Mentor
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => navigate('/auth/signup')}
              className="gap-2 text-sm border-[rgba(186,215,247,0.12)] bg-white/[0.03] text-white hover:bg-white/[0.06] min-h-[48px] px-6"
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
              className="hidden sm:flex flex-col w-52 rounded-2xl border border-[rgba(186,215,247,0.12)] bg-[rgba(186,214,247,0.03)] p-5 backdrop-blur-sm shadow-lg shrink-0"
              style={{ transform: 'rotateY(8deg) rotateX(4deg)' }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="h-10 w-10 rounded-full bg-[rgba(186,214,247,0.1)] flex items-center justify-center text-sm font-bold text-white">DR</div>
                <div>
                  <div className="text-xs font-semibold text-white">Dana Reyes</div>
                  <div className="text-[10px] text-[#9da7ba]">Career Mentor</div>
                </div>
              </div>
              <div className="h-2 w-20 rounded bg-[rgba(186,215,247,0.1)] mb-2" />
              <div className="h-2 w-28 rounded bg-[rgba(186,215,247,0.06)] mb-4" />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#c7d3ea]">Next slot</span>
                <span className="text-[10px] font-medium text-[#b6d9fc]">2:00 PM</span>
              </div>
            </motion.div>

            {/* Center Card - Booking */}
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
              className="flex flex-col w-full sm:w-72 rounded-2xl border border-[rgba(186,215,247,0.12)] bg-[rgba(5,6,15,0.97)] p-6 backdrop-blur-md z-10"
              style={{ boxShadow: 'inset 0 1px 1px rgba(216,236,248,0.2), inset 0 24px 48px rgba(168,216,245,0.06), 0 16px 32px rgba(0,0,0,0.3)' }}
            >
              <div className="flex items-center gap-2 mb-4">
                <div className="h-2 w-2 rounded-full bg-[#663af3]" />
                <span className="text-[10px] font-medium text-[#c7d3ea] uppercase tracking-wider">Confirmed Session</span>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#9da7ba]">Session</span>
                  <span className="text-xs font-medium text-white">Career Strategy</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#9da7ba]">Date</span>
                  <span className="text-xs text-white">Dec 15, 2026</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#9da7ba]">Time</span>
                  <span className="text-xs text-white">10:00 AM IST</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#9da7ba]">Duration</span>
                  <span className="text-xs text-white">60 mins</span>
                </div>
                <div className="h-px bg-[rgba(186,215,247,0.12)] my-2" />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#9da7ba]">Price</span>
                  <span className="text-xs font-semibold text-white">₹2,500 INR</span>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-[10px] text-emerald-400">Mentor confirmed</span>
              </div>
            </motion.div>

            {/* Right Card - Outcome */}
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
              className="hidden sm:flex flex-col w-52 rounded-2xl border border-[rgba(186,215,247,0.12)] bg-[rgba(186,214,247,0.03)] p-5 backdrop-blur-sm shadow-lg shrink-0"
              style={{ transform: 'rotateY(-8deg) rotateX(4deg)' }}
            >
              <div className="flex items-center gap-2 mb-3">
                <Compass className="h-4 w-4 text-[#b6d9fc]" />
                <span className="text-[10px] font-medium text-[#c7d3ea] uppercase tracking-wider">Outcome</span>
              </div>
              <div className="space-y-2">
                <div className="h-2 w-24 rounded bg-[rgba(186,215,247,0.1)]" />
                <div className="h-2 w-20 rounded bg-[rgba(186,215,247,0.06)]" />
                <div className="h-2 w-28 rounded bg-[rgba(186,215,247,0.06)]" />
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
      <section id="how-it-works" className="relative z-10 px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
        <div className="max-w-[1200px] mx-auto">
          <div className="text-center space-y-4 mb-16">
            <div className="section-eyebrow">How It Works</div>
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight text-white" style={{ fontFamily: 'var(--font-aeonikpro)' }}>
              From a question to a conversation.
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {HOW_STEPS.map((step, i) => (
              <motion.div
                key={step.num}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="rounded-2xl border border-[rgba(186,215,247,0.12)] bg-[rgba(186,214,247,0.03)] p-6"
              >
                <div className="text-2xl font-medium text-[#663af3] font-[var(--font-dotdigital)] mb-3">{step.num}</div>
                <h3 className="text-lg font-semibold text-white mb-2">{step.title}</h3>
                <p className="text-sm text-[#c7d3ea] leading-relaxed">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Mentorship Categories */}
      <section className="relative z-10 px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
        <div className="max-w-[1200px] mx-auto">
          <div className="text-center space-y-4 mb-12">
            <div className="section-eyebrow">Explore Mentorship</div>
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight text-white" style={{ fontFamily: 'var(--font-aeonikpro)' }}>
              Guidance for the things that matter.
            </h2>
          </div>

          {isLoadingSegments ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-2xl border border-[rgba(186,215,247,0.12)] bg-[rgba(186,214,247,0.03)] p-6 space-y-3">
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
                  className="rounded-2xl border border-[rgba(186,215,247,0.12)] bg-[rgba(186,214,247,0.03)] p-6 hover:border-[rgba(186,215,247,0.2)] transition-colors cursor-pointer group"
                  onClick={() => navigate('/auth/login')}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-semibold text-white group-hover:text-[#d1e4fa] transition-colors">{seg.name}</h3>
                    <ArrowRight className="h-4 w-4 text-[#9da7ba] group-hover:text-white transition-colors" />
                  </div>
                  <p className="text-sm text-[#c7d3ea] leading-relaxed">{seg.description || 'Explore mentors in this category.'}</p>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <p className="text-sm text-[#9da7ba]">Mentorship categories will appear here once they are available.</p>
            </div>
          )}
        </div>
      </section>

      {/* Why Suggest Key */}
      <section className="relative z-10 px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
        <div className="max-w-[1200px] mx-auto">
          <div className="text-center space-y-4 mb-16">
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight text-white" style={{ fontFamily: 'var(--font-aeonikpro)' }}>
              A better way to ask, learn and move forward.
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((feature, i) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className="rounded-2xl border border-[rgba(186,215,247,0.12)] bg-[rgba(186,214,247,0.03)] p-6"
              >
                <div className="feature-icon-tile mb-4">
                  <feature.icon className="h-5 w-5 text-[#d1e4fa]" />
                </div>
                <h3 className="text-sm font-semibold text-white mb-1.5">{feature.title}</h3>
                <p className="text-xs text-[#c7d3ea] leading-relaxed">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* For Mentors */}
      <section id="for-mentors" className="relative z-10 px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
        <div className="max-w-[1200px] mx-auto">
          <div className="rounded-2xl border border-[rgba(186,215,247,0.12)] bg-[rgba(186,214,247,0.03)] p-8 sm:p-12">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
              <div className="space-y-4">
                <div className="section-eyebrow text-left !before:!w-16 !after:!w-16">For Mentors</div>
                <h2 className="text-3xl sm:text-4xl font-medium tracking-tight text-white" style={{ fontFamily: 'var(--font-aeonikpro)' }}>
                  Have knowledge worth sharing?
                </h2>
                <p className="text-base text-[#c7d3ea] leading-relaxed">
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
                    <li key={item} className="flex items-center gap-2 text-sm text-[#c7d3ea]">
                      <Check className="h-4 w-4 text-[#663af3] shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
                <Button
                  size="md"
                  onClick={() => navigate('/auth/signup')}
                  className="mt-2 gap-2 text-sm bg-[#663af3] hover:bg-[#663af3]/90 text-white shadow-xs"
                >
                  Become a Mentor
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
              <div className="hidden lg:flex items-center justify-center">
                <motion.div
                  animate={{ y: [0, -8, 0] }}
                  transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                  className="rounded-2xl border border-[rgba(186,215,247,0.12)] bg-[rgba(5,6,15,0.97)] p-6 w-full max-w-sm"
                  style={{ boxShadow: 'inset 0 1px 1px rgba(216,236,248,0.2), inset 0 24px 48px rgba(168,216,245,0.06), 0 16px 32px rgba(0,0,0,0.3)' }}
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-10 w-10 rounded-full bg-[rgba(186,214,247,0.1)] flex items-center justify-center text-sm font-bold text-white">SK</div>
                    <div>
                      <div className="text-xs font-semibold text-white">Your Mentorship Profile</div>
                      <div className="text-[10px] text-[#9da7ba]">Setup in minutes</div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="h-2 w-3/4 rounded bg-[rgba(186,215,247,0.1)]" />
                    <div className="h-2 w-1/2 rounded bg-[rgba(186,215,247,0.06)]" />
                    <div className="h-2 w-2/3 rounded bg-[rgba(186,215,247,0.06)]" />
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <div className="h-2 w-16 rounded bg-[rgba(186,215,247,0.1)]" />
                    <div className="h-2 w-12 rounded bg-[rgba(186,215,247,0.06)]" />
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
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight text-white" style={{ fontFamily: 'var(--font-aeonikpro)' }}>
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
                <h3 className="text-sm font-semibold text-white">{principle.title}</h3>
                <p className="text-xs text-[#c7d3ea] leading-relaxed max-w-xs mx-auto">{principle.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
        <div className="max-w-2xl mx-auto text-center space-y-6">
          <h2 className="text-3xl sm:text-4xl font-medium tracking-tight text-white" style={{ fontFamily: 'var(--font-aeonikpro)' }}>
            Your next step can start with one conversation.
          </h2>
          <p className="text-base text-[#c7d3ea] leading-relaxed">
            Join Suggest Key today and connect with the right mentor for your goals.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Button
              size="lg"
              onClick={() => navigate('/seeker/mentors')}
              className="gap-2 text-sm bg-[#663af3] hover:bg-[#663af3]/90 text-white shadow-xs min-h-[48px] px-6"
            >
              Find a Mentor
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => navigate('/auth/signup')}
              className="gap-2 text-sm border-[rgba(186,215,247,0.12)] bg-white/[0.03] text-white hover:bg-white/[0.06] min-h-[48px] px-6"
            >
              Become a Mentor
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-[rgba(186,215,247,0.12)] px-4 sm:px-6 lg:px-8 py-12">
        <div className="max-w-[1200px] mx-auto">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-[#05060f] font-bold text-xs shadow-xs">
                <Sparkles className="h-4 w-4 text-[#663af3]" />
              </div>
              <span className="text-sm font-bold text-white" style={{ fontFamily: 'var(--font-aeonikpro)' }}>Suggest Key</span>
            </div>
            <nav className="flex flex-wrap items-center justify-center gap-6" aria-label="Footer Navigation">
              {[
                { label: 'About', href: '#' },
                { label: 'How It Works', href: '#how-it-works' },
                { label: 'For Mentors', href: '#for-mentors' },
                { label: 'Sign In', href: '/auth/login' },
                { label: 'Privacy', href: '#' },
                { label: 'Terms', href: '#' },
              ].map((item) => (
                <button
                  key={item.label}
                  onClick={() => {
                    if (item.href.startsWith('#')) {
                      const el = document.querySelector(item.href);
                      el?.scrollIntoView({ behavior: 'smooth' });
                    } else {
                      navigate(item.href);
                    }
                  }}
                  className="text-xs text-[#9da7ba] hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d1e4fa] rounded"
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
          <div className="mt-8 pt-6 border-t border-[rgba(186,215,247,0.06)] text-center">
            <p className="text-[10px] text-[#9da7ba]"> Suggest Key. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};