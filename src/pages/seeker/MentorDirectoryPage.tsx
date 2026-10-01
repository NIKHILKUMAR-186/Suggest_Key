import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ChevronDown,
  Filter,
  Search,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Badge } from '@/src/components/ui/Badge';
import { Button } from '@/src/components/ui/Button';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { MentorCard } from '@/src/components/seeker/MentorCard';
import { MENTOR_GRID_CLASS, MentorGridSkeleton } from '@/src/components/seeker/MentorGrid';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { useAvailabilitySync } from '@/src/hooks/useAvailabilitySync';
import {
  fetchActiveSegments,
  fetchAllMentors,
  fetchEligibleLanguages,
  fetchMentorDirectoryAvailability,
  type AllMentorsQuery,
  type DirectoryMentorAvailability,
} from '@/src/lib/discoveryService';
import { addDaysToDateString, getDateStringInTimezone } from '@/src/lib/slotEngine';
import { formatShortDate } from '@/src/lib/seekerFormat';
import { mentorListPath, parseAvailabilityDateParam } from '@/src/lib/mentorNav';
import { DirectoryMentor, DirectoryPagination, Segment } from '@/src/types/database';
import { SegmentThemeProvider, useSegmentTheme } from '@/src/context/SegmentThemeContext';
import { cn } from '@/src/lib/utils';

type ExperienceFilter = 'all' | '0-2' | '3-5' | '6+';

const triggerBase =
  'inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[13px] font-semibold transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--color-shell-focus)] focus-visible:outline-offset-2';

const EXPERIENCE_OPTIONS: { value: ExperienceFilter; label: string }[] = [
  { value: 'all', label: 'All Experience' },
  { value: '0-2', label: '0–2 Years' },
  { value: '3-5', label: '3–5 Years' },
  { value: '6+', label: '6+ Years' },
];

const EXPERIENCE_BOUNDS: Record<Exclude<ExperienceFilter, 'all'>, { min: number; max?: number }> = {
  '0-2': { min: 0, max: 2 },
  '3-5': { min: 3, max: 5 },
  '6+': { min: 6 },
};

const PAGE_SIZE = 12;

const EMPTY_PAGINATION: DirectoryPagination = {
  page: 1,
  pageSize: PAGE_SIZE,
  total: 0,
  totalPages: 0,
  hasNextPage: false,
};

const DirectoryPageInner: React.FC<{
  segments: Segment[];
  selectedSegmentId: string;
  setSelectedSegmentId: (id: string) => void;
  isLoadingSegments: boolean;
}> = ({ segments, selectedSegmentId, setSelectedSegmentId, isLoadingSegments }) => {
  const { activeSegmentSlug } = useSegmentTheme();

  if (isLoadingSegments) {
    return (
      <div className="seeker-rail flex gap-2.5 overflow-x-auto" aria-hidden="true">
        <Skeleton className="h-[42px] w-32 shrink-0 rounded-[14px]" />
        <Skeleton className="h-[42px] w-28 shrink-0 rounded-[14px]" />
        <Skeleton className="h-[42px] w-36 shrink-0 rounded-[14px]" />
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-4 py-3 text-center text-xs text-[var(--color-shell-text-subtle)]">
        No mentorship segments are available right now.
      </p>
    );
  }

  return (
    <div
      className="seeker-rail flex gap-2.5 overflow-x-auto pb-1"
      role="tablist"
      aria-label="Filter by segment"
    >
      <button
        role="tab"
        aria-selected={!selectedSegmentId}
        onClick={() => setSelectedSegmentId('')}
        className={cn(
          'seeker-segment',
          !selectedSegmentId && 'segment-selected-pill'
        )}
      >
        <span>All Segments</span>
      </button>
      {segments.map((seg) => {
        const isSelected = selectedSegmentId === seg.id;
        return (
          <button
            key={seg.id}
            role="tab"
            aria-selected={isSelected}
            onClick={() => setSelectedSegmentId(seg.id)}
            className={cn(
              'seeker-segment',
              isSelected && 'segment-selected-pill'
            )}
            style={
              isSelected && activeSegmentSlug
                ? ({
                    '--segment-accent': `var(--segment-accent)`,
                    '--segment-accent-hover': `var(--segment-accent-hover)`,
                    '--segment-accent-soft': `var(--segment-accent-soft)`,
                    '--segment-gradient-primary': `var(--segment-gradient-primary)`,
                  } as React.CSSProperties)
                : undefined
            }
          >
            {isSelected && (
              <span
                className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full"
                style={{
                  background: activeSegmentSlug
                    ? 'var(--segment-gradient-primary)'
                    : 'var(--segment-accent)',
                }}
                aria-hidden="true"
              />
            )}
            <span className="relative z-10">{seg.name}</span>
          </button>
        );
      })}
    </div>
  );
};

