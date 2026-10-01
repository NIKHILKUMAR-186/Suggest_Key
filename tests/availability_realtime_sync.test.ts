/**
 * Realtime availability synchronisation.
 *
 * These are the regressions that made the seeker's mentor-detail page show
 * availability that did not match the mentor's actual configuration. Each test
 * pins one link in the chain:
 *
 *   database event -> useAvailabilitySync -> authoritative refetch -> slotEngine
 *
 * The slot engine is never bypassed: every expectation below is about what the
 * SINGLE authoritative generator returns for a given date, and about the
 * transport that decides when the page asks it again.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  generateMentorSlots,
  addDaysToDateString,
  getDateStringInTimezone,
  parseZonedDateTime,
} from '../src/lib/slotEngine';
import { isCalendarDate } from '../src/pages/seeker/SeekerMentorDetailPage';
import { mentorDetailPath } from '../src/lib/mentorNav';
import type { MentorAvailability, MentorAvailabilityException, Booking, SlotHold } from '../src/types/database';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const KOLKATA = 'Asia/Kolkata';
/** 2026-10-01 is a Thursday, 10-02 a Friday, 10-03 a Saturday. */
const THU = '2026-10-01';
const FRI = '2026-10-02';
const SAT = '2026-10-03';

function window_(dayOfWeek: number, start: string, end: string): MentorAvailability {
  return {
    id: `w-${dayOfWeek}-${start}`,
    mentor_id: 'mentor-1',
    day_of_week: dayOfWeek,
    start_time: start,
    end_time: end,
    timezone: KOLKATA,
    is_enabled: true,
    created_at: '',
    updated_at: '',
  };
}

const baseParams = {
  mentorId: 'mentor-1',
  gigId: 'gig-1',
  timezone: KOLKATA,
  durationMinutes: 60,
  bookings: [] as Booking[],
  slotHolds: [] as SlotHold[],
  currentUtcTime: new Date('2026-09-25T00:00:00.000Z'),
};

// ---------------------------------------------------------------------------
// A. Date-only handling: URL date === selected date === API date === engine date
// ---------------------------------------------------------------------------

describe('Selected date is a date-only value, never a shifted instant', () => {
  it('accepts a well-formed calendar day', () => {
    for (const d of [THU, FRI, SAT, '2026-02-28', '2028-02-29']) {
      assert.equal(isCalendarDate(d), true, d);
    }
  });

  it('rejects malformed and impossible values instead of coercing them', () => {
    for (const bad of [
      '',
      '2026-13-01',
      '2026-02-31',
      '2026-10-1',
      '10-01-2026',
      '2026/10/01',
      'Thu, 1 Oct 2026',
      '2026-10-01T00:00:00Z',
      'not-a-date',
    ]) {
      assert.equal(isCalendarDate(bad), false, bad);
    }
  });

  it('never builds a local-time Date from a date-only string', () => {
    // `new Date('2026-10-01')` is parsed as UTC midnight, so a browser west of
    // UTC renders it as the PREVIOUS day. Any code that formats a selected date
    // through a local-time Date is reintroducing that one-day shift. The only
    // `new Date` in the selected-date path is a UTC probe used for validation.
    const source = read('src/pages/seeker/SeekerMentorDetailPage.tsx');
    const guarded = source.indexOf('const selectedDate = isCalendarDate(paramDate) ? paramDate : today;');
    assert.ok(guarded > -1, 'selectedDate must be derived from the URL, not local state');

    const derived = source.slice(guarded, guarded + 400);
    assert.ok(
      !/new Date\(\s*paramDate\s*\)/.test(derived),
      'paramDate must not be fed to the Date constructor'
    );
  });

  it('round-trips a date-only value through the engine unchanged', () => {
    for (const d of [THU, FRI, SAT]) {
      // What the engine turns the local window time into, and the calendar day
      // that instant belongs to in the MENTOR's timezone.
      const noon = parseZonedDateTime(d, '12:00', KOLKATA);
      assert.equal(getDateStringInTimezone(noon, KOLKATA), d);
    }
  });

  it('keeps the mentor calendar day across the Kolkata midnight boundary', () => {
    // 23:59 IST on Oct 1 is 18:29Z, still Oct 1 in UTC. 00:01 IST on Oct 2 is
    // 18:31Z on Oct 1. The selected calendar day must not follow UTC.
    const lastMinute = parseZonedDateTime(THU, '23:59', KOLKATA);
    const firstMinute = parseZonedDateTime(FRI, '00:01', KOLKATA);
    assert.equal(getDateStringInTimezone(lastMinute, KOLKATA), THU);
    assert.equal(getDateStringInTimezone(firstMinute, KOLKATA), FRI);
    assert.ok(firstMinute.getTime() > lastMinute.getTime());
  });

  it('generates the weekday named by the date, not a fixed one', () => {
    const thu = generateMentorSlots({
      ...baseParams,
      dateStr: THU,
      recurringAvailability: [window_(4, '10:00', '12:00')],
      exceptions: [],
    });
    const sat = generateMentorSlots({
      ...baseParams,
      dateStr: SAT,
      recurringAvailability: [window_(6, '10:00', '12:00')],
      exceptions: [],
    });
    // Thursday's window must not produce slots on Saturday and vice versa.
    assert.equal(thu.filter((s) => s.is_available).length, 2);
    assert.equal(sat.filter((s) => s.is_available).length, 2);
    assert.equal(thu[0].local_start_time, '10:00');
    assert.equal(sat[0].local_start_time, '10:00');
  });

  it('keeps the selected date in the URL it was navigated to', () => {
    const path = mentorDetailPath({
      mentorId: 'mentor-1',
      segmentSlug: 'autism',
      gigId: 'gig-1',
      date: THU,
      origin: 'mentor-list',
      intent: 'book',
    });
    const url = new URLSearchParams(path.split('?')[1]);
    assert.equal(url.get('date'), THU);
    // ...and a malformed date never reaches the URL in the first place.
    assert.equal(mentorDetailPath({ mentorId: 'm', date: 'nope' }).includes('date='), false);
  });
});

