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
import { SegmentMentorsSection } from '@/src/components/seeker/SegmentMentorsSection';
import { useSegmentMentors } from '@/src/hooks/seeker/useSegmentMentors';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { toUserMessage } from '@/src/lib/errorMessages';
import {
  fetchActiveSegments,
  getHighestPriorityActiveSegment,
  fetchDiscoverableMentors,
  fetchEligibleLanguages,
  fetchSegmentExperience,
} from '@/src/lib/discoveryService';
import { addDaysToDateString, buildQuickDates, getDateStringInTimezone } from '@/src/lib/slotEngine';
import { Segment, DiscoverableMentor } from '@/src/types/database';
import { SegmentThemeProvider } from '@/src/context/SegmentThemeContext';
import { useSegmentTheme } from '@/src/context/SegmentThemeContext';
import { SegmentExperiencePage } from '@/src/components/seeker/SegmentExperiencePage';
import { SegmentExperienceProvider, useSegmentExperience } from '@/src/context/SegmentExperienceContext';

type ExperienceFilter = 'all' | '0-2' | '3-5' | '6+';

const EXPERIENCE_OPTIONS: { value: ExperienceFilter; label: string }[] = [
  { value: 'all', label: 'All experience' },
  { value: '0-2', label: '0–2 years' },
  { value: '3-5', label: '3–5 years' },
  { value: '6+', label: '6+ years' },
];

export const SeekerHomePage: React.FC = () => {
  // The active segment lives at the very top so that BOTH providers below can
  // read it: the experience provider needs the slug to fetch/subscribe, and the
  // theme provider needs the segment to apply the configured palette.
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<Segment | null>(null);

  return (
    <SegmentExperienceProvider slug={selectedSegment?.slug ?? null}>
      {/*
        The theme provider sits INSIDE the experience provider so it can receive
        the live config. That is what makes a realtime accent change repaint the
        page immediately, rather than only swapping the text content.
      */}
      <SegmentThemeBridge activeSegment={selectedSegment}>
        <SeekerHomeContent
          segments={segments}
          setSegments={setSegments}
          activeSegment={selectedSegment}
          onSegmentSelected={setSelectedSegment}
        />
      </SegmentThemeBridge>
    </SegmentExperienceProvider>
  );
};

/** Feeds the live experience config into the theme provider. */
const SegmentThemeBridge: React.FC<{
  activeSegment: Segment | null;
  children: React.ReactNode;
}> = ({ activeSegment, children }) => {
  const { config } = useSegmentExperience();
  return (
    <SegmentThemeProvider initialSegment={activeSegment} liveConfig={config}>
      {children}
    </SegmentThemeProvider>
  );
};

/**
 * Everything that reads segment theme state lives below the provider, so the
 * page never calls useSegmentTheme at a level where the provider is not yet
 * mounted.
 */
