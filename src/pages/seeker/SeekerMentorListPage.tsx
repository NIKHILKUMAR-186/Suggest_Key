import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  Search,
  Shield,
  Filter,
  SlidersHorizontal,
  Star,
  X,
  ChevronDown,
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
  { value: 'all', label: 'All' },
  { value: '0-2', label: '0–2 Yrs' },
  { value: '3-5', label: '3–5 Yrs' },
  { value: '6+', label: '6+ Yrs' },
];

export const SeekerMentorListPage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();

  const searchParams = new URLSearchParams(
    currentPath.includes('?') ? currentPath.split('?')[1] : ''
  );
  const paramSegmentId = searchParams.get('segmentId') || '';
  const paramDate = searchParams.get('date') || '';

  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return paramDate || new Date().toISOString().split('T')[0];
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
          const matched =
            activeSegs.find((s) => s.id === paramSegmentId || s.slug === paramSegmentId) ||
            getHighestPriorityActiveSegment(activeSegs);
          setSelectedSegment(matched || null);
        }
      } catch (err: any) {
        if (isMounted) {
          console.error('Error loading segments:', err);
          setError(err.message || 'Failed to load segments');
        }
      } finally {
        if (isMounted) setIsLoadingSegments(false);
      }
    }
    loadSegments();
    return () => { isMounted = false; };
  }, [paramSegmentId]);

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
    return () => { isMounted = false; };
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

  const hasActiveFilters =
    languageFilter !== 'all' || experienceFilter !== 'all' || searchQuery.trim() !== '';

  const clearAllFilters = () => {
    setSearchQuery('');
    setLanguageFilter('all');
    setExperienceFilter('all');
  };

  return (
    <div className="space-y-6">
      {/* Back to Discovery & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <motion.button
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3 }}
            onClick={() => navigate('/seeker')}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] transition-colors rounded-md p-1 -ml-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-text)] cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Discovery</span>
          </motion.button>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl font-display mt-2">
            {selectedSegment ? `${selectedSegment.name} Mentors` : 'Mentors'}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-shell-text-muted)]">
            Verified mentors with active gigs and valid bookable slots on{' '}
            <span className="font-mono font-medium text-[var(--color-shell-text-muted)]">{selectedDate}</span>.
          </p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[var(--color-shell-text-subtle)]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search mentors by name, expertise, or language…"
          className="w-full rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] pl-12 pr-4 py-3.5 text-base text-[var(--color-shell-text)] placeholder:text-[var(--color-shell-text-subtle)] focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/15 shadow-xs"
        />
      </div>

      {/* Filters Row */}
      {mentors.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="flex items-center gap-2 flex-wrap"
        >
          {/* Language Filter */}
          <div className="relative">
            <button
              onClick={() => setShowLanguageDropdown((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={showLanguageDropdown}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-3 py-2 text-xs font-medium text-[var(--color-shell-text-muted)] hover:bg-[var(--color-shell-surface-elevated)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-accent)]"
            >
              <Filter className="h-3.5 w-3.5" />
              <span>Language</span>
              {languageFilter !== 'all' && (
                <Badge variant="default" className="text-[9px] py-0 px-1.5">
                  {languageFilter}
                </Badge>
              )}
              <ChevronDown
                className={`h-3 w-3 transition-transform ${showLanguageDropdown ? 'rotate-180' : ''}`}
              />
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
                        languageFilter === 'all'
                          ? 'bg-[var(--color-shell-warning-soft)] text-[var(--color-shell-text)] font-semibold'
                          : 'hover:bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-muted)]'
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
                          languageFilter === lang
                            ? 'bg-[var(--color-shell-warning-soft)] text-[var(--color-shell-text)] font-semibold'
                            : 'hover:bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-muted)]'
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
          <div className="flex items-center gap-1">
            <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--color-shell-text-muted)]" />
            <select
              value={experienceFilter}
              onChange={(e) => setExperienceFilter(e.target.value as ExperienceFilter)}
              aria-label="Filter by experience"
              className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-3 py-2 text-xs font-medium text-[var(--color-shell-text-muted)] hover:bg-[var(--color-shell-surface-elevated)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-accent)]"
            >
              {EXPERIENCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
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
      )}

      {/* Date Quick Selector */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.08 }}
        className="flex items-center gap-2.5 bg-[var(--color-shell-surface)] rounded-xl border border-[var(--color-shell-border)] px-3.5 py-2.5 shadow-xs self-start text-xs"
      >
        <span className="font-medium text-[var(--color-shell-text-muted)]">Session date:</span>
        <input
          type="date"
          value={selectedDate}
          min={new Date().toISOString().split('T')[0]}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="text-xs text-[var(--color-shell-text)] border border-[var(--color-shell-border-strong)] rounded-lg px-2 py-1 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/15 cursor-pointer font-semibold"
          aria-label="Filter by appointment date"
        />
      </motion.div>

      {/* Segment Selector Tabs */}
      {isLoadingSegments ? (
        <div className="flex gap-2">
          <Skeleton className="h-9 w-32 rounded-lg" />
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-36 rounded-lg" />
        </div>
      ) : segments.length > 0 ? (
        <div
          className="flex items-center gap-2 overflow-x-auto pb-1.5 scrollbar-none"
          role="tablist"
          aria-label="Segments"
        >
          {segments.map((seg) => {
            const isSelected = selectedSegment?.id === seg.id;
            return (
              <button
                key={seg.id}
                role="tab"
                aria-selected={isSelected}
                onClick={() => setSelectedSegment(seg)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap border cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-accent)] min-h-[38px] ${
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
      ) : null}

      {/* Error */}
      {error && (
        <div className="rounded-2xl border border-[var(--color-shell-error)]/30 bg-[var(--color-shell-error-soft)] p-4 text-sm text-[var(--color-shell-error)]">
          <div className="flex items-center gap-2 font-semibold">
            <Shield className="h-4 w-4" />
            <span>Error Loading Mentors</span>
          </div>
          <p className="mt-1">{error}</p>
        </div>
      )}

      {/* Results Count */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-[var(--color-shell-text)]">Available Mentors</h2>
        <span className="text-xs text-[var(--color-shell-text-muted)]">
          {isLoadingMentors ? '…' : `${filteredMentors.length} mentor${filteredMentors.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Content */}
      {isLoadingSegments || isLoadingMentors ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-60 w-full rounded-2xl" />
          ))}
        </div>
      ) : filteredMentors.length === 0 && !error ? (
        <EmptyState
          icon={Search}
          title="No Available Mentors Found"
          description={
            searchQuery || languageFilter !== 'all' || experienceFilter !== 'all'
              ? 'No mentors match your current filters. Try broadening your search or clearing filters.'
              : `All mentors in ${selectedSegment?.name || 'this segment'} are fully booked, have date exceptions, or have no active gig on ${selectedDate}.`
          }
          actionLabel="Clear Filters"
          onAction={clearAllFilters}
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
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-shell-warning)] flex items-center gap-2">
                <Star className="h-3 w-3 text-[var(--color-shell-warning)] fill-current" />
                <span>Featured Mentors</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {featuredMentors.map((mentor) => (
                  <PremiumMentorCard
                    key={`list-featured-${mentor.id}`}
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
                    key={`list-regular-${mentor.id}`}
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

      {/* Notice on Real Availability Engine */}
      {!error && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
          className="flex items-start gap-3 rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)]/80 p-4 text-xs text-[var(--color-shell-text-muted)]"
        >
          <Shield className="h-4 w-4 text-[var(--color-shell-text-muted)] shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-[var(--color-shell-text)]">Global Mentor Invariant:</span>
            <p className="mt-0.5 leading-relaxed text-[var(--color-shell-text-muted)]">
              Mentor availability is attached globally to the mentor, not to an individual gig.
              Bookings across all segments are reconciled in UTC to ensure no concurrent
              double-bookings can occur.
            </p>
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default SeekerMentorListPage;
