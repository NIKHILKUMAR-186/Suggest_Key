import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ShieldCheck, AlertCircle, SearchX, CalendarX } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/src/components/ui/Button';
import { SeekerHero } from '@/src/components/seeker/SeekerHero';
import { FilterBar } from '@/src/components/seeker/FilterBar';
import { AvailableMentorsHeader } from '@/src/components/seeker/AvailableMentorsHeader';
import { MentorGrid, MentorGridSkeleton } from '@/src/components/seeker/MentorGrid';
import {
  EmptyMentorState,
  EmptyMentorStateAction,
} from '@/src/components/seeker/EmptyMentorState';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import {
  fetchActiveSegments,
  getHighestPriorityActiveSegment,
  fetchDiscoverableMentors,
  fetchEligibleLanguages,
} from '@/src/lib/discoveryService';
import { addDaysToDateString, getDateStringInTimezone } from '@/src/lib/slotEngine';
import { Segment, DiscoverableMentor } from '@/src/types/database';

type ExperienceFilter = 'all' | '0-2' | '3-5' | '6+';

const EXPERIENCE_OPTIONS: { value: ExperienceFilter; label: string }[] = [
  { value: 'all', label: 'All experience' },
  { value: '0-2', label: '0–2 years' },
  { value: '3-5', label: '3–5 years' },
  { value: '6+', label: '6+ years' },
];