// ---------------------------------------------------------------------------
// B. Gig duration: a window shorter than the gig cannot produce a slot
// ---------------------------------------------------------------------------

describe('Gig duration is enforced before a slot is generated', () => {
  it('produces no slot for a 10-minute window against a 60-minute gig', () => {
    const slots = generateMentorSlots({
      ...baseParams,
      dateStr: THU,
      recurringAvailability: [
        window_(4, '02:20', '02:30'),
        window_(4, '03:00', '03:10'),
        window_(4, '03:10', '03:20'),
      ],
      exceptions: [],
    });
    assert.equal(slots.length, 0);
  });

  it('produces exactly one slot for an exact-fit window', () => {
    const slots = generateMentorSlots({
      ...baseParams,
      dateStr: SAT,
      recurringAvailability: [window_(6, '10:00', '11:00')],
      exceptions: [],
    });
    const open = slots.filter((s) => s.is_available);
    assert.equal(open.length, 1);
    assert.equal(open[0].local_start_time, '10:00');
    assert.equal(open[0].local_end_time, '11:00');
  });

  it('produces two slots from a two-hour window', () => {
    const slots = generateMentorSlots({
      ...baseParams,
      dateStr: SAT,
      recurringAvailability: [window_(6, '10:00', '12:00')],
      exceptions: [],
    });
    assert.deepEqual(
      slots.filter((s) => s.is_available).map((s) => s.local_start_time),
      ['10:00', '11:00']
    );
  });

  it('adds slots when a second window is added, and drops them when removed', () => {
    const one = generateMentorSlots({
      ...baseParams,
      dateStr: SAT,
      recurringAvailability: [window_(6, '10:00', '11:00')],
      exceptions: [],
    });
    const two = generateMentorSlots({
      ...baseParams,
      dateStr: SAT,
      recurringAvailability: [window_(6, '10:00', '11:00'), window_(6, '16:00', '18:00')],
      exceptions: [],
    });
    const none = generateMentorSlots({
      ...baseParams,
      dateStr: SAT,
      recurringAvailability: [],
      exceptions: [],
    });
    assert.equal(one.filter((s) => s.is_available).length, 1);
    assert.equal(two.filter((s) => s.is_available).length, 3);
    assert.equal(none.length, 0);
  });

  it('respects a 30-minute gig on the same window a 60-minute gig cannot use', () => {
    const short = generateMentorSlots({
      ...baseParams,
      dateStr: THU,
      durationMinutes: 30,
      recurringAvailability: [window_(4, '02:20', '03:20')],
      exceptions: [],
    });
    assert.equal(short.filter((s) => s.is_available).length, 2);
  });
});

// ---------------------------------------------------------------------------
// C. Availability edits, exceptions, bookings and holds change the answer
// ---------------------------------------------------------------------------