const SeekerHomeContent: React.FC<{
  segments: Segment[];
  setSegments: React.Dispatch<React.SetStateAction<Segment[]>>;
  activeSegment: Segment | null;
  /** Prop name avoids colliding with the local `setSelectedSegment` callback. */
  onSegmentSelected: React.Dispatch<React.SetStateAction<Segment | null>>;
}> = ({ segments, setSegments, activeSegment, onSegmentSelected: setSelectedSegmentState }) => {
  const { navigate } = useNavigation();
  const { profile } = useAuth();
  const { setActiveSegment } = useSegmentTheme();

  const selectedSegment = activeSegment;

  const userTimezone = profile?.timezone || 'UTC';

  const [today, setToday] = useState<string>(() =>
    getDateStringInTimezone(new Date(), userTimezone)
  );

  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [languageFilter, setLanguageFilter] = useState<string>('all');
  const [experienceFilter, setExperienceFilter] = useState<ExperienceFilter>('all');
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);

  const [mentors, setMentors] = useState<DiscoverableMentor[]>([]);
  const [eligibleLanguages, setEligibleLanguages] = useState<string[]>([]);
  const [isLoadingSegments, setIsLoadingSegments] = useState<boolean>(true);
  const [isLoadingMentors, setIsLoadingMentors] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [mentorError, setMentorError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState<number>(0);
  const [experienceError, setExperienceError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setToday(getDateStringInTimezone(new Date(), userTimezone));
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, [userTimezone]);

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
          setSelectedSegmentState(topSegment);
          setActiveSegment(topSegment);
        }
      } catch (err: any) {
        if (isMounted) {
          console.error('Error loading segments:', err);
          setError(toUserMessage(err, 'Failed to load mentorship segments'));
        }
      } finally {
        if (isMounted) setIsLoadingSegments(false);
      }
    }
    loadSegments();
    return () => {
      isMounted = false;
    };
  }, [reloadToken, setActiveSegment]);

  const setSelectedSegment = useCallback((segment: Segment | null) => {
    setSelectedSegmentState(segment);
    setActiveSegment(segment);
  }, [setActiveSegment]);

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

  const tomorrow = useMemo(() => addDaysToDateString(today, 1), [today]);
  const quickDates = useMemo(() => buildQuickDates(today, 6), [today]);

  const handleDateSelect = (dateValue: string) => {
    setSelectedDate(dateValue);
  };

  const scrollToSegmentMentors = () => {
    const target = document.getElementById('segment-mentors');
    if (!target) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  };

  const goToAllMentors = () => {
    const params = new URLSearchParams();
    if (selectedSegment) params.set('segmentSlug', selectedSegment.slug);
    navigate(`/mentors?${params.toString()}`);
  };

  const retryLoad = () => setReloadToken((t) => t + 1);

  const {
    mentors: segmentMentors,
    total: segmentMentorTotal,
    isLoading: isLoadingSegmentMentors,
    error: segmentMentorError,
    reload: reloadSegmentMentors,
  } = useSegmentMentors(selectedSegment?.id ?? null);

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
        { label: 'View all mentors', onClick: scrollToSegmentMentors, variant: 'outline' },
      ];
    }
    if (tomorrow && selectedDate !== tomorrow) {
      return [
        { label: 'Try tomorrow', onClick: () => handleDateSelect(tomorrow), variant: 'primary' },
        { label: 'View all mentors', onClick: scrollToSegmentMentors, variant: 'outline' },
      ];
    }
    return [{ label: 'View all mentors', onClick: scrollToSegmentMentors, variant: 'primary' }];
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
        className="section-container space-y-8 sm:mt-12"
      >
        {selectedSegment ? (
          <SegmentExperiencePage
            segment={selectedSegment}
            mentors={mentors}
            selectedDate={selectedDate}
            today={today}
            isLoadingMentors={isLoadingMentors}
            mentorError={mentorError}
            navigate={navigate}
            showHero={false}
          />
        ) : (
          <>
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

            <div className="divider-gradient" aria-hidden="true" />

            <AvailableMentorsHeader
              segmentName={(selectedSegment as Segment | null)?.name || null}
              selectedDate={selectedDate}
              count={filteredMentors.length}
              isCountLoading={isLoadingMentors || !!mentorError}
              onViewAll={scrollToSegmentMentors}
            />

            {/* Segment-level error */}
            {error && (
              <div className="error-banner">
                <div className="flex items-center gap-2 font-semibold">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  <span>Something went wrong</span>
                </div>
                <p className="text-sm">{error}</p>
                <Button onClick={retryLoad} variant="outline" size="sm" className="mt-2 sm:mt-0">
                  Try Again
                </Button>
              </div>
            )}

            {/* Mentor-level error */}
            {mentorError && !error && (
              <div className="error-banner">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertCircle className="h-4 w-4" aria-hidden="true" />
                  <span>{mentorError}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
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
              <MentorGridSkeleton count={3} />
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
                today={today}
                navigate={navigate}
              />
            )}
          </>
        )}
      </motion.div>

      {!selectedSegment && (
        <>
          {/* Visual divider — separates AVAILABILITY from DISCOVERY */}
          <div className="section-container mt-16 sm:mt-20 lg:mt-24" aria-hidden="true">
            <div className="divider-gradient" />
          </div>

          {/*
            SECTION B — all real mentors in the selected segment.
            Answers "who are the mentors in this segment?"
          */}
          <div className="section-container">
            <SegmentMentorsSection
              segment={selectedSegment}
              mentors={segmentMentors}
              total={segmentMentorTotal}
              isLoading={isLoadingSegmentMentors}
              error={segmentMentorError}
              onRetry={reloadSegmentMentors}
              selectedDate={selectedDate}
              today={today}
              navigate={navigate}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default SeekerHomePage;
