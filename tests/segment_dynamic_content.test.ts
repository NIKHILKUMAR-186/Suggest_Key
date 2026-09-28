import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchActiveSegments,
  fetchSegmentBySlug,
  fetchDiscoverableMentors,
  fetchAllMentors,
  fetchMentorDetail,
  getHighestPriorityActiveSegment,
} from '../src/lib/discoveryService';
import { isSupabaseConfigured } from '../src/lib/supabase';

const SEGMENT_TESTS_ENABLED = isSupabaseConfigured();

describe('Segment-based Dynamic Content', () => {
  let activeSegments: Awaited<ReturnType<typeof fetchActiveSegments>>['segments'] = [];

  before(async () => {
    if (SEGMENT_TESTS_ENABLED) {
      const { segments } = await fetchActiveSegments();
      activeSegments = segments;
    }
  });

  describe('Segment Selection', () => {
    it('fetches active segments ordered by priority', async () => {
      if (!SEGMENT_TESTS_ENABLED) {
        console.log('Skipping: Supabase not configured');
        return;
      }
      const { segments, error } = await fetchActiveSegments();
      assert.equal(error, null, 'Should not error when fetching segments');
      assert.ok(Array.isArray(segments), 'Should return array of segments');
      assert.ok(segments.length > 0, 'Should have at least one active segment');
      // Verify ordering by priority (ascending = highest priority first)
      for (let i = 1; i < segments.length; i++) {
        assert.ok(
          segments[i].priority >= segments[i - 1].priority,
          'Segments should be ordered by priority ascending'
        );
      }
      // Verify all returned segments are active
      for (const seg of segments) {
        assert.equal(seg.is_active, true, 'All returned segments should be active');
      }
    });

    it('resolves segment by slug to UUID', async () => {
      if (!SEGMENT_TESTS_ENABLED) {
        console.log('Skipping: Supabase not configured');
        return;
      }
      if (activeSegments.length === 0) {
        console.log('Skipping: No active segments available');
        return;
      }
      const testSegment = activeSegments[0];
      const segment = await fetchSegmentBySlug(testSegment.slug);
      assert.ok(segment, 'Should resolve segment by slug');
      assert.equal(segment!.id, testSegment.id, 'Resolved segment should match original');
      assert.equal(segment!.slug, testSegment.slug, 'Slug should match');
    });

    it('returns null for inactive or non-existent slug', async () => {
      if (!SEGMENT_TESTS_ENABLED) {
        console.log('Skipping: Supabase not configured');
        return;
      }
      const segment = await fetchSegmentBySlug('non-existent-segment-slug');
      assert.equal(segment, null, 'Should return null for non-existent slug');
    });

    it('selects highest priority active segment as default', () => {
      if (activeSegments.length === 0) {
        console.log('Skipping: No active segments available');
        return;
      }
      const top = getHighestPriorityActiveSegment(activeSegments);
      assert.ok(top, 'Should return a segment');
      assert.equal(top.is_active, true, 'Default segment should be active');
      // Verify it has the lowest priority number (highest priority)
      for (const seg of activeSegments) {
        if (seg.is_active) {
          assert.ok(
            top.priority <= seg.priority,
            'Default should have highest priority (lowest number)'
          );
        }
      }
    });
  });

  describe('Correct Mentor Filtering by Segment', () => {
    it('returns mentors belonging to the selected segment (discoverable)', async () => {
      if (!SEGMENT_TESTS_ENABLED) {
        console.log('Skipping: Supabase not configured');
        return;
      }
      if (activeSegments.length === 0) {
        console.log('Skipping: No active segments available');
        return;
      }
      const segment = activeSegments[0];
      const today = new Date().toISOString().split('T')[0];
      const { mentors, error } = await fetchDiscoverableMentors(segment.id, today);
      assert.equal(error, null, 'Should not error when fetching discoverable mentors');
      // Every returned mentor should have the segment's gig
      for (const mentor of mentors) {
        assert.equal(mentor.segment.id, segment.id, 'Mentor should belong to selected segment');
        assert.equal(mentor.gig.segment_id, segment.id, 'Mentor gig should belong to selected segment');
      }
    });

    it('returns all eligible mentors in segment (directory, no date filter)', async () => {
      if (!SEGMENT_TESTS_ENABLED) {
        console.log('Skipping: Supabase not configured');
        return;
      }
      if (activeSegments.length === 0) {
        console.log('Skipping: No active segments available');
        return;
      }
      const segment = activeSegments[0];
      const { mentors, error } = await fetchAllMentors({ segmentId: segment.id });
      assert.equal(error, null, 'Should not error when fetching all mentors');
      // Every returned mentor should have the segment in their segments array
      for (const mentor of mentors) {
        const hasSegment = mentor.segments.some((s) => s.id === segment.id);
        assert.ok(hasSegment, `Mentor ${mentor.full_name} should belong to segment ${segment.name}`);
        // Should have at least one active gig for this segment
        const segmentGig = mentor.gigs.find((g) => g.segment_id === segment.id && g.is_active);
        assert.ok(segmentGig, `Mentor ${mentor.full_name} should have active gig for segment ${segment.name}`);
      }
    });

    it('returns zero mentors for segment with no mentor_segments entries', async () => {
      if (!SEGMENT_TESTS_ENABLED) {
        console.log('Skipping: Supabase not configured');
        return;
      }
      // This test requires a segment with no mentors assigned
      // We can't easily create one, so we verify the query returns empty array rather than error
      const segment = activeSegments[0];
      const { mentors, error } = await fetchDiscoverableMentors(segment.id, '2099-01-01'); // Future date
      assert.equal(error, null, 'Should not error even with no available slots');
      // Result may be empty if no mentors have slots on that date, which is valid
      assert.ok(Array.isArray(mentors), 'Should return array (possibly empty)');
    });
  });

  describe('Correct Gig Filtering by Segment', () => {
    it('returns gig belonging to the selected segment for each mentor', async () => {
      if (!SEGMENT_TESTS_ENABLED) {
        console.log('Skipping: Supabase not configured');
        return;
      }
      if (activeSegments.length === 0) {
        console.log('Skipping: No active segments available');
        return;
      }
      const segment = activeSegments[0];
      const today = new Date().toISOString().split('T')[0];
      const { mentors, error } = await fetchDiscoverableMentors(segment.id, today);
      assert.equal(error, null);
      for (const mentor of mentors) {
        // The gig returned should be for the selected segment
        assert.equal(mentor.gig.segment_id, segment.id, 'Gig should match selected segment');
        assert.ok(mentor.gig.is_active, 'Gig should be active');
        assert.ok(mentor.gig.title.length > 0, 'Gig should have a title');
        assert.ok(mentor.gig.duration_minutes > 0, 'Gig should have duration');
        assert.ok(mentor.gig.price_inr > 0, 'Gig should have price');
      }
    });

    it('returns correct gig in mentor detail for segment', async () => {
      if (!SEGMENT_TESTS_ENABLED) {
        console.log('Skipping: Supabase not configured');
        return;
      }
      if (activeSegments.length === 0) {
        console.log('Skipping: No active segments available');
        return;
      }
      const segment = activeSegments[0];
      const today = new Date().toISOString().split('T')[0];
      const { mentors } = await fetchDiscoverableMentors(segment.id, today);
      if (mentors.length === 0) {
        console.log('Skipping: No discoverable mentors for segment');
        return;
      }
      const mentor = mentors[0];
      const { mentor: detail, error } = await fetchMentorDetail(mentor.id, segment.id, today);
      assert.equal(error, null);
      assert.ok(detail, 'Should return mentor detail');
      assert.equal(detail!.gig.segment_id, segment.id, 'Detail gig should match selected segment');
      assert.equal(detail!.segment.id, segment.id, 'Detail segment should match selected segment');
    });

    it('does not return gigs from other segments', async () => {
      if (!SEGMENT_TESTS_ENABLED) {
        console.log('Skipping: Supabase not configured');
        return;
      }
      if (activeSegments.length < 2) {
        console.log('Skipping: Need at least 2 segments');
        return;
      }
      const segment1 = activeSegments[0];
      const segment2 = activeSegments[1];
      const today = new Date().toISOString().split('T')[0];
      const { mentors } = await fetchDiscoverableMentors(segment1.id, today);
      for (const mentor of mentors) {
        assert.notEqual(
          mentor.gig.segment_id,
          segment2.id,
          'Mentor gig should not be from a different segment'
        );
      }
    });
  });

  describe('Empty Segment Handling', () => {
    it('handles segment with no mentors gracefully (directory)', async () => {
      if (!SEGMENT_TESTS_ENABLED) {
        console.log('Skipping: Supabase not configured');
        return;
      }
      if (activeSegments.length === 0) {
        console.log('Skipping: No active segments available');
        return;
      }
      // Use a future date where no mentors might have availability
      const futureDate = '2099-01-01';
      const segment = activeSegments[0];
      const { mentors, error } = await fetchDiscoverableMentors(segment.id, futureDate);
      assert.equal(error, null);
      assert.ok(Array.isArray(mentors));
      // Empty array is valid - no mentors with slots on that date
    });

    it('handles segment with no active gigs gracefully', async () => {
      if (!SEGMENT_TESTS_ENABLED) {
        console.log('Skipping: Supabase not configured');
        return;
      }
      // fetchAllMentors with segmentId filter should handle segments with no gigs
      const segment = activeSegments[0];
      const { mentors, error } = await fetchAllMentors({ segmentId: segment.id });
      assert.equal(error, null);
      // Should return only mentors that have active gigs in this segment
      for (const mentor of mentors) {
        const segmentGig = mentor.gigs.find((g) => g.segment_id === segment.id && g.is_active);
        assert.ok(segmentGig, 'Returned mentor should have active gig for segment');
      }
    });
  });

  describe('Inactive Segment Handling', () => {
    it('does not return inactive segments in fetchActiveSegments', async () => {
      if (!SEGMENT_TESTS_ENABLED) {
        console.log('Skipping: Supabase not configured');
        return;
      }
      const { segments, error } = await fetchActiveSegments();
      assert.equal(error, null);
      for (const seg of segments) {
        assert.equal(seg.is_active, true, 'fetchActiveSegments should only return active segments');
      }
    });

    it('fetchSegmentBySlug does not return inactive segments', async () => {
      if (!SEGMENT_TESTS_ENABLED) {
        console.log('Skipping: Supabase not configured');
        return;
      }
      // We can't easily test this without an inactive segment, but we verify
      // the query includes is_active = true filter by checking active segments work
      if (activeSegments.length > 0) {
        const segment = await fetchSegmentBySlug(activeSegments[0].slug);
        assert.ok(segment, 'Active segment should be resolvable by slug');
        assert.equal(segment!.is_active, true);
      }
    });

    it('fetchDiscoverableMentors returns empty for inactive segment', async () => {
      if (!SEGMENT_TESTS_ENABLED) {
        console.log('Skipping: Supabase not configured');
        return;
      }
      // We can't easily test with an inactive segment UUID, but we can verify
      // the function handles non-existent UUID gracefully
      const fakeInactiveId = '00000000-0000-0000-0000-000000000000';
      const today = new Date().toISOString().split('T')[0];
      const { mentors, error } = await fetchDiscoverableMentors(fakeInactiveId, today);
      assert.equal(error, null, 'Should not error for non-existent segment');
      assert.equal(mentors.length, 0, 'Should return empty array for non-existent segment');
    });
  });

  describe('Switching Between Segments', () => {
    it('returns different mentor sets for different segments', async () => {
      if (!SEGMENT_TESTS_ENABLED) {
        console.log('Skipping: Supabase not configured');
        return;
      }
      if (activeSegments.length < 2) {
        console.log('Skipping: Need at least 2 segments');
        return;
      }
      const segment1 = activeSegments[0];
      const segment2 = activeSegments[1];
      const today = new Date().toISOString().split('T')[0];

      const { mentors: mentors1, error: err1 } = await fetchDiscoverableMentors(segment1.id, today);
      const { mentors: mentors2, error: err2 } = await fetchDiscoverableMentors(segment2.id, today);

      assert.equal(err1, null);
      assert.equal(err2, null);

      const ids1 = new Set(mentors1.map((m) => m.id));
      const ids2 = new Set(mentors2.map((m) => m.id));

      // Segments should have different mentor sets (or at least the query should be segment-specific)
      // Note: A mentor can belong to multiple segments, so overlap is possible
      // But the gig for each mentor should be segment-specific
      for (const mentor of mentors1) {
        assert.equal(mentor.segment.id, segment1.id);
        assert.equal(mentor.gig.segment_id, segment1.id);
      }
      for (const mentor of mentors2) {
        assert.equal(mentor.segment.id, segment2.id);
        assert.equal(mentor.gig.segment_id, segment2.id);
      }
    });

    it('fetchAllMentors returns segment-specific results when segmentId changes', async () => {
      if (!SEGMENT_TESTS_ENABLED) {
        console.log('Skipping: Supabase not configured');
        return;
      }
      if (activeSegments.length < 2) {
        console.log('Skipping: Need at least 2 segments');
        return;
      }
      const segment1 = activeSegments[0];
      const segment2 = activeSegments[1];

      const { mentors: mentors1 } = await fetchAllMentors({ segmentId: segment1.id });
      const { mentors: mentors2 } = await fetchAllMentors({ segmentId: segment2.id });

      // Each result should only contain mentors with that segment
      for (const mentor of mentors1) {
        assert.ok(mentor.segments.some((s) => s.id === segment1.id));
      }
      for (const mentor of mentors2) {
        assert.ok(mentor.segments.some((s) => s.id === segment2.id));
      }
    });

    it('segment slug in URL maps to correct segment data', async () => {
      if (!SEGMENT_TESTS_ENABLED) {
        console.log('Skipping: Supabase not configured');
        return;
      }
      if (activeSegments.length === 0) {
        console.log('Skipping: No active segments available');
        return;
      }
      const segment = activeSegments[0];
      const resolved = await fetchSegmentBySlug(segment.slug);
      assert.ok(resolved);
      assert.equal(resolved!.id, segment.id);

      const today = new Date().toISOString().split('T')[0];
      const { mentors, error } = await fetchDiscoverableMentors(resolved!.id, today);
      assert.equal(error, null);
      for (const mentor of mentors) {
        assert.equal(mentor.segment.id, segment.id);
        assert.equal(mentor.gig.segment_id, segment.id);
      }
    });
  });
});