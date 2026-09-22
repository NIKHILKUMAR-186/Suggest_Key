import React from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { Button } from '@/src/components/ui/Button';
import {
  Compass,
  Calendar,
  MessageCircle,
  Shield,
  Star,
  Users,
  ArrowRight,
  KeyRound,
  LogIn,
  UserPlus,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';

const Header: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const { navigate } = useNavigation();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-[#05060f]/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 rounded-lg p-1 transition-transform active:scale-[0.98] cursor-pointer"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#663af3] text-white font-bold text-base shadow-lg ring-1 ring-violet-400/30">
            <KeyRound className="h-5 w-5" />
          </div>
          <span className="text-base font-bold tracking-tight text-white font-display">
            Suggest Key
          </span>
        </button>

        <nav className="hidden md:flex items-center gap-6" aria-label="Landing Navigation">
          <a href="#how-it-works" className="text-xs font-medium text-zinc-400 hover:text-white transition-colors cursor-pointer">How It Works</a>
          <a href="#categories" className="text-xs font-medium text-zinc-400 hover:text-white transition-colors cursor-pointer">Categories</a>
          <a href="#why" className="text-xs font-medium text-zinc-400 hover:text-white transition-colors cursor-pointer">Why Suggest Key</a>
          <a href="#for-mentors" className="text-xs font-medium text-zinc-400 hover:text-white transition-colors cursor-pointer">For Mentors</a>
        </nav>

        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <Button
              size="sm"
              onClick={() => navigate('/seeker')}
              className="text-xs bg-[#663af3] hover:bg-violet-700 text-white shadow-lg shadow-violet-900/20"
            >
              Go to Dashboard
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/auth/login')}
                className="text-xs text-zinc-300 hover:text-white hover:bg-white/5"
              >
                Sign In
              </Button>
              <Button
                size="sm"
                onClick={() => navigate('/auth/signup')}
                className="text-xs bg-[#663af3] hover:bg-violet-700 text-white shadow-lg shadow-violet-900/20"
              >
                Get Started
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

const Hero: React.FC = () => {
  const { navigate } = useNavigation();

  return (
    <section className="relative py-20 sm:py-28 lg:py-36">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center space-y-8 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-4 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
            <span className="text-[11px] font-semibold text-violet-300 tracking-wide uppercase">
              Now in Public Beta
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white font-heading leading-[1.1]">
            The Smartest Way to{' '}
            <span className="bg-gradient-to-r from-violet-400 to-amber-300 bg-clip-text text-transparent">
              Book 1:1 Sessions
            </span>
          </h1>

          <p className="text-base sm:text-lg text-zinc-400 leading-relaxed max-w-2xl mx-auto">
            Discover verified mentors, check real-time availability, and book live
            sessions in seconds. Suggest Key handles scheduling, payments, and
            session management so you can focus on learning.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Button
              size="md"
              onClick={() => navigate('/auth/signup')}
              className="w-full sm:w-auto text-xs bg-[#663af3] hover:bg-violet-700 text-white shadow-lg shadow-violet-900/30 px-8"
            >
              Start Exploring
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
            <Button
              variant="outline"
              size="md"
              onClick={() => navigate('/seeker/mentors')}
              className="w-full sm:w-auto text-xs border-zinc-700 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white hover:border-zinc-600 px-8"
            >
              Browse Mentors
            </Button>
          </div>

          <div className="flex items-center justify-center gap-6 pt-4 text-[11px] text-zinc-500">
            <span className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-emerald-400" />
              RLS Secured
            </span>
            <span className="flex items-center gap-1.5">
              <Star className="h-3.5 w-3.5 text-amber-400" />
              Verified Mentors
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-blue-400" />
              Instant Booking
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};

const HowItWorks: React.FC = () => {
  const steps = [
    {
      icon: Compass,
      title: 'Discover',
      description: 'Browse mentors by category, rating, and expertise. Filter by availability and session format.',
    },
    {
      icon: Calendar,
      title: 'Check Availability',
      description: 'See real-time open slots from mentors you are interested in. No back-and-forth needed.',
    },
    {
      icon: MessageCircle,
      title: 'Book & Pay',
      description: 'Confirm your session with secure payment processing. Your booking is atomic and reliable.',
    },
  ];

  return (
    <section id="how-it-works" className="py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center space-y-3 mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold text-white font-heading">How It Works</h2>
          <p className="text-sm text-zinc-400 max-w-lg mx-auto">Three simple steps to connect with world-class mentors.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {steps.map((step, i) => (
            <div
              key={step.title}
              className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6 space-y-4 hover:bg-white/[0.07] transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/20 ring-1 ring-violet-500/30">
                  <step.icon className="h-5 w-5 text-violet-400" />
                </div>
                <span className="text-3xl font-bold text-zinc-700 font-heading">0{i + 1}</span>
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">{step.title}</h3>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const Categories: React.FC = () => {
  const categories = [
    { label: 'Technology', icon: Compass, count: 240 },
    { label: 'Business', icon: Users, count: 180 },
    { label: 'Design', icon: MessageCircle, count: 150 },
    { label: 'Science', icon: Star, count: 120 },
    { label: 'Languages', icon: Calendar, count: 95 },
    { label: 'Career', icon: Shield, count: 110 },
  ];

  return (
    <section id="categories" className="py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center space-y-3 mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold text-white font-heading">Explore Categories</h2>
          <p className="text-sm text-zinc-400 max-w-lg mx-auto">Find mentors across every domain you can imagine.</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {categories.map((cat) => (
            <button
              key={cat.label}
              className="group rounded-xl border border-white/10 bg-white/5 p-4 text-center space-y-2 hover:bg-white/[0.07] hover:border-white/20 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              <cat.icon className="h-6 w-6 text-zinc-400 group-hover:text-violet-400 mx-auto transition-colors" />
              <div className="text-xs font-semibold text-zinc-300 group-hover:text-white transition-colors">
                {cat.label}
              </div>
              <div className="text-[10px] text-zinc-500">{cat.count} mentors</div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};

const WhySection: React.FC = () => {
  const features = [
    {
      title: 'Real-Time Availability',
      description: 'See open slots instantly. No more emailing back and forth to find a time that works.',
    },
    {
      title: 'Atomic Booking',
      description: 'Every booking is a single reliable transaction. No double-bookings, no conflicts.',
    },
    {
      title: 'Secure Payments',
      description: 'Payment processing is handled securely. Mentors receive payouts after session completion.',
    },
    {
      title: 'Session Management',
      description: 'Track active, completed, and pending sessions all in one place with full history.',
    },
  ];

  return (
    <section id="why" className="py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center space-y-3 mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold text-white font-heading">Why Suggest Key</h2>
          <p className="text-sm text-zinc-400 max-w-lg mx-auto">Built for serious learners and mentors who value their time.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6 space-y-3 hover:bg-white/[0.07] transition-colors"
            >
              <h3 className="text-sm font-bold text-white">{f.title}</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const ForMentors: React.FC = () => {
  const { navigate } = useNavigation();

  return (
    <section id="for-mentors" className="py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 backdrop-blur-sm p-8 sm:p-12 space-y-6">
          <div className="text-center space-y-3">
            <h2 className="text-2xl sm:text-3xl font-bold text-white font-heading">For Mentors</h2>
            <p className="text-sm text-zinc-400 max-w-lg mx-auto">
              Share your expertise, set your schedule, and grow your coaching business.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: 'Create Gigs', desc: 'Define your services and pricing' },
              { label: 'Set Availability', desc: 'Control when you are bookable' },
              { label: 'Manage Sessions', desc: 'Track bookings and earnings' },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
                <div className="text-xs font-bold text-white">{item.label}</div>
                <div className="text-[11px] text-zinc-400">{item.desc}</div>
              </div>
            ))}
          </div>

          <div className="flex justify-center pt-2">
            <Button
              size="md"
              onClick={() => navigate('/auth/signup')}
              className="text-xs bg-[#663af3] hover:bg-violet-700 text-white shadow-lg shadow-violet-900/30 px-8"
            >
              <UserPlus className="h-4 w-4 mr-1.5" />
              Start as a Mentor
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};

const Trust: React.FC = () => {
  return (
    <section className="py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center space-y-3 mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold text-white font-heading">Trusted by Learners</h2>
          <p className="text-sm text-zinc-400">Real feedback from our community.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              quote: 'The booking flow is incredibly smooth. I found a mentor in 5 minutes and had my session the same day.',
              author: 'Sarah Chen',
              role: 'Product Manager',
            },
            {
              quote: 'Suggest Key handles all the logistics so I can focus on teaching. The payment system is rock solid.',
              author: 'Dr. James Liu',
              role: 'Machine Learning Mentor',
            },
            {
              quote: 'Finally, a platform that respects both the mentor and the learner. Real-time availability is a game changer.',
              author: 'Priya Sharma',
              role: 'UX Designer',
            },
          ].map((t) => (
            <div key={t.author} className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-3">
              <p className="text-xs text-zinc-300 leading-relaxed">&ldquo;{t.quote}&rdquo;</p>
              <div>
                <div className="text-xs font-bold text-white">{t.author}</div>
                <div className="text-[10px] text-zinc-500">{t.role}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const FinalCTA: React.FC = () => {
  const { navigate } = useNavigation();

  return (
    <section className="py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-8 sm:p-12 text-center space-y-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-white font-heading">
            Ready to Start Learning?
          </h2>
          <p className="text-sm text-zinc-400 max-w-lg mx-auto">
            Join thousands of learners who have already booked their first session.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Button
              size="md"
              onClick={() => navigate('/auth/signup')}
              className="w-full sm:w-auto text-xs bg-[#663af3] hover:bg-violet-700 text-white shadow-lg shadow-violet-900/30 px-8"
            >
              Create Free Account
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
            <Button
              variant="outline"
              size="md"
              onClick={() => navigate('/auth/login')}
              className="w-full sm:w-auto text-xs border-zinc-700 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white hover:border-zinc-600 px-8"
            >
              <LogIn className="h-4 w-4 mr-1.5" />
              Sign In
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};

const Footer: React.FC = () => {
  const { navigate } = useNavigation();

  return (
    <footer className="border-t border-white/5 py-8">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#663af3] text-white font-bold text-xs">
              <KeyRound className="h-3.5 w-3.5" />
            </div>
            <span className="text-xs font-bold text-zinc-300">Suggest Key</span>
          </div>

          <nav className="flex items-center gap-4" aria-label="Footer Navigation">
            {[
              { label: 'Privacy', action: () => {} },
              { label: 'Terms', action: () => {} },
              { label: 'Support', action: () => navigate('/auth/login') },
            ].map((link) => (
              <button
                key={link.label}
                onClick={link.action}
                className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 rounded"
              >
                {link.label}
              </button>
            ))}
          </nav>

          <span className="text-[10px] text-zinc-600">
            &copy; {new Date().getFullYear()} Suggest Key
          </span>
        </div>
      </div>
    </footer>
  );
};

export const LandingPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#05060f] text-zinc-900 antialiased selection:bg-violet-500/30 selection:text-white">
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />
      <Header />
      <main>
        <Hero />
        <HowItWorks />
        <Categories />
        <WhySection />
        <ForMentors />
        <Trust />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
};
