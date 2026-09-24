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
      <div className="space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.23, 1, 0.31, 1] }}
          className="inline-flex items-center gap-2.5 rounded-full border border-amber-200 bg-amber-50/80 px-4 py-1.5 text-xs font-semibold text-amber-800"
        >
          <Sparkles className="h-3.5 w-3.5 text-amber-600" />
          <span>Verified 1:1 Mentorship Marketplace</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05, ease: [0.23, 1, 0.31, 1] }}
          className="text-4xl font-bold tracking-tight text-zinc-950 sm:text-5xl md:text-6xl leading-tight font-display"
        >
          Find the right mentor
          <br />
          for your journey
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.23, 1, 0.31, 1] }}
          className="max-w-2xl text-lg text-zinc-600 leading-relaxed"
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
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-5 w-5 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search mentors, segments, languages, or topics..."
            aria-label="Search mentors"
            className="w-full rounded-2xl border border-zinc-200 bg-white pl-12 pr-4 py-4 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/15 shadow-md"
          />
        </motion.div>
      </div>

      {/* Segment Selector */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2, ease: [0.23, 1, 0.31, 1] }}
      >
        {isLoadingSegments ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            <Skeleton className="h-10 w-40 rounded-full" />
            <Skeleton className="h-10 w-32 rounded-full" />
            <Skeleton className="h-10 w-36 rounded-full" />
          </div>
        ) : (
          <div
            className="flex gap-2 overflow-x-auto pb-1 scrollbar-none"
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
                  className={`px-5 py-2.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap border cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 min-h-[40px] ${
                    isSelected
                      ? 'border-amber-300 bg-amber-50 text-amber-900 shadow-xs'
                      : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:border-zinc-300'
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
        <h2 className="text-sm font-semibold text-zinc-700">When would you like to talk?</h2>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 bg-white rounded-xl border border-zinc-200 px-1.5 py-1 shadow-xs">
            {quickDates.map((d) => (
              <button
                key={d.value}
                onClick={() => handleDateSelect(d.value)}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                  selectedDate === d.value
                    ? 'bg-amber-50 text-amber-900 border border-amber-200'
                    : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
                }`}
              >
                {d.label}
              </button>
            ))}

            <div className="w-px h-5 bg-zinc-200 mx-1" />
            <label className="sr-only" htmlFor="date-picker">Pick a date</label>
            <input
              id="date-picker"
              type="date"
              value={selectedDate}
              min={today}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-xs text-zinc-700 border-none bg-transparent focus:outline-none font-semibold cursor-pointer w-32 truncate"
              aria-label="Select session date"
            />
          </div>

          <span className="text-[11px] text-zinc-400">
            Past dates disabled
          </span>
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
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 hover:border-zinc-300 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
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
                  className="absolute left-0 top-full mt-1 z-20 w-44 rounded-xl border border-zinc-200 bg-white shadow-lg p-1 space-y-0.5"
                  role="listbox"
                >
                  <button
                    onClick={() => {
                      setLanguageFilter('all');
                      setShowLanguageDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-lg text-xs cursor-pointer ${
                      languageFilter === 'all' ? 'bg-amber-50 text-amber-900 font-semibold' : 'hover:bg-zinc-50 text-zinc-700'
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
                        languageFilter === lang ? 'bg-amber-50 text-amber-900 font-semibold' : 'hover:bg-zinc-50 text-zinc-700'
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
            className="appearance-none rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 pr-8"
          >
            {EXPERIENCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-400 pointer-events-none" />
        </div>

        {/* Clear Filters */}
        {hasActiveFilters && (
          <button
            onClick={clearAllFilters}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}
      </motion.div>

      {/* Results Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h2 className="text-xl font-bold text-zinc-950">Available Mentors</h2>
          {selectedSegment && (
            <Badge variant="secondary" className="text-xs font-semibold">
              {selectedSegment.name}
            </Badge>
          )}
        </div>
        <span className="text-xs text-zinc-500">
          {isLoadingMentors ? '…' : `${filteredMentors.length} mentor${filteredMentors.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 shadow-xs">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-4 w-4" />
            <span>Something went wrong</span>
          </div>
          <p className="mt-1 text-rose-600">{error}</p>
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
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                <Star className="h-3 w-3 text-amber-500 fill-current" />
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
              {featuredMentors.length > 0 && <div className="border-t border-zinc-100 pt-6" />}
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
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
      className={`rounded-2xl border border-zinc-200 bg-white p-5 space-y-4 shadow-xs ${className || ''}`}
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
      <div className="flex items-center justify-between pt-3 border-t border-zinc-100">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
    </div>
  );
};

export default SeekerHomePage;