describe('Every slot-engine input changes the authoritative answer', () => {
  it('A. enabling a previously disabled weekday adds slots', () => {
    const before = generateMentorSlots({
      ...baseParams,
      dateStr: FRI,
      recurringAvailability: [],
      exceptions: [],
    });
    const after = generateMentorSlots({
      ...baseParams,
      dateStr: FRI,
      recurringAvailability: [window_(5, '09:00', '12:00')],
      exceptions: [],
    });
    assert.equal(before.length, 0);
    assert.equal(after.filter((s) => s.is_available).length, 3);
  });

  it('B. disabling a weekday removes its slots', () => {
    const enabled = generateMentorSlots({
      ...baseParams,
      dateStr: FRI,
      recurringAvailability: [window_(5, '09:00', '12:00')],
      exceptions: [],
    });
    const disabled = generateMentorSlots({
      ...baseParams,
      dateStr: FRI,
      recurringAvailability: [{ ...window_(5, '09:00', '12:00'), is_enabled: false }],
      exceptions: [],
    });
    assert.ok(enabled.length > 0);
    assert.equal(disabled.length, 0);
  });

  it('C. editing a window replaces the old slots rather than adding to them', () => {
    const before = generateMentorSlots({
      ...baseParams,
      dateStr: FRI,
      recurringAvailability: [window_(5, '09:00', '12:00')],
      exceptions: [],
    });
    const after = generateMentorSlots({
      ...baseParams,
      dateStr: FRI,
      recurringAvailability: [window_(5, '10:00', '14:00')],
      exceptions: [],
    });
    assert.equal(before.filter((s) => s.is_available).length, 3);
    assert.equal(after.filter((s) => s.is_available).length, 4);
    // The old 09:00 start is gone, the new 10:00 start exists.
    assert.equal(after.some((s) => s.local_start_time === '09:00'), false);
    assert.equal(after.some((s) => s.local_start_time === '10:00'), true);
    assert.equal(after.some((s) => s.local_start_time === '13:00'), true);
  });

  it('D/E. an exception insert, update and delete each change the result', () => {
    const recurring = [window_(6, '10:00', '12:00')];
    const none: MentorAvailabilityException[] = [];

    const withHours: MentorAvailabilityException = {
      id: 'e1',
      mentor_id: 'mentor-1',
      exception_date: SAT,
      is_available: true,
      start_time: '14:00',
      end_time: '16:00',
      reason: null,
      created_at: '',
    };
    const closed: MentorAvailabilityException = { ...withHours, is_available: false, start_time: null, end_time: null };
    const shorter: MentorAvailabilityException = { ...withHours, id: 'e2', end_time: '15:00' };

    const starts = (exceptions: MentorAvailabilityException[]) =>
      generateMentorSlots({
        ...baseParams,
        dateStr: SAT,
        recurringAvailability: recurring,
        exceptions,
      })
        .filter((s) => s.is_available)
        .map((s) => s.local_start_time);

    // An exception CONSTRAINS that calendar day: where it carries hours, only
    // those hours are bookable, and where it does not, the day is closed.
    assert.deepEqual(starts(none), ['10:00', '11:00']); // recurring only
    assert.deepEqual(starts([withHours]), ['14:00', '15:00']); // exception INSERT
    assert.deepEqual(starts([shorter]), ['14:00']); // exception UPDATE shortens it
    assert.deepEqual(starts([closed]), []); // exception closes the whole day
    assert.deepEqual(starts(none), ['10:00', '11:00']); // exception DELETE restores it
  });

  it('G/H. a booking insert and cancel change availability on that date only', () => {
    const booking = (id: string, startTime: string, endTime: string, status: Booking['status']): Booking => ({
      id,
      booking_code: id.toUpperCase(),
      mentor_id: 'mentor-1',
      seeker_id: 'seeker-2',
      gig_id: 'gig-1',
      segment_id: 'seg-1',
      hold_id: null,
      start_time: startTime,
      end_time: endTime,
      seeker_timezone: KOLKATA,
      mentor_timezone: KOLKATA,
      amount_inr: 1000,
      status,
      meeting_url: null,
      actual_ended_at: null,
      ended_by_role: null,
      end_reason: null,
      cancellation_reason: null,
      created_at: '',
      updated_at: '',
    });

    // 10:00 IST == 04:30Z.
    const booked = booking('b1', `${SAT}T04:30:00.000Z`, `${SAT}T05:30:00.000Z`, 'CONFIRMED');
    const cancelled = { ...booked, status: 'CANCELLED' as const };

    const count = (bookings: Booking[], dateStr: string) =>
      generateMentorSlots({
        ...baseParams,
        dateStr,
        recurringAvailability: [window_(6, '10:00', '12:00')],
        exceptions: [],
        bookings,
      }).filter((s) => s.is_available).length;

    assert.equal(count([], SAT), 2);
    assert.equal(count([booked], SAT), 1); // INSERT consumes the 10:00 slot
    assert.equal(count([cancelled], SAT), 2); // CANCELLED releases it again
    assert.equal(count([booked], THU), 0); // a different date is unaffected
  });

  it('I/J. a hold blocks its slot, and only while it is still active', () => {
    const activeHold: SlotHold = {
      id: 'h1',
      mentor_id: 'mentor-1',
      seeker_id: 'seeker-2',
      gig_id: 'gig-1',
      start_time: `${SAT}T04:30:00.000Z`,
      end_time: `${SAT}T05:30:00.000Z`,
      status: 'ACTIVE',
      expires_at: '2026-09-25T00:05:00.000Z',
      created_at: '2026-09-25T00:00:00.000Z',
    };

    const count = (holds: SlotHold[], now: Date) =>
      generateMentorSlots({
        ...baseParams,
        dateStr: SAT,
        recurringAvailability: [window_(6, '10:00', '12:00')],
        exceptions: [],
        slotHolds: holds,
        currentUtcTime: now,
      }).filter((s) => s.is_available).length;

    assert.equal(count([], new Date('2026-09-25T00:00:00.000Z')), 2);
    // Another seeker's hold removes the slot immediately.
    assert.equal(count([activeHold], new Date('2026-09-25T00:00:00.000Z')), 1);
    // Once it expires the slot is bookable again, with no database write at all.
    assert.equal(count([activeHold], new Date('2026-09-25T00:06:00.000Z')), 2);
    // A released hold frees it too.
    assert.equal(
      count([{ ...activeHold, status: 'RELEASED' }], new Date('2026-09-25T00:00:00.000Z')),
      2
    );
  });
});

