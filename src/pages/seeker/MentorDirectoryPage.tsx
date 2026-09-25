import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
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
import { MentorDirectoryCard } from '@/src/components/seeker/MentorDirectoryCard';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import {
  fetchActiveSegments,
  fetchAllMentors,
  fetchEligibleLanguages,
  type AllMentorsQuery,
} from '@/src/lib/discoveryService';
import { getDateStringInTimezone } from '@/src/lib/slotEngine';
import { DirectoryMentor, DirectoryPagination, Segment } from '@/src/types/database';

type ExperienceFilter = 'all' | '0-2' | '3-5' | '6+';

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

/**
 * "View All Mentors" directory.
 *
 * Lists every mentor that is approved + active + not suspended + not
 * deactivated. Bookability on a specific date is NOT a requirement here, which
 * is what separates this page from the seeker home "Available Mentors" list.
 */
export const MentorDirectoryPage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();
  const { profile } = useAuth();

  const searchParams = new URLSearchParams(
    currentPath.includes('?') ? currentPath.split('?')[1] : ''
  );
  const paramSegmentId = searchParams.get('segmentId') || '';

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
            const matched = activeSegs.find((s) => s.id === paramSegmentId || s.slug === paramSegmentId);
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
  }, [paramSegmentId]);

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

  // Any filter change returns to the first page.
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

  const today = useMemo(
    () => getDateStringInTimezone(new Date(), userTimezone),
    [userTimezone]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <motion.button
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
          onClick={() => navigate('/seeker')}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] transition-colors rounded-md p-1 -ml-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-text)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Discovery</span>
        </motion.button>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl font-display mt-2 flex items-center gap-2">
          <Users className="h-6 w-6 text-[var(--color-shell-text-muted)]" />
          All Mentors
        </h1>
        <p className="mt-1 text-sm text-[var(--color-shell-text-muted)]">
          Every approved and active mentor on the platform. Availability for a specific
          date is shown on each mentor&apos;s profile.
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[var(--color-shell-text-subtle)]" />
        <label className="sr-only" htmlFor="mentor-directory-search">
          Search mentors
        </label>
        <input
          id="mentor-directory-search"
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search mentors by name, headline, expertise, or language…"
          className="w-full rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] pl-12 pr-4 py-3.5 text-base text-[var(--color-shell-text)] placeholder:text-[var(--color-shell-text-subtle)] focus:border-[var(--color-shell-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-shell-accent)]/15 shadow-xs"
        />
      </div>

      {/* Segment filter */}
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
          aria-label="Filter by segment"
        >
          <button
            role="tab"
            aria-selected={!selectedSegmentId}
            onClick={() => setSelectedSegmentId('')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap border cursor-pointer min-h-[38px] ${
              !selectedSegmentId
                ? 'border-[var(--color-shell-warning)]/40 bg-[var(--color-shell-warning-soft)] text-[var(--color-shell-text)] shadow-xs'
                : 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] text-[var(--color-shell-text-muted)] hover:bg-[var(--color-shell-surface-elevated)]'
            }`}
          >
            All Segments
          </button>
          {segments.map((seg) => {
            const isSelected = selectedSegmentId === seg.id;
            return (
              <button
                key={seg.id}
                role="tab"
                aria-selected={isSelected}
                onClick={() => setSelectedSegmentId(seg.id)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap border cursor-pointer min-h-[38px] ${
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

      {/* Filters */}
      <div className="flex items-center gap-2.5 flex-wrap">
        {/* Language */}
        <div className="relative">
          <button
            onClick={() => setShowLanguageDropdown((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={showLanguageDropdown}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-3 py-2 text-xs font-medium text-[var(--color-shell-text-muted)] hover:bg-[var(--color-shell-surface-elevated)] hover:border-[var(--color-shell-border-strong)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-accent)]"
          >
            <Filter className="h-3.5 w-3.5" />
            <span>Language</span>
            {languageFilter !== 'all' && (
              <Badge variant="default" className="text-[9px] py-0 px-1.5">
                {languageFilter}
              </Badge>
            )}
            <ChevronDown className={`h-3 w-3 transition-transform ${showLanguageDropdown ? 'rotate-180' : ''}`} />
          </button>
          <AnimatePresence>
            {showLanguageDropdown && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowLanguageDropdown(false)} />
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute left-0 top-full mt-1 z-20 w-44 max-h-64 overflow-y-auto rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] shadow-lg p-1 space-y-0.5"
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
                  {languages.map((lang) => (
                    <button
                      key={lang}
                      role="option"
                      aria-selected={languageFilter === lang}
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

        {/* Experience */}
        <div className="relative flex items-center">
          <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--color-shell-text-muted)] mr-1.5" />
          <select
            value={experienceFilter}
            onChange={(e) => setExperienceFilter(e.target.value as ExperienceFilter)}
            aria-label="Filter by experience"
            className="appearance-none rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-3 py-2 text-xs font-medium text-[var(--color-shell-text-muted)] hover:bg-[var(--color-shell-surface-elevated)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-accent)] pr-8"
          >
            {EXPERIENCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--color-shell-text-subtle)] pointer-events-none" />
        </div>

        {hasActiveFilters && (
          <button
            onClick={clearAllFilters}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-3 py-2 text-xs font-medium text-[var(--color-shell-text-muted)] hover:bg-[var(--color-shell-surface-elevated)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-accent)]"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-2xl border border-[var(--color-shell-error)]/30 bg-[var(--color-shell-error-soft)] p-4 text-sm text-[var(--color-shell-error)] shadow-xs">
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
          <Button onClick={loadMentors} variant="outline" size="sm" className="mt-3">
            Try Again
          </Button>
        </div>
      )}

      {/* Results header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-[var(--color-shell-text)]">All Mentors</h2>
        {isLoading ? (
          <Skeleton className="h-3 w-16" />
        ) : (
          <span className="text-xs text-[var(--color-shell-text-muted)]">
            {pagination.total} mentor{pagination.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-64 w-full rounded-2xl" />
          ))}
        </div>
      ) : error ? null : mentors.length === 0 ? (
        <EmptyState
          icon={Search}
          title={
            hasActiveFilters
              ? 'No Mentors Match Your Filters'
              : 'No mentors are currently available on the platform.'
          }
          description={
            hasActiveFilters
              ? 'No approved and active mentors match your current search and filters.'
              : 'There are no approved, active mentors on the platform yet. Please check back later.'
          }
          actionLabel={hasActiveFilters ? 'Clear Filters' : undefined}
          onAction={hasActiveFilters ? clearAllFilters : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {mentors.map((mentor) => (
            <MentorDirectoryCard
              key={mentor.id}
              mentor={mentor}
              date={today}
              navigate={navigate}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!error && pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pagination.page <= 1 || isLoading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="gap-1"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
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
            className="gap-1"
          >
            <span>Next</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
};

export default MentorDirectoryPage;
