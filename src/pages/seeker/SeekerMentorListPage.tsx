import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ArrowLeft, Shield, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/src/components/ui/Button';
import { SegmentSelector } from '@/src/components/seeker/SegmentSelector';
import { DateSelector } from '@/src/components/seeker/DateSelector';
import { FilterBar } from '@/src/components/seeker/FilterBar';
import { AvailableMentorsHeader } from '@/src/components/seeker/AvailableMentorsHeader';
import { MentorGrid, MentorGridSkeleton } from '@/src/components/seeker/MentorGrid';
import {
  EmptyMentorState,
  EmptyMentorStateAction,
} from '@/src/components/seeker/EmptyMentorState';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { toUserMessage } from '@/src/lib/errorMessages';
import {
  fetchActiveSegments,
  getHighestPriorityActiveSegment,
  fetchDiscoverableMentors,
  fetchEligibleLanguages,
} from '@/src/lib/discoveryService';
import { addDaysToDateString, buildQuickDates, getDateStringInTimezone } from '@/src/lib/slotEngine';
import { mentorListPath, segmentLandingPath } from '@/src/lib/mentorNav';
import { pluralizeSegmentName } from '@/src/lib/segmentNaming';
import { Segment, DiscoverableMentor } from '@/src/types/database';
import { SegmentThemeProvider } from '@/src/context/SegmentThemeContext';
import { useAvailabilitySync } from '@/src/hooks/useAvailabilitySync';

type ExperienceFilter = 'all' | '0-2' | '3-5' | '6+';

const EXPERIENCE_OPTIONS: { value: ExperienceFilter; label: string }[] = [
  { value: 'all', label: 'All experience' },
  { value: '0-2', label: '0–2 years' },
  { value: '3-5', label: '3–5 years' },
  { value: '6+', label: '6+ years' },
];