export const MentorDirectoryPage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();
  const { profile } = useAuth();

  const searchParams = new URLSearchParams(
    currentPath.includes('?') ? currentPath.split('?')[1] : ''
  );
  const paramSegmentSlug = searchParams.get('segmentSlug') || '';
  /**
   * DISPLAY ONLY. The date whose availability each card describes. It is
   * deliberately kept out of `loadMentors` below: that query decides which
   * mentors EXIST, and membership on the platform must never depend on a
   * calendar day.
   */
  const paramDate = parseAvailabilityDateParam(searchParams.get('date'));

  const userTimezone = profile?.timezone || 'UTC';

  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>('');
  const [languages, setLanguages] = useState<string[]>([]);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [languageFilter, setLanguageFilter] = useState<string>('all');
  const [experienceFilter, setExperienceFilter] = useState<ExperienceFilter>('all');
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
  const [page, setPage] = useState<number>(1);

  const [mentors, setMentors] = useState<DirectoryMentor[]>([]);
  const [pagination, setPagination] = useState<DirectoryPagination>(EMPTY_PAGINATION);
  const [isLoadingSegments, setIsLoadingSegments] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [availability, setAvailability] = useState<Map<string, DirectoryMentorAvailability>>(
    new Map()
  );
  const [isAvailabilityLoading, setIsAvailabilityLoading] = useState<boolean>(false);

  const today = useMemo(
    () => getDateStringInTimezone(new Date(), userTimezone),
    [userTimezone]
  );

  const [availabilityDate, setAvailabilityDate] = useState<string>(paramDate || today);

  // A URL that names a different date must win over whatever is on screen,
  // including on a re-render from a Back navigation.
  useEffect(() => {
    setAvailabilityDate(paramDate || today);
  }, [paramDate, today]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    let isMounted = true;
    async function loadSegments() {
      setIsLoadingSegments(true);
      try {
        const { segments: activeSegs, error: segErr } = await fetchActiveSegments();
        if (segErr) throw segErr;
        if (isMounted) {
          setSegments(activeSegs);
          setSelectedSegmentId((current) => {
            if (current && activeSegs.some((s) => s.id === current)) return current;
            const matched = activeSegs.find((s) => s.slug === paramSegmentSlug);
            return matched?.id || '';
          });
        }
      } catch (err: any) {
        console.error('Error loading segments:', err);
        if (isMounted) setError('Unable to load mentors right now.');
      } finally {
        if (isMounted) setIsLoadingSegments(false);
      }
    }
    loadSegments();
    return () => {
      isMounted = false;
    };
  }, [paramSegmentSlug]);

  useEffect(() => {
    let isMounted = true;
    async function loadLanguages() {
      const { languages: langs } = await fetchEligibleLanguages();
      if (isMounted) setLanguages(langs);
    }
    loadLanguages();
    return () => {
      isMounted = false;
    };
  }, []);

  const loadMentors = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const bounds =
      experienceFilter === 'all' ? null : EXPERIENCE_BOUNDS[experienceFilter];

    const query: AllMentorsQuery = {
      search: debouncedSearch,
      segmentId: selectedSegmentId || null,
      language: languageFilter === 'all' ? null : languageFilter,
      minExperience: bounds?.min ?? null,
      maxExperience: bounds?.max ?? null,
      page,
      pageSize: PAGE_SIZE,
    };

    try {
      const { mentors: rows, pagination: pageInfo, error: fetchErr } = await fetchAllMentors(query);
      if (fetchErr) throw fetchErr;
      setMentors(rows);
      setPagination(pageInfo);
    } catch (err: any) {
      console.error('Error loading mentor directory:', err);
      setMentors([]);
      setPagination(EMPTY_PAGINATION);
      setError('Unable to load mentors right now.');
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, selectedSegmentId, languageFilter, experienceFilter, page]);

  useEffect(() => {
    loadMentors();
  }, [loadMentors]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, selectedSegmentId, languageFilter, experienceFilter]);

  const hasActiveFilters =
    !!debouncedSearch.trim() ||
    !!selectedSegmentId ||
    languageFilter !== 'all' ||
    experienceFilter !== 'all';

  const clearAllFilters = () => {
    setSearchQuery('');
    setDebouncedSearch('');
    setSelectedSegmentId('');
    setLanguageFilter('all');
    setExperienceFilter('all');
  };

  /**
   * Availability for the displayed date, fetched SEPARATELY from the mentor
   * list and deliberately after it.
   *
   * The ordering is the whole point: membership is decided first, by
   * `loadMentors`, and availability is only ever added on top. A failure here
   * leaves an empty map, which renders "Availability … is being refreshed" on
   * every card — it never shortens the list, because there is no code path here
   * that can remove a mentor.
   */
  const loadAvailability = useCallback(async () => {
    if (mentors.length === 0) {
      setAvailability(new Map());
      return;
    }
    setIsAvailabilityLoading(true);
    try {
      const result = await fetchMentorDirectoryAvailability(mentors, availabilityDate);
      setAvailability(result.byMentorId);
    } catch {
      // A failed availability read is not a directory failure. Show the
      // unresolved state rather than claiming anyone is fully booked.
      setAvailability(new Map());
    } finally {
      setIsAvailabilityLoading(false);
    }
  }, [mentors, availabilityDate]);

  useEffect(() => {
    loadAvailability();
  }, [loadAvailability]);

  /**
   * The "available on <date>" claim is a slot claim, so another seeker's
   * booking, a hold expiring or a mentor editing their hours must be able to
   * change it. Same hook, same watched tables and same 45s fallback as mentor
   * detail and the segment grid — not a fourth implementation. Not mentor-scoped,
   * because this page spans every mentor on screen.
   */
  useAvailabilitySync({
    mentorId: null,
    enabled: mentors.length > 0,
    onInvalidate: loadAvailability,
  });

  const stepAvailabilityDate = useCallback(
    (days: number) => {
      setAvailabilityDate((current) => addDaysToDateString(current, days));
    },
    []
  );

  return (
    <SegmentThemeProvider initialSegment={null}>
      <div className="seeker-page section-container space-y-8">
        {/* Header */}
        <div className="section-header">
          <div className="section-header-content">
            <motion.button
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3 }}
              onClick={() => navigate('/seeker')}
              className="-ml-1 inline-flex cursor-pointer items-center gap-1.5 rounded-md p-1 text-xs font-semibold text-[var(--color-shell-text-muted)] transition-colors hover:text-[var(--color-shell-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Discovery</span>
            </motion.button>
            <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl flex items-center gap-2">
              <Users className="h-6 w-6 text-[var(--color-shell-text-muted)]" />
              All Mentors
            </h1>
            <p className="mt-1.5 text-sm text-[var(--color-shell-text-muted)]">
              Every approved and active mentor on the platform. Nobody is removed for being
              busy on a given day — open a mentor&apos;s profile to choose another date.
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <div className="seeker-panel pointer-events-none absolute inset-0 rounded-2xl" aria-hidden="true" />
          <div className="relative flex items-center">
            <span
              className="pointer-events-none absolute left-3.5 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-shell-primary-soft)] text-[var(--color-shell-primary)]"
              aria-hidden="true"
            >
              <Search className="h-[20px] w-[20px]" />
            </span>
            <input
              id="mentor-directory-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search mentors by name, headline, expertise, or language…"
              className="input-glass h-[56px] sm:h-[60px] rounded-2xl pl-16 pr-4 text-[15px] sm:text-base font-medium"
            />
            {searchQuery.length > 0 && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-3 flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-[var(--color-shell-text-subtle)] transition-all duration-150 hover:bg-[var(--color-shell-bg-hover)] hover:text-[var(--color-shell-text)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--color-shell-focus)] focus-visible:outline-offset-2"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Controls panel */}
        <div className="seeker-panel surface-float space-y-5 rounded-3xl p-4 sm:p-5">
          {/* Segment filter */}
          <div className="space-y-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-shell-text-subtle)]">
              Explore segments
            </p>
            <DirectoryPageInner
              segments={segments}
              selectedSegmentId={selectedSegmentId}
              setSelectedSegmentId={setSelectedSegmentId}
              isLoadingSegments={isLoadingSegments}
            />
          </div>

          <div className="divider-gradient" aria-hidden="true" />

          {/* Filters */}
          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Language */}
            <div className="relative">
              <button
                onClick={() => setShowLanguageDropdown((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={showLanguageDropdown}
                className="trigger-base"
              >
                <Filter className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Language</span>
                {languageFilter !== 'all' && (
                  <Badge variant="default" className="text-[9px] py-0 px-1.5">
                    {languageFilter}
                  </Badge>
                )}
                <ChevronDown
                  className={cn('h-3 w-3 transition-transform', showLanguageDropdown && 'rotate-180')}
                  aria-hidden="true"
                />
              </button>
              <AnimatePresence>
                {showLanguageDropdown && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowLanguageDropdown(false)} aria-hidden="true" />
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -4 }}
                      transition={{ duration: 0.15 }}
                      className="absolute left-0 top-full mt-1 z-20 w-44 max-h-64 overflow-y-auto rounded-xl border border-[var(--seeker-panel-border)] bg-[var(--color-shell-surface-elevated)] shadow-[var(--shadow-xl)] p-1.5"
                      role="listbox"
                    >
                      <button
                        onClick={() => {
                          setLanguageFilter('all');
                          setShowLanguageDropdown(false);
                        }}
                        className={cn(
                          'w-full text-left px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors',
                          languageFilter === 'all'
                            ? 'bg-[var(--color-shell-primary-soft)] text-[var(--color-shell-text)] font-semibold'
                            : 'text-[var(--color-shell-text-muted)] hover:bg-[var(--color-shell-bg-hover)]'
                        )}
                      >
                        All Languages
                      </button>
                      {languages.map((lang) => (
                        <button
                          key={lang}
                          role="option"
                          aria-selected={languageFilter === lang}
                          onClick={() => {
                            setLanguageFilter(lang);
                            setShowLanguageDropdown(false);
                          }}
                          className={cn(
                            'w-full text-left px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors',
                            languageFilter === lang
                              ? 'bg-[var(--color-shell-primary-soft)] text-[var(--color-shell-text)] font-semibold'
                              : 'text-[var(--color-shell-text-muted)] hover:bg-[var(--color-shell-bg-hover)]'
                          )}
                        >
                          {lang}
                        </button>
                      ))}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            {/* Experience */}
            <div className="relative flex items-center">
              <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--color-shell-text-subtle)] mr-1.5" aria-hidden="true" />
              <select
                value={experienceFilter}
                onChange={(e) => setExperienceFilter(e.target.value as ExperienceFilter)}
                aria-label="Filter by experience"
                className="trigger-base appearance-none pl-9 pr-8"
              >
                {EXPERIENCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--color-shell-text-subtle)] pointer-events-none" aria-hidden="true" />
            </div>

            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="trigger-base text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-error)] hover:border-[var(--color-shell-error)]/40"
              >
                <X className="h-3 w-3" aria-hidden="true" />
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="error-banner">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <span>{error}</span>
            </div>
            <Button onClick={loadMentors} variant="outline" size="sm" className="mt-2 sm:mt-0">
              Try Again
            </Button>
          </div>
        )}

        {/*
          The availability date stepper.

          It changes which day the cards DESCRIBE, never who appears. Stating
          that in the copy is the guard against the exact regression this page
          exists to fix: a date control next to a mentor list invites everyone to
          read it as a filter, so the label has to say what it actually does —
          and the parallel link below offers the real availability-first page for
          anyone who does want the filter.
        */}
        <div className="seeker-panel surface-float flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-center gap-2.5">
            <CalendarClock
              className="h-4 w-4 shrink-0 text-[var(--color-shell-text-subtle)]"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[var(--color-shell-text)]">
                {`Showing availability for ${formatShortDate(availabilityDate)}`}
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--color-shell-text-subtle)]">
                This changes the date only. Every approved and active mentor stays listed.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => stepAvailabilityDate(-1)}
              aria-label="Show availability for the previous day"
              className={cn(triggerBase, 'px-2.5')}
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <span className="min-w-[104px] text-center text-[13px] font-semibold text-[var(--color-shell-text)]">
              {isAvailabilityLoading ? (
                <Skeleton className="mx-auto h-4 w-20" />
              ) : (
                formatShortDate(availabilityDate)
              )}
            </span>
            <button
              type="button"
              onClick={() => stepAvailabilityDate(1)}
              aria-label="Show availability for the next day"
              className={cn(triggerBase, 'px-2.5')}
            >
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            {availabilityDate !== today && (
              <Button variant="outline" size="sm" onClick={() => setAvailabilityDate(today)}>
                Today
              </Button>
            )}
          </div>
        </div>

        {/* Results header */}
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-[var(--color-shell-text)] sm:text-2xl">
            {selectedSegmentId ? segments.find(s => s.id === selectedSegmentId)?.name || 'Mentors' : 'All Mentors'}
          </h2>
          {isLoading ? (
            <Skeleton className="h-3 w-16" />
          ) : (
            <span className="badge badge-neutral">
              {pagination.total} mentor{pagination.total !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Content */}
        {isLoading ? (
          <MentorGridSkeleton count={6} />
        ) : error ? null : mentors.length === 0 ? (
          <EmptyState
            icon={Search}
            title={
              hasActiveFilters
                ? 'No mentors match your filters'
                : 'No mentors are currently listed'
            }
            description={
              hasActiveFilters
                ? 'No approved and active mentors match your current search and filters.'
                : 'There are no approved, active mentors on the platform yet. Please check back later.'
            }
            actionLabel={hasActiveFilters ? 'Clear filters' : undefined}
            onAction={hasActiveFilters ? clearAllFilters : undefined}
          />
        ) : (
          <>
            <div className={MENTOR_GRID_CLASS}>
              {mentors.map((mentor) => (
                <MentorCard
                  key={mentor.id}
                  variant="discovery"
                  directoryMentor={mentor}
                  directoryAvailability={availability.get(mentor.id) ?? null}
                  segmentSlug={mentor.segments[0]?.slug || ''}
                  selectedDate={availabilityDate}
                  today={today}
                  navigate={navigate}
                />
              ))}
            </div>

            {/*
              The honest alternative for a seeker who genuinely wants the
              filtered view. `/seeker/mentors` is availability-first discovery and
              MAY be empty on a busy day, which is correct for it and wrong for
              this page, so the two are reached by two different links rather than
              one link being made to behave as both.
            */}
            <p className="text-center text-xs text-[var(--color-shell-text-muted)]">
              Only want mentors you can book on {formatShortDate(availabilityDate)}?{' '}
              <button
                type="button"
                onClick={() =>
                  navigate(
                    mentorListPath({
                      segmentSlug: selectedSegmentId
                        ? segments.find((s) => s.id === selectedSegmentId)?.slug ?? null
                        : null,
                      date: availabilityDate,
                    })
                  )
                }
                className="cursor-pointer font-semibold text-[var(--color-shell-primary)] underline underline-offset-2 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--color-shell-focus)]"
              >
                See mentors available on that day
              </button>
            </p>
          </>
        )}

        {/* Pagination */}
        {!error && pagination.totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1 || isLoading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="gap-1.5"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Previous</span>
            </Button>
            <span className="text-xs text-[var(--color-shell-text-muted)]">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!pagination.hasNextPage || isLoading}
              onClick={() => setPage((p) => p + 1)}
              className="gap-1.5"
            >
              <span>Next</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
    </SegmentThemeProvider>
  );
};
