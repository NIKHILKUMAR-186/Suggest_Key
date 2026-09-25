import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search,
  ShieldCheck,
  Sparkles,
  Filter,
  ChevronDown,
  Star,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Badge } from '@/src/components/ui/Badge';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { PremiumMentorCard } from '@/src/components/seeker/PremiumMentorCard';
import { useNavigation } from '@/src/context/NavigationContext';
import {
  fetchActiveSegments,
  getHighestPriorityActiveSegment,
  fetchDiscoverableMentors,
} from '@/src/lib/discoveryService';
import { Segment, DiscoverableMentor } from '@/src/types/database';

type ExperienceFilter = 'all' | '0-2' | '3-5' | '6+';

const EXPERIENCE_OPTIONS: { value: ExperienceFilter; label: string }[] = [
  { value: 'all', label: 'All Experience' },
  { value: '0-2', label: '0–2 Years' },
  { value: '3-5', label: '3–5 Years' },
  { value: '6+', label: '6+ Years' },
];

export const SeekerHomePage: React.FC = () => {
  const { navigate } = useNavigation();

  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [languageFilter, setLanguageFilter] = useState<string>('all');
  const [experienceFilter, setExperienceFilter] = useState<ExperienceFilter>('all');
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);

  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<Segment | null>(null);
  const [mentors, setMentors] = useState<DiscoverableMentor[]>([]);
  const [isLoadingSegments, setIsLoadingSegments] = useState<boolean>(true);
  const [isLoadingMentors, setIsLoadingMentors] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadSegments() {
      setIsLoadingSegments(true);
      setError(null);
      try {
        const { segments: activeSegs, error: segErr } = await fetchActiveSegments();
        if (segErr) throw segErr;
        if (isMounted) {
          setSegments(activeSegs);
          const topSegment = getHighestPriorityActiveSegment(activeSegs);
          setSelectedSegment(topSegment);
        }
      } catch (err: any) {
        if (isMounted) {
          console.error('Error loading segments:', err);
          setError(err.message || 'Failed to load mentorship segments');
        }
      } finally {
        if (isMounted) setIsLoadingSegments(false);
      }
    }
    loadSegments();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (!selectedSegment) {
      setMentors([]);
      return;
    }
    async function loadMentors() {
      setIsLoadingMentors(true);
      try {
        const { mentors: discMentors, error: mentorErr } = await fetchDiscoverableMentors(
          selectedSegment!.id,
          selectedDate
        );
        if (mentorErr) throw mentorErr;
        if (isMounted) {
          setMentors(discMentors);
        }
      } catch (err: any) {
        if (isMounted) {
          console.error('Error loading mentors:', err);
        }
      } finally {
        if (isMounted) setIsLoadingMentors(false);
      }
    }
    loadMentors();
    return () => {
      isMounted = false;
    };
  }, [selectedSegment, selectedDate]);

  const availableLanguages = useMemo(() => {
    const langs = new Set<string>();
    mentors.forEach((m) => (m.languages || []).forEach((l) => langs.add(l)));
    return Array.from(langs).sort();
  }, [mentors]);

  const filteredMentors = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return mentors.filter((m) => {
      if (query) {
        const searchable = [
          m.full_name,
          m.headline,
          m.segment?.name || '',
          m.gig.title,
          m.gig.description,
          ...(m.languages || []),
        ]
          .join(' ')
          .toLowerCase();
        if (!searchable.includes(query)) return false;
      }
      if (languageFilter !== 'all' && !(m.languages || []).includes(languageFilter)) {
        return false;
      }
      if (experienceFilter !== 'all') {
        const exp = m.experience_years || 0;
        if (experienceFilter === '0-2' && (exp < 0 || exp > 2)) return false;
        if (experienceFilter === '3-5' && (exp < 3 || exp > 5)) return false;
        if (experienceFilter === '6+' && exp < 6) return false;
      }
      return true;
    });
  }, [mentors, searchQuery, languageFilter, experienceFilter]);

  const featuredMentors = filteredMentors.filter((m) => m.is_featured);
  const regularMentors = filteredMentors.filter((m) => !m.is_featured);

  const hasActiveFilters = languageFilter !== 'all' || experienceFilter !== 'all' || searchQuery.trim() !== '';

  const clearAllFilters = useCallback(() => {
    setSearchQuery('');
    setLanguageFilter('all');
    setExperienceFilter('all');
  }, []);

  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const quickDates = useMemo(() => {
    const dates = [{ label: 'Today', value: today }];
    if (tomorrow) dates.push({ label: 'Tomorrow', value: tomorrow });
    return dates;
  }, [today, tomorrow]);

  const handleDateSelect = (dateValue: string) => {
    setSelectedDate(dateValue);
  };

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="relative max-w-5xl mx-auto">
        {/* Hero Visual - SVG Asset */}
        <div className="absolute inset-0 -z-10 w-full h-full pointer-events-none overflow-hidden" aria-hidden="true">
          <img
            src="/assets/landing/seeker-hero.svg"
            alt=""
            className="w-full h-full object-cover"
            aria-hidden="true"
          />
        </div>

        <div className="relative space-y-6 item-center justify-center text-center max-w-3xl mx-auto pt-8 pb-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.23, 1, 0.31, 1] }}
          className="justify-center items-center gap-2.5 rounded-full border border-[var(--color-shell-warning)]/30 bg-[var(--color-shell-warning-soft)]/80 px-4 py-1.5 text-xs font-semibold text-[var(--color-shell-warning)]  inline-flex shadow-xs"
        >
          <Sparkles className="h-3.5 w-3.5 text-[var(--color-shell-warning)]" />
          <span>Verified 1:1 Mentorship Marketplace</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05, ease: [0.23, 1, 0.31, 1] }}
          className="text-4xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-5xl md:text-6xl leading-tight font-display"
        >
          Find the right mentor
          <br />
          for your journey
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.23, 1, 0.31, 1] }}
          className="max-w-2xl text-lg text-[var(--color-shell-text-muted)] leading-relaxed"
        >
          Real guidance. Meaningful conversations. One session at a time.
        </motion.p>

        {/* Hero Search */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease: [0.23, 1, 0.31, 1] }}
          className="relative max-w-3xl pt-4"
        >
          <Search className="absolute  left-5 top-1/2 -translate-y-1/9 h-5 w-5 text-[var(--color-shell-text-subtle)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search mentors, segments, languages, or topics..."
            aria-label="Search mentors"
            className="w-full rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] pl-12 pr-4 py-4 text-base text-[var(--color-shell-text)] placeholder:text-[var(--color-shell-text-subtle)] focus:border-[var(--color-shell-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-shell-accent)]/15 shadow-md"
          />
        </motion.div>
      </div>
    </div>

      {/* Segment Selector */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2, ease: [0.23, 1, 0.31, 1] }}
      >
        {isLoadingSegments ? (
          <div className="flex gap-2 overflow-x-auto pb-1 item-center justify-center text-center max-w-3xl mx-auto">
            <Skeleton className="h-10 w-40 rounded-full" />
            <Skeleton className="h-10 w-32 rounded-full" />
            <Skeleton className="h-10 w-36 rounded-full" />
          </div>
        ) : (
          <div
            className="flex gap-2 overflow-x-auto pb-1 scrollbar-none  item-center justify-center text-center max-w-3xl mx-auto"
            role="tablist"
            aria-label="Mentorship segments"
          >
            {segments.map((seg) => {
              const isSelected = selectedSegment?.id === seg.id;
              return (
                <button
                  key={seg.id}
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setSelectedSegment(seg)}
                  className={`px-5 py-2.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap border cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-accent)] min-h-[40px] ${
                    isSelected
                      ? 'border-[var(--color-shell-warning)]/40 bg-[var(--color-shell-warning-soft)] text-[var(--color-shell-text)] shadow-xs'
                      : 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] text-[var(--color-shell-text-muted)] hover:bg-[var(--color-shell-surface-elevated)] hover:border-[var(--color-shell-border-strong)]'
                  }`}
                >
                  {seg.name}
                </button>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* Date Discovery */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.25, ease: [0.23, 1, 0.31, 1] }}
        className="space-y-3"
      >
        <h2 className="text-sm  item-center justify-center text-center max-w-3xl mx-auto font-semibold text-[var(--color-shell-text-muted)]">When would you like to talk?</h2>
        <div className="flex flex-wrap items-center gap-3 item-center justify-center text-center max-w-3xl mx-auto">
          <div className="flex items-center gap-1.5 bg-[var(--color-shell-surface)] rounded-xl border border-[var(--color-shell-border)] px-1.5 py-1 shadow-xs">
            {quickDates.map((d) => (
              <button
                key={d.value}
                onClick={() => handleDateSelect(d.value)}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-accent)] ${
                  selectedDate === d.value
                    ? 'bg-[var(--color-shell-warning-soft)] text-[var(--color-shell-text)] border border-[var(--color-shell-warning)]/30'
                    : 'text-[var(--color-shell-text-muted)] hover:bg-[var(--color-shell-surface-elevated)] hover:text-[var(--color-shell-text)]'
                }`}
              >
                {d.label}
              </button>
            ))}

            <div className="w-px h-5 bg-[var(--color-shell-border)] mx-1" />
            <label className="sr-only" htmlFor="date-picker">Pick a date</label>
            <input
              id="date-picker"
              type="date"
              value={selectedDate}
              min={today}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-xs text-[var(--color-shell-text-muted)] border-none bg-transparent focus:outline-none font-semibold cursor-pointer w-32 truncate"
              aria-label="Select session date"
            />
          </div>

          {/* <span className="text-[11px] text-[var(--color-shell-text-subtle)]">
            Past dates disabled
          </span> */}
        </div>
      </motion.div>

      {/* Filters Bar */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.3, ease: [0.23, 1, 0.31, 1] }}
        className="flex items-center gap-2.5 flex-wrap"
      >
        {/* Language Filter */}
        <div className="relative">
          <button
            onClick={() => setShowLanguageDropdown((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={showLanguageDropdown}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-3.5 py-2 text-xs font-medium text-[var(--color-shell-text-muted)] hover:bg-[var(--color-shell-surface-elevated)] hover:border-[var(--color-shell-border-strong)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-accent)]"
          >
            <Filter className="h-3.5 w-3.5" />
            <span>Language</span>
            {languageFilter !== 'all' && <Badge variant="default" className="text-[9px] ml-1">{languageFilter}</Badge>}
            <ChevronDown className={`h-3 w-3 transition-transform ${showLanguageDropdown ? 'rotate-180' : ''}`} />
          </button>
          <AnimatePresence>
            {showLanguageDropdown && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowLanguageDropdown(false)}
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute left-0 top-full mt-1 z-20 w-44 rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] shadow-lg p-1 space-y-0.5"
                  role="listbox"
                >
                  <button
                    onClick={() => {
                      setLanguageFilter('all');
                      setShowLanguageDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-lg text-xs cursor-pointer ${
                      languageFilter === 'all' ? 'bg-[var(--color-shell-warning-soft)] text-[var(--color-shell-text)] font-semibold' : 'hover:bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-muted)]'
                    }`}
                  >
                    All Languages
                  </button>
                  {availableLanguages.map((lang) => (
                    <button
                      key={lang}
                      onClick={() => {
                        setLanguageFilter(lang);
                        setShowLanguageDropdown(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 rounded-lg text-xs cursor-pointer ${
                        languageFilter === lang ? 'bg-[var(--color-shell-warning-soft)] text-[var(--color-shell-text)] font-semibold' : 'hover:bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-muted)]'
                      }`}
                    >
                      {lang}
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        {/* Experience Filter */}
        <div className="relative">
          <select
            value={experienceFilter}
            onChange={(e) => setExperienceFilter(e.target.value as ExperienceFilter)}
            aria-label="Filter by experience"
            className="appearance-none rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-3.5 py-2 text-xs font-medium text-[var(--color-shell-text-muted)] hover:bg-[var(--color-shell-surface-elevated)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-accent)] pr-8"
          >
            {EXPERIENCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--color-shell-text-subtle)] pointer-events-none" />
        </div>

        {/* Clear Filters */}
        {hasActiveFilters && (
          <button
            onClick={clearAllFilters}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-3 py-2 text-xs font-medium text-[var(--color-shell-text-muted)] hover:bg-[var(--color-shell-surface-elevated)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-accent)]"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}
      </motion.div>

      {/* Results Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h2 className="text-xl font-bold text-[var(--color-shell-text)]">Available Mentors</h2>
          {selectedSegment && (
            <Badge variant="secondary" className="text-xs font-semibold">
              {selectedSegment.name}
            </Badge>
          )}
        </div>
        <span className="text-xs text-[var(--color-shell-text-muted)]">
          {isLoadingMentors ? '…' : `${filteredMentors.length} mentor${filteredMentors.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-2xl border border-[var(--color-shell-error)]/30 bg-[var(--color-shell-error-soft)] p-4 text-sm text-[var(--color-shell-error)] shadow-xs">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-4 w-4" />
            <span>Something went wrong</span>
          </div>
          <p className="mt-1 text-[var(--color-shell-error)]">{error}</p>
        </div>
      )}

      {/* Content */}
      {isLoadingMentors ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : filteredMentors.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No Mentors Available"
          description={
            searchQuery || languageFilter !== 'all' || experienceFilter !== 'all'
              ? 'Try adjusting your search terms or clearing filters to discover more mentors.'
              : `No approved mentors in ${selectedSegment?.name || 'selected segment'} have open slots for your selected date. Mentors with zero available slots are excluded to prevent dead ends.`
          }
          actionLabel={hasActiveFilters ? 'Clear Filters' : undefined}
          onAction={hasActiveFilters ? clearAllFilters : undefined}
        />
      ) : (
        <motion.div
          initial="hidden"
          animate="show"
          variants={{
            hidden: { opacity: 0 },
            show: {
              opacity: 1,
              transition: { staggerChildren: 0.06 },
            },
          }}
          className="space-y-8"
        >
          {featuredMentors.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-shell-text-subtle)] flex items-center gap-2">
                <Star className="h-3 w-3 text-[var(--color-shell-warning)] fill-current" />
                <span>Featured Mentors</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {featuredMentors.map((mentor) => (
                  <PremiumMentorCard
                    key={`featured-${mentor.id}`}
                    mentor={mentor}
                    selectedSegment={selectedSegment}
                    selectedDate={selectedDate}
                    navigate={navigate}
                    isFeatured
                  />
                ))}
              </div>
            </div>
          )}

          {regularMentors.length > 0 && (
            <div className="space-y-4">
              {featuredMentors.length > 0 && <div className="border-t border-[var(--color-shell-border)] pt-6" />}
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-shell-text-subtle)]">
                Available Mentors
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {regularMentors.map((mentor) => (
                  <PremiumMentorCard
                    key={`regular-${mentor.id}`}
                    mentor={mentor}
                    selectedSegment={selectedSegment}
                    selectedDate={selectedDate}
                    navigate={navigate}
                  />
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
};

const SkeletonCard: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <div
      className={`rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5 space-y-4 shadow-xs ${className || ''}`}
      aria-hidden="true"
    >
      <div className="flex items-start gap-3.5">
        <Skeleton variant="circular" className="h-12 w-12 shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
      <div className="flex items-center justify-between pt-3 border-t border-[var(--color-shell-border)]">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
    </div>
  );
};

export default SeekerHomePage;