export const SeekerHomePage: React.FC = () => {
  const { navigate } = useNavigation();
  const { profile } = useAuth();

  // The seeker's own timezone drives "Today"/"Tomorrow". Falls back to UTC
  // rather than the browser default so the value is reproducible.
  const userTimezone = profile?.timezone || 'UTC';

  const [today, setToday] = useState<string>(() =>
    getDateStringInTimezone(new Date(), userTimezone)
  );

  const [selectedDate, setSelectedDate] = useState<string>(today);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [languageFilter, setLanguageFilter] = useState<string>('all');
  const [experienceFilter, setExperienceFilter] = useState<ExperienceFilter>('all');
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

  // Keep the calendar day in sync so the page is correct without a reload
  // when it stays open past midnight.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setToday(getDateStringInTimezone(new Date(), userTimezone));
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, [userTimezone]);

  // The language filter is populated from real mentor data, never a hardcoded list.
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
  }, [reloadToken]);

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
          // A failed request must never be rendered as "0 mentors".
          setMentors([]);
          setMentorError('Unable to load mentors right now.');
        }
      } finally {
        if (isMounted) setIsLoadingMentors(false);
      }
    }
    loadMentors();
    return () => {
      isMounted = false;
    };
  }, [selectedSegment, selectedDate, reloadToken]);

  const availableLanguages = useMemo(() => {
    const langs = new Set<string>(eligibleLanguages);
    mentors.forEach((m) => (m.languages || []).forEach((l) => langs.add(l)));
    return Array.from(langs).sort();
  }, [mentors, eligibleLanguages]);

  const filteredMentors = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return mentors.filter((m) => {
      if (query) {
        // Searches only columns that actually exist in the database.
        const searchable = [
          m.full_name,
          m.headline,
          m.about || '',
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

  const hasActiveFilters = languageFilter !== 'all' || experienceFilter !== 'all' || searchQuery.trim() !== '';

  const clearAllFilters = useCallback(() => {
    setSearchQuery('');
    setLanguageFilter('all');
    setExperienceFilter('all');
  }, []);

  // Derived from the live clock, never a hardcoded calendar date.
  const tomorrow = useMemo(() => addDaysToDateString(today, 1), [today]);

  const quickDates = useMemo(() => {
    const dates = [{ label: 'Today', value: today }];
    if (tomorrow) dates.push({ label: 'Tomorrow', value: tomorrow });
    return dates;
  }, [today, tomorrow]);

  const handleDateSelect = (dateValue: string) => {
    setSelectedDate(dateValue);
  };

  const goToAllMentors = () => {
    const params = new URLSearchParams();
    if (selectedSegment) params.set('segmentId', selectedSegment.id);
    navigate(`/mentors?${params.toString()}`);
  };

  const retryLoad = () => setReloadToken((t) => t + 1);

  // Empty-state copy is derived from the real current context only.
  const emptyContextLabel = [selectedSegment?.name, selectedDate].filter(Boolean).join(' · ');

  const emptyTitle = hasActiveFilters
    ? 'No mentors match these filters'
    : 'No mentors available for this date';

  const emptyDescription = hasActiveFilters
    ? 'Nothing here fits your current search, language or experience selection. Clear the filters to see everyone available.'
    : `No mentor in ${
        selectedSegment?.name || 'this segment'
      } has a bookable slot on ${selectedDate}. Try another date, or browse all verified mentors.`;

  const emptyActions: EmptyMentorStateAction[] = useMemo(() => {
    if (hasActiveFilters) {
      return [
        { label: 'Clear filters', onClick: clearAllFilters, variant: 'primary' },
        { label: 'View all mentors', onClick: goToAllMentors, variant: 'outline' },
      ];
    }
    if (tomorrow && selectedDate !== tomorrow) {
      return [
        { label: 'Try tomorrow', onClick: () => handleDateSelect(tomorrow), variant: 'primary' },
        { label: 'View all mentors', onClick: goToAllMentors, variant: 'outline' },
      ];
    }
    return [{ label: 'View all mentors', onClick: goToAllMentors, variant: 'primary' }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActiveFilters, tomorrow, selectedDate, clearAllFilters]);

  return (
    <div className="seeker-page">
      <SeekerHero
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        segments={segments}
        selectedSegment={selectedSegment}
        onSelectSegment={setSelectedSegment}
        isLoadingSegments={isLoadingSegments}
        selectedDate={selectedDate}
        minDate={today}
        quickDates={quickDates}
        onSelectDate={handleDateSelect}
      />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.1, ease: [0.23, 1, 0.31, 1] }}
        className="mt-10 space-y-8 sm:mt-12"
      >
        {/* Filters sit directly above the results they control */}
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

        <div className="h-px w-full bg-[var(--color-shell-border)]" aria-hidden="true" />

        <AvailableMentorsHeader
          segmentName={selectedSegment?.name || null}
          selectedDate={selectedDate}
          count={filteredMentors.length}
          isCountLoading={isLoadingMentors || !!mentorError}
          onViewAll={goToAllMentors}
        />

        {/* Segment-level error */}
        {error && (
          <div className="rounded-2xl border border-[var(--color-shell-error)]/30 bg-[var(--color-shell-error-soft)] p-4 text-sm text-[var(--color-shell-error)]">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="h-4 w-4" />
              <span>Something went wrong</span>
            </div>
            <p className="mt-1">{error}</p>
            <Button onClick={retryLoad} variant="outline" size="sm" className="mt-3">
              Try Again
            </Button>
          </div>
        )}

        {/* Mentor-level error - must never render as "0 mentors" */}
        {mentorError && !error && (
          <div className="rounded-2xl border border-[var(--color-shell-error)]/30 bg-[var(--color-shell-error-soft)] p-4 text-sm text-[var(--color-shell-error)]">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="h-4 w-4" />
              <span>{mentorError}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button onClick={retryLoad} variant="outline" size="sm">
                Try Again
              </Button>
              <Button onClick={goToAllMentors} variant="ghost" size="sm">
                View All Mentors
              </Button>
            </div>
          </div>
        )}

        {/* Content */}
        {isLoadingMentors ? (
          <MentorGridSkeleton count={4} />
        ) : mentorError ? null : filteredMentors.length === 0 ? (
          <EmptyMentorState
            icon={hasActiveFilters ? SearchX : CalendarX}
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
            navigate={navigate}
          />
        )}
      </motion.div>
    </div>
  );
};

export default SeekerHomePage;
