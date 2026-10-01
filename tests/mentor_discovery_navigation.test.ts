/**
 * MENTOR DISCOVERY NAVIGATION.
 *
 * The one regression this file guards: Back from mentor detail must return to
 * the discovery context the seeker actually came from, not to a hardcoded list.
 * The origin travels in the URL, so it survives a refresh and a shared link, and
 * it is whitelisted so a hand-edited `source` can never redirect a seeker off
 * the app.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  isKnownMentorOrigin,
  mentorDetailBackPath,
  mentorDetailPath,
  mentorListPath,
  mentorProfilePath,
  parseMentorOrigin,
  segmentLandingPath,
} from '../src/lib/mentorNav';

describe('the origin is a whitelisted keyword, never a URL', () => {
  it('accepts only the two internal origins', () => {
    assert.equal(parseMentorOrigin('segment'), 'segment');
    assert.equal(parseMentorOrigin('mentor-list'), 'mentor-list');
    assert.equal(parseMentorOrigin('mentors'), 'mentor-list', 'legacy alias');
  });

  it('rejects anything else, including a crafted return target', () => {
    for (const hostile of [
      null,
      '',
      'https://evil.example',
      '//evil.example',
      '/seeker?segment=autism',
      '../../admin',
      'SEGMENT',
    ]) {
      assert.equal(parseMentorOrigin(hostile as string | null), null, `${hostile} must not parse`);
      assert.equal(isKnownMentorOrigin(hostile as string | null), false);
    }
  });
});

describe('Back is contextual', () => {
  it('a mentor opened from the segment landing page returns to that landing page', () => {
    assert.equal(
      mentorDetailBackPath({
        origin: 'segment',
        discovery: { segmentSlug: 'autism-mentor', topic: 'diagnosis', date: '2026-10-01' },
      }),
      '/seeker?segment=autism-mentor&topic=diagnosis&date=2026-10-01',
    );
  });

  it('a mentor opened from discovery returns to discovery', () => {
    assert.equal(
      mentorDetailBackPath({
        origin: 'mentor-list',
        discovery: { segmentSlug: 'autism-mentor', date: '2026-10-01' },
      }),
      '/seeker/mentors?segmentSlug=autism-mentor&date=2026-10-01',
    );
  });

  it('a direct link with no origin falls back to discovery, never to a segment', () => {
    assert.equal(
      mentorDetailBackPath({ discovery: { segmentSlug: 'autism-mentor' } }),
      '/seeker/mentors?segmentSlug=autism-mentor',
    );
    assert.equal(mentorDetailBackPath({}), '/seeker/mentors');
    // A `segment` origin without a segment it can name is not actionable.
    assert.equal(mentorDetailBackPath({ origin: 'segment' }), '/seeker/mentors');
  });

  it('an unusable slug is dropped rather than interpolated', () => {
    assert.equal(
      mentorDetailBackPath({
        origin: 'segment',
        discovery: { segmentSlug: 'autism mentor/../admin' },
      }),
      '/seeker/mentors',
    );
  });
});

describe('discovery state survives the round trip', () => {
  it('the detail URL carries the origin, segment and date', () => {
    const path = mentorDetailPath({
      mentorId: 'm-1',
      segmentSlug: 'autism-mentor',
      date: '2026-10-01',
      origin: 'segment',
    });
    assert.equal(
      path,
      '/seeker/mentor-detail?mentorId=m-1&segmentSlug=autism-mentor&date=2026-10-01&source=segment',
    );
    const params = new URLSearchParams(path.split('?')[1]);
    assert.equal(params.get('source'), 'segment');
  });

  it('an unknown date is dropped rather than sent to the API', () => {
    const params = new URLSearchParams(
      mentorDetailPath({ mentorId: 'm-1', date: 'tomorrow' }).split('?')[1],
    );
    assert.equal(params.get('date'), null);
  });

  it('the segment landing path keeps the topic, and omits "all"', () => {
    assert.equal(segmentLandingPath({ segmentSlug: 'career-mentor' }), '/seeker?segment=career-mentor');
    assert.equal(
      segmentLandingPath({ segmentSlug: 'career-mentor', topic: 'all' }),
      '/seeker?segment=career-mentor',
    );
    assert.equal(segmentLandingPath(), '/seeker');
  });

  it('the list path stays the canonical discovery route', () => {
    assert.equal(mentorListPath({}), '/seeker/mentors');
    assert.equal(
      mentorListPath({ segmentSlug: 'autism-mentor', date: '2026-10-01' }),
      '/seeker/mentors?segmentSlug=autism-mentor&date=2026-10-01',
    );
  });
});

// ---------------------------------------------------------------------------
// The public profile is a different route, and Back is shared with detail.
// ---------------------------------------------------------------------------

describe('the public profile is its own route, with the same Back contract', () => {
  it('View profile and Book a session are two different routes', () => {
    const profile = mentorProfilePath({ mentorId: 'm-1', segmentSlug: 'autism-mentor' });
    const book = mentorDetailPath({
      mentorId: 'm-1',
      segmentSlug: 'autism-mentor',
      gigId: 'g-1',
      intent: 'book',
    });
    assert.equal(
      profile.split('?')[0],
      '/seeker/mentor-profile',
    );
    assert.equal(book.split('?')[0], '/seeker/mentor-detail');
  });

  it('the profile carries the origin and segment so Back is contextual', () => {
    const path = mentorProfilePath({
      mentorId: 'm-1',
      segmentSlug: 'autism-mentor',
      date: '2026-10-01',
      topic: 'diagnosis',
      origin: 'segment',
    });
    assert.equal(
      path,
      '/seeker/mentor-profile?mentorId=m-1&segmentSlug=autism-mentor&date=2026-10-01&topic=diagnosis&source=segment',
    );
    // Back is the SAME helper detail uses, so both pages return to the segment
    // landing page rather than to a hardcoded mentor list.
    assert.equal(
      mentorDetailBackPath({
        origin: 'segment',
        discovery: { segmentSlug: 'autism-mentor', topic: 'diagnosis', date: '2026-10-01' },
      }),
      '/seeker?segment=autism-mentor&topic=diagnosis&date=2026-10-01',
    );
  });

  it('the profile URL names no gig and no booking intent', () => {
    // The page lists every active offer, so a gigId would misdescribe it, and
    // an intent would put a booking affordance on a read-only page. Even when
    // the caller has a gig in hand, `mentorProfilePath` has no parameter to
    // pass it, which is the guarantee rather than a convention.
    const params = new URLSearchParams(mentorProfilePath({ mentorId: 'm-1' }).split('?')[1]);
    assert.equal(params.get('gigId'), null);
    assert.equal(params.get('intent'), null);
    assert.equal(
      /gigId\?:/.test(
        readFileSync(join(import.meta.dirname, '..', 'src/lib/mentorNav.ts'), 'utf8').slice(
          readFileSync(join(import.meta.dirname, '..', 'src/lib/mentorNav.ts'), 'utf8').indexOf(
            'export function mentorProfilePath'
          )
        )
      ),
      false,
      'mentorProfilePath must not accept a gigId at all',
    );
  });

  it('an unusable segment slug is dropped rather than interpolated', () => {
    assert.equal(
      mentorProfilePath({ mentorId: 'm-1', segmentSlug: 'autism mentor/../admin' }),
      '/seeker/mentor-profile?mentorId=m-1',
    );
  });
});