// ---------------------------------------------------------------------------
// D. The transport: which triggers must exist, and what they must cover
// ---------------------------------------------------------------------------

describe('useAvailabilitySync subscribes to every slot-engine input', () => {
  const source = read('src/hooks/useAvailabilitySync.ts');

  it('watches exactly the five tables the engine reads', () => {
    for (const table of [
      'mentor_availability',
      'mentor_availability_exceptions',
      'bookings',
      'slot_holds',
      'gigs',
    ]) {
      assert.ok(source.includes(`'${table}'`), `must watch ${table}`);
    }
  });

  it('listens for INSERT, UPDATE and DELETE, not just INSERT', () => {
    assert.ok(
      source.includes("event: '*'"),
      "must use event: '*' so a DELETE is observed"
    );
  });

  it('scopes the subscription to the current mentor when one is given', () => {
    assert.ok(
      source.includes('mentor_id=eq.'),
      'a mentor-scoped page must filter by mentor_id'
    );
  });

  it('refetches rather than building slots from the realtime payload', () => {
    // The payload is a hint. The only thing the hook does with it is call
    // onInvalidate; nothing in the codebase may write slots from it.
    assert.ok(source.includes("notify(table)"));
    assert.ok(
      !/payload.*slots|generateMentorSlots|setSlots/.test(source),
      'the hook must never construct or patch a slot list'
    );
  });

  it('gives every channel instance a unique topic', () => {
    // `supabase.channel(topic)` reuses an existing channel with the same topic,
    // which under StrictMode hands the remount a half-unsubscribed channel.
    assert.ok(source.includes('channelSequence'), 'topics must be unique per instance');
    assert.ok(source.includes('removeChannel'));
  });

  it('refetches authoritatively after a reconnect', () => {
    assert.ok(
      source.includes("status === 'SUBSCRIBED'"),
      'a re-join must trigger a refetch'
    );
    assert.ok(source.includes('RECONNECT'));
  });

  it('keeps polling as a visibility-gated fallback', () => {
    assert.ok(source.includes('setInterval'), 'the fallback interval must remain');
    assert.ok(
      source.includes("document.visibilityState === 'hidden'"),
      'a hidden tab must not poll'
    );
  });

  it('revises on focus, visibility, network and back/forward cache restore', () => {
    for (const evt of ['visibilitychange', 'focus', 'online', 'pageshow']) {
      assert.ok(source.includes(`'${evt}'`), `must revalidate on ${evt}`);
    }
  });

  it('cleans up every listener and the channel on unmount', () => {
    for (const evt of ['visibilitychange', 'focus', 'online', 'pageshow']) {
      assert.ok(
        source.includes(`removeEventListener('${evt}'`),
        `must remove the ${evt} listener`
      );
    }
    assert.ok(source.includes('clearInterval'));
    assert.ok(source.includes('clearTimeout'));
  });

  it('logs only in development', () => {
    assert.ok(source.includes('import.meta.env?.DEV'), 'tracing must be dev-only');
    assert.ok(!/service_role|access_token|authorization/i.test(source), 'must never log credentials');
  });
});

