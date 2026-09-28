import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  POSTGREST_RELATIONSHIPS,
  embedWithRelationship,
} from '../src/lib/postgrestRelationships';
import {
  MENTOR_APPLICATION_STATUSES,
  buildMentorApplicationPagination,
  buildProfileSearchFilter,
  emptyMentorApplicationStatusCounts,
  parseMentorApplicationListQuery,
  parseMentorApplicationStatusFilter,
  sanitizeMentorApplicationSearch,
} from '../src/lib/mentorApplicationsQuery';
import {
  describeSupabaseError,
  resolveHttpStatusForSupabaseError,
} from '../src/lib/supabaseErrors';

describe('PostgREST relationship hints', () => {
  it('names the applicant FK, not the reviewing-admin FK', () => {
    // Audited against the live schema: mentor_applications has two FKs to profiles.
    assert.equal(POSTGREST_RELATIONSHIPS.mentorApplicationApplicant, 'mentor_applications_user_id_fkey');
    assert.equal(POSTGREST_RELATIONSHIPS.mentorApplicationReviewer, 'mentor_applications_reviewed_by_fkey');
    assert.notEqual(
      POSTGREST_RELATIONSHIPS.mentorApplicationApplicant,
      POSTGREST_RELATIONSHIPS.mentorApplicationReviewer,
    );
  });

  it('builds an explicit embed expression', () => {
    const embed = embedWithRelationship(
      'profile',
      'profiles',
      POSTGREST_RELATIONSHIPS.mentorApplicationApplicant,
      'id, full_name, email',
    );
    assert.equal(embed, 'profile:profiles!mentor_applications_user_id_fkey(id, full_name, email)');
  });
});

describe('Mentor application list query parsing', () => {
  it('applies safe defaults', () => {
    const parsed = parseMentorApplicationListQuery(undefined);
    assert.equal(parsed.status, 'ALL');
    assert.equal(parsed.search, '');
    assert.equal(parsed.page, 1);
    assert.equal(parsed.pageSize, 20);
    assert.equal(parsed.from, 0);
    assert.equal(parsed.to, 19);
  });

  it('parses status, search, page and pageSize', () => {
    const parsed = parseMentorApplicationListQuery({
      status: 'pending_review',
      search: '  Nikhil  ',
      page: '3',
      pageSize: '10',
    });
    assert.equal(parsed.status, 'pending_review');
    assert.equal(parsed.search, 'Nikhil');
    assert.equal(parsed.page, 3);
    assert.equal(parsed.pageSize, 10);
    assert.equal(parsed.from, 20);
    assert.equal(parsed.to, 29);
  });

  it('falls back to ALL for an unknown status', () => {
    assert.equal(parseMentorApplicationStatusFilter('not-a-status'), 'ALL');
    assert.equal(parseMentorApplicationListQuery({ status: 'deleted' }).status, 'ALL');
    for (const status of MENTOR_APPLICATION_STATUSES) {
      assert.equal(parseMentorApplicationStatusFilter(status), status);
    }
  });

  it('bounds page and pageSize', () => {
    const tooBig = parseMentorApplicationListQuery({ page: '999999', pageSize: '5000' });
    assert.equal(tooBig.pageSize, 100);

describe('Server-side applicant search term', () => {
  it('strips PostgREST filter metacharacters', () => {
    const cleaned = sanitizeMentorApplicationSearch('a,b(c)*d%e\\f\'g"h');
    assert.ok(!/[,()*%\\'"]/.test(cleaned), `unexpected metacharacters in "${cleaned}"`);
    assert.equal(cleaned, 'a b c d e f g h');
  });

  it('caps the term length and ignores non strings', () => {
    assert.equal(sanitizeMentorApplicationSearch('x'.repeat(500)).length, 120);
    assert.equal(sanitizeMentorApplicationSearch(undefined), '');
    assert.equal(sanitizeMentorApplicationSearch(42), '');
  });

  it('builds the profile or-filter for name and email', () => {
    assert.equal(buildProfileSearchFilter('Nikhil'), 'full_name.ilike.*Nikhil*,email.ilike.*Nikhil*');
  });
});

describe('Mentor application pagination metadata', () => {
  it('computes totals and navigation flags', () => {
    const first = buildMentorApplicationPagination(1, 20, 45);
    assert.deepEqual(first, {
      page: 1,
      pageSize: 20,
      total: 45,
      totalPages: 3,
      hasPrevious: false,
      hasNext: true,
    });

    const last = buildMentorApplicationPagination(3, 20, 45);
    assert.equal(last.hasPrevious, true);
    assert.equal(last.hasNext, false);
  });

  it('handles an empty result set', () => {
    const empty = buildMentorApplicationPagination(1, 20, 0);
    assert.equal(empty.totalPages, 1);
    assert.equal(empty.hasNext, false);
    assert.deepEqual(emptyMentorApplicationStatusCounts(), {
      all: 0,
      draft: 0,
      pending_review: 0,
      approved: 0,
      rejected: 0,
    });
  });
});

describe('Supabase error diagnostics', () => {
  it('recognises the PGRST201 relationship ambiguity error', () => {
    const info = describeSupabaseError({
      code: 'PGRST201',
      message: "Could not embed because more than one relationship was found for 'mentor_applications' and 'profiles'",
      details: [{ relationship: 'mentor_applications_reviewed_by_fkey' }],
      hint: "Try changing 'profiles' to one of the following: 'profiles!mentor_applications_user_id_fkey'",
    });

    assert.equal(info.code, 'PGRST201');
    assert.equal(info.isRelationshipAmbiguity, true);
    assert.match(info.message, /more than one relationship/i);
    assert.equal(resolveHttpStatusForSupabaseError(info), 500);
  });

  it('maps common Postgres codes onto HTTP statuses', () => {
    assert.equal(resolveHttpStatusForSupabaseError(describeSupabaseError({ code: '23505', message: 'dup' })), 409);
    assert.equal(resolveHttpStatusForSupabaseError(describeSupabaseError({ code: '22P02', message: 'bad uuid' })), 400);
    assert.equal(resolveHttpStatusForSupabaseError(describeSupabaseError({ code: 'PGRST116', message: 'no rows' })), 404);
    assert.equal(resolveHttpStatusForSupabaseError(describeSupabaseError(new Error('boom'))), 500);
  });

  it('extracts messages without leaking extra fields', () => {
    const info = describeSupabaseError(new Error('plain failure'));
    assert.equal(info.code, 'UNKNOWN_ERROR');
    assert.equal(info.message, 'plain failure');
    assert.equal(info.isRelationshipAmbiguity, false);
  });
});

    assert.ok(tooBig.page <= 10000);

    const invalid = parseMentorApplicationListQuery({ page: '0', pageSize: '-4' });
    assert.equal(invalid.page, 1);
    assert.equal(invalid.pageSize, 20);
  });
});