export const SeekerMentorListPage: React.FC = () => {
  const { navigate, replace, currentPath } = useNavigation();
  const { profile } = useAuth();

  const userTimezone = profile?.timezone || 'UTC';

  const searchParams = new URLSearchParams(
    currentPath.includes('?') ? currentPath.split('?')[1] : ''
  );
  const paramSegmentSlug = searchParams.get('segmentSlug') || '';
  const paramDate = searchParams.get('date') || '';

  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return paramDate || getDateStringInTimezone(new Date(), userTimezone);
  });

  const [searchQuery, setSearchQuery] = useState<string>('');
  // Filters start from the URL so a shared or revisited discovery link lands on
  // the same result set the sender saw.
  const [languageFilter, setLanguageFilter] = useState<string>(
    () => searchParams.get('language') || 'all'
  );
  const [experienceFilter, setExperienceFilter] = useState<ExperienceFilter>(
    () => (searchParams.get('experience') as ExperienceFilter) || 'all'
  );
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);

  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<Segment | null>(null);
  const [mentors, setMentors] = useState<DiscoverableMentor[]>([]);
  const [eligibleLanguages, setEligibleLanguages] = useState<string[]>([]);
  const [isLoadingSegments, setIsLoadingSegments] = useState<boolean>(true);
  const [isLoadingMentors, setIsLoadingMentors] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [mentorError, setMentorError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState<number>(0);

  /**
   * Discovery reads the same server endpoint as mentor detail, and a card's
   * "available on <date>" claim is a slot claim. A mentor who edits their hours,
   * or another seeker who takes the only open slot, has to be able to change
   * what this list says without a refresh.
   *
   * The subscription is intentionally NOT mentor-scoped: this page spans every
   * mentor in the segment, so any of them may change. It is the same hook and
   * the same refetch path as mentor detail, not a second implementation.
   */
  const handleAvailabilityChange = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  useAvailabilitySync({
    mentorId: null,
    enabled: Boolean(selectedSegment),
    onInvalidate: handleAvailabilityChange,
  });

  useEffect(() => {
    let isMounted = true;
    async function loadLanguages() {
      const { languages } = await fetchEligibleLanguages();
      if (isMounted) setEligibleLanguages(languages);
    }
    loadLanguages();
    return () => {
      isMounted = false;
    };
  }, [reloadToken]);

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
              activeSegs.find((s) => s.slug === paramSegmentSlug) ||
              getHighestPriorityActiveSegment(activeSegs);
            setSelectedSegment(matched || null);
          }
      } catch (err: any) {
        if (isMounted) {
          console.error('Error loading segments:', err);
          setError(toUserMessage(err, 'Failed to load segments'));
        }
      } finally {
        if (isMounted) setIsLoadingSegments(false);
      }
    }
    loadSegments();
    return () => { isMounted = false; };
  }, [paramSegmentSlug, reloadToken]);

  useEffect(() => {
    let isMounted = true;
    if (!selectedSegment) {
      setMentors([]);
      return;
    }
    async function loadMentors() {
      setIsLoadingMentors(true);
      setMentorError(null);
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
          setMentors([]);
          setMentorError('Unable to load mentors right now.');
        }
      } finally {
        if (isMounted) setIsLoadingMentors(false);
      }
    }
    loadMentors();
    return () => { isMounted = false; };
  }, [selectedSegment, selectedDate, reloadToken]);

  // Discovery state is mirrored into the query string so it survives a refresh,
  // a shared link, and the trip out to mentor detail and back. `replace` rather
  // than `navigate`: a filter change must not push a history entry that Back
  // would then have to walk through one click at a time.
  const targetPath = useMemo(() => {
    const [route, existingQuery] = mentorListPath({
      segmentSlug: selectedSegment?.slug || paramSegmentSlug,
      date: selectedDate,
    }).split('?');
    const params = new URLSearchParams(existingQuery || '');
    if (languageFilter !== 'all') params.set('language', languageFilter);
    if (experienceFilter !== 'all') params.set('experience', experienceFilter);
    const query = params.toString();
    return query ? `${route}?${query}` : route;
  }, [selectedSegment?.slug, paramSegmentSlug, selectedDate, languageFilter, experienceFilter]);

  useEffect(() => {
    if (targetPath !== currentPath) replace(targetPath);
  }, [targetPath, currentPath, replace]);

  const availableLanguages = useMemo(() => {
    const langs = new Set<string>(eligibleLanguages);
    mentors.forEach((m) => (m.languages || []).forEach((l) => langs.add(l)));
    return Array.from(langs).sort();
  }, [mentors, eligibleLanguages]);

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
          ...(m.expertise || []),
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

  const today = getDateStringInTimezone(new Date(), userTimezone);
  const tomorrow = addDaysToDateString(today, 1);
  const quickDates = useMemo(() => buildQuickDates(today, 6), [today]);

  const emptyContextLabel = [selectedSegment?.name, selectedDate].filter(Boolean).join(' · ');

  const emptyTitle = hasActiveFilters
    ? 'No mentors match these filters'
    : 'No mentors available for this date';

  const emptyDescription = hasActiveFilters
    ? 'Nothing here fits your current search, language or experience selection. Clear the filters to see everyone available.'
    : `No mentor in ${
        selectedSegment?.name || 'this segment'
      } has a bookable slot on ${selectedDate}. Try another date.`;

  const emptyActions: EmptyMentorStateAction[] = hasActiveFilters
    ? [{ label: 'Clear filters', onClick: clearAllFilters, variant: 'primary' }]
    : tomorrow && selectedDate !== tomorrow
      ? [{ label: 'Try tomorrow', onClick: () => setSelectedDate(tomorrow), variant: 'primary' }]
      : [];

  return (
    <SegmentThemeProvider initialSegment={selectedSegment}>
    <div className="seeker-page section-container space-y-8">
      {/* Back to the segment landing page the seeker came from, and the page
          title. Both are built from the real segment row. */}
      <div className="mx-auto max-w-[1180px] space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <motion.button
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3 }}
            onClick={() => navigate(segmentLandingPath({ segmentSlug: selectedSegment?.slug || paramSegmentSlug, date: selectedDate }))}
            aria-label="Go back"
            className="-ml-1 inline-flex cursor-pointer items-center gap-1.5 rounded-md p-1 text-xs font-semibold text-[var(--color-shell-text-muted)] transition-colors hover:text-[var(--color-shell-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{selectedSegment ? `Back to ${selectedSegment.name}` : 'Back to Discovery'}</span>
          </motion.button>
          <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
            {selectedSegment ? pluralizeSegmentName(selectedSegment.name) : 'Mentors'}
          </h1>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-[var(--color-shell-text-muted)]">
            Find a verified mentor for a 1:1 session. Every mentor below has a real,
            bookable slot on the day you pick.
          </p>
        </div>
      </div>

      {/* Discovery controls */}
      <div className="seeker-panel surface-float space-y-5 rounded-3xl p-4 sm:p-5">
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-shell-text-subtle)]">
            Explore segments
          </p>
          <SegmentSelector
            segments={segments}
            selected={selectedSegment}
            onSelect={setSelectedSegment}
            isLoading={isLoadingSegments}
            align="start"
          />
        </div>

        <div className="divider-gradient" aria-hidden="true" />

        <DateSelector
          selectedDate={selectedDate}
          minDate={today}
          quickDates={quickDates}
          onSelect={setSelectedDate}
        />
      </div>

      <FilterBar
        availableLanguages={availableLanguages}
        languageFilter={languageFilter}
        onLanguageChange={setLanguageFilter}
        languageMenuOpen={showLanguageDropdown}
        onLanguageMenuToggle={() => setShowLanguageDropdown((v) => !v)}
        onLanguageMenuClose={() => setShowLanguageDropdown(false)}
        experienceOptions={EXPERIENCE_OPTIONS}
        experienceFilter={experienceFilter}
        onExperienceChange={(value) => setExperienceFilter(value as ExperienceFilter)}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearAllFilters}
      />

      <div className="divider-gradient" aria-hidden="true" />

      <AvailableMentorsHeader
        segmentName={selectedSegment?.name || null}
        selectedDate={selectedDate}
        count={filteredMentors.length}
        isCountLoading={isLoadingMentors || !!mentorError}
      />

      {/* Error */}
      {(error || mentorError) && (
        <div className="error-banner">
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <span>{error || mentorError}</span>
          </div>
          <Button
            onClick={() => setReloadToken((t) => t + 1)}
            variant="outline"
            size="sm"
            className="mt-2 sm:mt-0"
          >
            Try Again
          </Button>
        </div>
      )}

      {/* Content */}
      {isLoadingSegments || isLoadingMentors ? (
        <MentorGridSkeleton count={3} />
      ) : mentorError ? null : filteredMentors.length === 0 ? (
        <EmptyMentorState
          title={emptyTitle}
          description={emptyDescription}
          contextLabel={emptyContextLabel}
          actions={emptyActions}
        />
      ) : (
        <MentorGrid
          featuredMentors={featuredMentors}
          regularMentors={regularMentors}
          selectedSegment={selectedSegment}
          selectedDate={selectedDate}
          today={today}
          navigate={navigate}
        />
      )}

      {/* Notice on Real Availability Engine */}
      {!error && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
          className="flex items-start gap-3 rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-4 text-xs text-[var(--color-shell-text-muted)]"
        >
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-shell-text-muted)]" aria-hidden="true" />
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
    </div>
    </SegmentThemeProvider>
  );
};

export default SeekerMentorListPage;