// ---------------------------------------------------------------------------
// E. Every consumer that shows availability is actually wired up
// ---------------------------------------------------------------------------

describe('Every availability view subscribes to the shared sync', () => {
  it('mentor detail subscribes, mentor-scoped', () => {
    const source = read('src/pages/seeker/SeekerMentorDetailPage.tsx');
    assert.ok(source.includes('useAvailabilitySync'));
    assert.ok(source.includes('mentorId: paramMentorId || null'));
    assert.ok(source.includes('onInvalidate: reloadMentorSlots'));
  });

  it('mentor discovery subscribes through the same hook', () => {
    const source = read('src/pages/seeker/SeekerMentorListPage.tsx');
    assert.ok(source.includes('useAvailabilitySync'), 'discovery must subscribe');
    // A list spanning many mentors cannot be mentor-scoped.
    assert.ok(source.includes('mentorId: null'));
  });

  it('the segment landing page subscribes through the same hook', () => {
    const source = read('src/components/seeker/SegmentExperiencePage.tsx');
    assert.ok(source.includes('useAvailabilitySync'));
  });

  it('the mentor availability editor subscribes', () => {
    const source = read('src/pages/mentor/MentorAvailabilityPage.tsx');
    assert.ok(source.includes('useAvailabilitySync'));
  });

  it('there is exactly one sync hook and one slot engine', () => {
    // A second realtime system or a second slot generator is the regression this
    // whole file exists to prevent.
    const detail = read('src/pages/seeker/SeekerMentorDetailPage.tsx');
    assert.ok(!/supabase\.channel\(/.test(detail), 'detail must not open its own channel');
    assert.ok(!/generateMentorSlots/.test(detail), 'detail must not generate slots');
    assert.ok(!/calculateAvailableTimes/.test(detail));
  });
});

// ---------------------------------------------------------------------------
// F. Stale-data prevention on the page
// ---------------------------------------------------------------------------

describe('A date change never leaves the previous date visible', () => {
  const source = read('src/pages/seeker/SeekerMentorDetailPage.tsx');

  it('clears the slot list as soon as a new date is chosen', () => {
    const handler = source.slice(source.indexOf('const handleSelectDate'), source.indexOf('const handleSelectDate') + 1400);
    assert.ok(
      /available_slots: \[\], all_slots: \[\]/.test(handler),
      'the panel must be emptied, not left showing the old day'
    );
    assert.ok(handler.includes('setSelectedSlot(null)'));
  });

  it('writes the chosen date back to the URL', () => {
    const handler = source.slice(source.indexOf('const handleSelectDate'), source.indexOf('const handleSelectDate') + 1400);
    assert.ok(handler.includes('mentorDetailPath'), 'the URL must carry the new date');
    assert.ok(handler.includes('replace('), 'and be replaced, not pushed');
  });

  it('discards a slow response for a superseded date', () => {
    assert.ok(source.includes('requestSeq'), 'a request sequence guard is required');
    assert.ok(
      source.includes('if (seq !== requestSeq.current) return;'),
      'an outdated response must be dropped, not painted'
    );
  });

  it('distinguishes a refresh from a first load', () => {
    assert.ok(
      source.includes('isRefreshing'),
      'a background refetch must not look like a page load'
    );
    assert.ok(source.includes('Updating availability'), 'a subtle refresh state is required');
  });
});

// ---------------------------------------------------------------------------
// G. Server stays authoritative, and the response is never cached
// ---------------------------------------------------------------------------

describe('The slots endpoint is authoritative and uncached', () => {
  const source = read('server.ts');

  it('is not cacheable by the browser or a proxy', () => {
    const route = source.indexOf("app.get('/api/mentor-availability/slots'");
    assert.ok(route > -1);
    const block = source.slice(route, route + 900);
    assert.ok(
      /res\.set\(\s*'Cache-Control',\s*'no-store'\s*\)/.test(block),
      'bookable slots must not be cached'
    );
  });

  it('recomputes slots from the engine on every read', () => {
    assert.ok(source.includes('computeMentorSlotsForDate'), 'the read path must call the engine');
  });

  it('filters holds to ACTIVE and unexpired', () => {
    const engine = source.slice(source.indexOf('async function computeMentorSlotsForDate'));
    assert.ok(engine.includes(".eq('status', 'ACTIVE')"));
    assert.ok(engine.includes(".gt('expires_at', nowIso)"));
  });

  it('excludes cancelled and rejected bookings', () => {
    const engine = source.slice(source.indexOf('async function computeMentorSlotsForDate'));
    assert.ok(engine.includes('CANCELLED'));
    assert.ok(engine.includes('REJECTED'));
  });

  it('never trusts a client-supplied duration', () => {
    const engine = source.slice(source.indexOf('async function computeMentorSlotsForDate'));
    assert.ok(
      engine.includes('durationMinutes: gig.duration_minutes'),
      'duration must come from the gig row, not the request'
    );
  });
});

// ---------------------------------------------------------------------------
// H. Security: realtime must not weaken RLS
// ---------------------------------------------------------------------------

describe('Realtime introduces no security regression', () => {
  const sync = read('src/hooks/useAvailabilitySync.ts');
  const client = read('src/lib/supabase.ts');
  const server = read('server.ts');

  it('uses only the public anon client in the browser', () => {
    assert.ok(client.includes('VITE_SUPABASE_ANON_KEY'));
    assert.ok(!client.includes('SERVICE_ROLE'), 'the browser bundle must never see a service-role key');
  });

  it('never sends a service-role key to the browser from the API', () => {
    const json = JSON.stringify(read('src/App.tsx'));
    assert.ok(!json.includes('service_role'));
  });

  it('keeps slot reads behind authentication', () => {
    const route = server.indexOf("app.get('/api/mentor-availability/slots'");
    assert.ok(server.slice(route, route + 200).includes('requireAuth'));
  });

  it('does not ship RLS changes in this fix', () => {
    // Availability synchronisation must be solved by refetching authoritative
    // data, never by making a table world-readable.
    const syncSource = sync;
    assert.ok(!/service_role/i.test(syncSource));
    assert.ok(!/disable rls|drop policy/i.test(syncSource));
  });
});

// ---------------------------------------------------------------------------
// I. RLS still permits the intended seeker-side reads
// ---------------------------------------------------------------------------

describe('RLS policies allow a seeker to read public availability only', () => {
  // Phase 4 originally allowed an unconditional read; phase 14 replaced it. This
  // asserts the EFFECTIVE policy (the later migration wins) rather than the
  // permissive first definition.
  const schema = read('supabase/migrations/20260920000001_phase4_mvp_schema.sql');
  const tightening = read('supabase/migrations/20260926000000_phase14_admin_mentor_control.sql');

  it('keeps RLS enabled on mentor availability', () => {
    assert.ok(
      /ALTER TABLE public\.mentor_availability ENABLE ROW LEVEL SECURITY/i.test(schema),
      'mentor_availability must keep RLS enabled'
    );
  });

  it('scopes a seeker availability read to a publicly visible mentor', () => {
    assert.ok(
      /CREATE POLICY "Anyone can view mentor availability rules"[\s\S]*?ON public\.mentor_availability FOR SELECT[\s\S]*?mentor_is_publicly_visible\(mentor_id\)/.test(
        tightening
      ),
      'a seeker may read only a publicly visible mentor availability'
    );
    // The unconditional read this replaced must not have survived anywhere.
    assert.ok(
      !/ON public\.mentor_availability FOR SELECT\s*\n?\s*USING \(TRUE\)/.test(tightening),
      'the world-readable policy must have been replaced'
    );
  });

  it('leaves slot_holds and bookings participant-scoped', () => {
    // Another seeker hold is deliberately not readable. That tab learns about it
    // from the hold-expiry boundary and the polling fallback instead, and the
    // server still re-validates at booking time, so no security is relaxed.
    for (const table of ['slot_holds', 'bookings']) {
      assert.ok(
        new RegExp(
          `ON public\\.${table} FOR SELECT[\\s\\S]{0,200}seeker_id = auth\\.uid\\(\\)[\\s\\S]{0,120}mentor_id = auth\\.uid\\(\\)`
        ).test(schema),
        `${table} must stay participant-scoped`
      );
    }
  });
});
