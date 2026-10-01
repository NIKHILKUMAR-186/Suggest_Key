/**
 * Support Center: domain rules and the security posture of the API surface.
 *
 * Two halves, deliberately mixed because they check the same invariants from
 * both ends:
 *
 *   1. The pure domain module - status transitions, the replyable/reopenable
 *      rules, category allow-lists, filename sanitising, formatting.
 *
 *   2. Source-level assertions on the migration, the routes and the request
 *      schemas. These are the load-bearing ones: they fail the build if someone
 *      adds an `is_internal`, `requesterId` or `userId` field to a public body,
 *      or if a support table ever grows a direct write policy.
 *
 * The style matches `route_contract.test.ts` and `rls_coverage_regression.test.ts`
 * in this repo: these are invariants about source and schema, so they are
 * asserted against source and schema, not by mocking a database.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { z } from 'zod';

import {
  BOOKING_CODE_PATTERN,
  DEFAULT_TICKET_PRIORITY,
  SUPPORT_ATTACHMENT_BUCKET,
  SUPPORT_ATTACHMENT_MIME_TYPES,
  SUPPORT_STATUS_TRANSITIONS,
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
  buildSupportAttachmentPath,
  canTransitionSupportStatus,
  formatInr,
  humaniseToken,
  isCategoryAllowedForRole,
  isSupportTicketReplyable,
  isSupportTicketReopenable,
  isValidBookingCode,
  relativeTime,
  sanitiseSupportFileName,
  supportCategoryLabel,
  supportNotificationCopy,
  supportPriorityPresentation,
  supportStatusPresentation,
} from '../src/lib/supportDomain';

const ROOT = process.cwd();
/** CRLF-normalised, so a `\n` in a pattern matches this repo's checked-out files. */
const read = (file: string): string =>
  readFileSync(resolve(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION = 'supabase/migrations/20261015000000_phase41_support_center.sql';
const SERVER = read('server.ts');
const ROUTER = read('src/routes/Router.tsx');
const VALIDATION = read('src/lib/validation.ts');
const SUPPORT_MIGRATION = read(MIGRATION);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(resolve(ROOT, dir))) {
    const full = join(dir, entry);
    if (statSync(resolve(ROOT, full)).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full);
  }
  return out;
}
/**
 * Strips block and line comments from a source block.
 *
 * Several assertions below are "this identifier must not appear in the support
 * routes". Without stripping comments they would all fail on the prose that
 * explains WHY those identifiers are dangerous, which is exactly where the word
 * belongs.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}

/**
 * Strips SQL `--` comments as well.
 *
 * The migration explains several rules in prose, and one of those rules ("do not
 * use auth.uid() here, the service role has none") is written in exactly the
 * identifier the assertion forbids. Comments are the right place for that
 * sentence, so they are removed before the code is asserted on.
 */
function stripSqlComments(source: string): string {
  return stripComments(source).replace(/^[ \t]*--.*$/gm, ' ');
}

const SUPPORT_MIGRATION_CODE = stripSqlComments(SUPPORT_MIGRATION);

/** The whole phase 41 route block, with comments removed. */
function supportRouteCode(): string {
  const start = SERVER.indexOf('Phase 41: Support Center');
  const end = SERVER.indexOf('Phase 11: In-App Notifications');
  assert.ok(start > -1 && end > start, 'the phase 41 support route block is missing from server.ts');
  return stripComments(SERVER.slice(start, end));
}

/** The body of one `apiSchemas` entry, so a test can assert on its shape alone. */
function schemaSource(name: string): string {
  const start = VALIDATION.indexOf(`${name}: z`);
  assert.ok(start > -1, `validation.ts has no ${name} schema`);
  // `strictObject({` ... the matching `}),` at the same indentation.
  const end = VALIDATION.indexOf('\n  }),', start);
  return VALIDATION.slice(start, end === -1 ? start + 1500 : end);
}

// ===========================================================================
// Domain: status workflow
// ===========================================================================

describe('support status workflow', () => {
  it('covers exactly the five stored statuses', () => {
    assert.deepEqual([...SUPPORT_TICKET_STATUSES], [
      'OPEN',
      'IN_PROGRESS',
      'WAITING_FOR_USER',
      'RESOLVED',
      'CLOSED',
    ]);
  });

  it('matches the CHECK constraint in the migration', () => {
    assert.match(
      SUPPORT_MIGRATION,
      /status IN \('OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'\)/,
      'the CHECK constraint and the TypeScript union must list the same statuses',
    );
  });

  it('matches the SQL transition table exactly, so the UI cannot offer a move the database refuses', () => {
    const block = SUPPORT_MIGRATION.slice(
      SUPPORT_MIGRATION.indexOf('is_valid_support_transition'),
      SUPPORT_MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.is_support_ticket_replyable'),
    );

    for (const [from, targets] of Object.entries(SUPPORT_STATUS_TRANSITIONS)) {
      assert.ok(
        block.includes(`WHEN '${from}'`),
        `the SQL transition function has no branch for ${from}`,
      );
      for (const target of targets) {
        assert.ok(
          block.includes(`'${target}'`),
          `${from} -> ${target} is offered in TypeScript but missing from the SQL function`,
        );
      }
    }

    // CLOSED is terminal in both, and RESOLVED can be reopened.
    assert.deepEqual(SUPPORT_STATUS_TRANSITIONS.CLOSED, []);
    assert.ok(SUPPORT_STATUS_TRANSITIONS.RESOLVED.includes('OPEN'));
    assert.equal(canTransitionSupportStatus('CLOSED', 'OPEN'), false);
    assert.equal(canTransitionSupportStatus('RESOLVED', 'OPEN'), true);
  });

  it('a ticket is replyable while it is live, and not once it is resolved or closed', () => {
    for (const status of ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER']) {
      assert.equal(isSupportTicketReplyable(status), true, `${status} should accept a reply`);
    }
    for (const status of ['RESOLVED', 'CLOSED']) {
      assert.equal(isSupportTicketReplyable(status), false, `${status} must not accept a plain reply`);
    }
  });

  it('matches the SQL replyable predicate', () => {
    assert.match(
      SUPPORT_MIGRATION,
      /is_support_ticket_replyable[\s\S]*?SELECT p_status IN \('OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER'\)/,
      'the SQL replyable list and the TypeScript rule must agree',
    );
  });

  it('only a resolved ticket is reopenable; a closed one is not', () => {
    assert.equal(isSupportTicketReopenable('RESOLVED'), true);
    assert.equal(isSupportTicketReopenable('CLOSED'), false);
    assert.equal(isSupportTicketReopenable('OPEN'), false);
  });

  it('a user replying to WAITING_FOR_USER resumes the ticket', () => {
    // Mirrors add_support_message: only a non-admin reply moves the status.
    assert.match(
      SUPPORT_MIGRATION,
      /WHEN v_role <> 'admin' AND v_ticket\.status = 'WAITING_FOR_USER' THEN 'IN_PROGRESS'/,
      'a user reply to WAITING_FOR_USER must advance it to IN_PROGRESS',
    );
  });

  it('every status has a label and a glyph, so status is never colour-only', () => {
    for (const status of SUPPORT_TICKET_STATUSES) {
      const shown = supportStatusPresentation(status);
      assert.ok(shown.label.length > 0, `${status} has no label`);
      assert.ok(shown.icon.length > 0, `${status} has no glyph`);
    }
  });

  it('every priority has a label and a glyph', () => {
    for (const priority of SUPPORT_TICKET_PRIORITIES) {
      const shown = supportPriorityPresentation(priority);
      assert.ok(shown.label.length > 0);
      assert.ok(shown.icon.length > 0);
    }
  });

  it('an unknown token still renders as something readable rather than blank', () => {
    assert.equal(supportStatusPresentation('WAT').label, 'Wat');
    assert.equal(humaniseToken('WAITING_FOR_USER'), 'Waiting for user');
  });
});

// ===========================================================================
// Domain: categories
// ===========================================================================

describe('support categories are role-scoped', () => {
  it('gives each role exactly the categories the migration allows', () => {
    // These mirror the per-role allow-list inside create_support_ticket.
    assert.deepEqual([...SUPPORT_TICKET_CATEGORIES.seeker], [
      'BOOKING', 'PAYMENT', 'SESSION', 'MENTOR', 'ACCOUNT', 'TECHNICAL', 'OTHER',
    ]);
    assert.deepEqual([...SUPPORT_TICKET_CATEGORIES.mentor], [
      'BOOKING', 'AVAILABILITY', 'PAYMENT', 'SESSION', 'PROFILE', 'TECHNICAL', 'OTHER',
    ]);
    assert.deepEqual([...SUPPORT_TICKET_CATEGORIES.admin], [
      'USER', 'MENTOR', 'BOOKING', 'PAYMENT', 'SYSTEM', 'TECHNICAL', 'OTHER',
    ]);
  });

  it('the SQL allow-list agrees with the TypeScript lists', () => {
    for (const category of SUPPORT_TICKET_CATEGORIES.seeker) {
      assert.ok(
        SUPPORT_MIGRATION.includes(`'${category}'`),
        `the seeker allow-list in SQL is missing ${category}`,
      );
    }
    // AVAILABILITY is mentor-only: a seeker must not be able to raise one.
    assert.equal(isCategoryAllowedForRole('seeker', 'AVAILABILITY'), false);
    assert.equal(isCategoryAllowedForRole('mentor', 'AVAILABILITY'), true);
    // SYSTEM is admin-only.
    assert.equal(isCategoryAllowedForRole('seeker', 'SYSTEM'), false);
    assert.equal(isCategoryAllowedForRole('admin', 'SYSTEM'), true);
  });

  it('has a human label for every category any role can pick', () => {
    for (const list of Object.values(SUPPORT_TICKET_CATEGORIES)) {
      for (const category of list) {
        assert.notEqual(
          supportCategoryLabel(category),
          category,
          `${category} falls back to its raw value, so the UI would show a machine token`,
        );
      }
    }
  });
});

// ===========================================================================
// Domain: priority
// ===========================================================================

describe('ticket priority', () => {
  it('covers exactly the four stored levels', () => {
    assert.deepEqual([...SUPPORT_TICKET_PRIORITIES], ['LOW', 'NORMAL', 'HIGH', 'URGENT']);
  });

  it('a ticket always opens at NORMAL and only an admin can raise it', () => {
    assert.equal(DEFAULT_TICKET_PRIORITY, 'NORMAL');
    // create_support_ticket hard-codes the initial priority; there is no
    // p_priority parameter at all, so no client can choose one.
    assert.match(SUPPORT_MIGRATION, /'OPEN', 'NORMAL', v_booking\.id/);
    assert.equal(
      /p_priority/.test(SUPPORT_MIGRATION.slice(0, SUPPORT_MIGRATION.indexOf('create_support_ticket'))),
      false,
    );
    assert.ok(
      !/\bp_priority\b/.test(
        SUPPORT_MIGRATION.slice(
          SUPPORT_MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.create_support_ticket'),
          SUPPORT_MIGRATION.indexOf('add_support_message'),
        ),
      ),
      'create_support_ticket must not accept a priority argument',
    );
  });
});

// ===========================================================================
// Domain: attachments
// ===========================================================================

describe('attachment filenames and paths', () => {
  it('strips path separators, traversal and control characters', () => {
    assert.equal(sanitiseSupportFileName('../../etc/passwd'), 'passwd');
    assert.equal(sanitiseSupportFileName('a/b/c.png'), 'c.png');
    assert.equal(sanitiseSupportFileName('a\\b.png'), 'b.png');
    assert.equal(sanitiseSupportFileName('....'), 'attachment');
    assert.equal(sanitiseSupportFileName(''), 'attachment');
    assert.equal(sanitiseSupportFileName(null), 'attachment');
    assert.equal(sanitiseSupportFileName('screenshot (1).png'), 'screenshot__1_.png');
    assert.equal(
      sanitiseSupportFileName('evil .png'),
      'evil_.png',
      'a control character must not survive into the object key',
    );
  });

  it('puts the object key inside the ticket folder the server resolved', () => {
    const uuid = '11111111-2222-3333-4444-555555555555';
    assert.equal(
      buildSupportAttachmentPath(uuid, 'proof.png', 'abc12345'),
      `support/${uuid}/abc12345-proof.png`,
    );
  });

  it('produces a key that satisfies the database CHECK on storage_path', () => {
    const uuid = '11111111-2222-3333-4444-555555555555';
    const path = buildSupportAttachmentPath(uuid, '../evil.png', 'deadbeef');
    assert.match(path, /^support\/[0-9a-f-]{36}\/[0-9A-Za-z._-]+$/);
    assert.equal(path.includes('..'), false);
    assert.equal(path.includes('\\'), false);
  });

  it('the folder is the literal word "support", never a user id', () => {
    // No pre-existing "first folder = auth.uid()" storage rule can match an
    // attachment by accident.
    const uuid = '11111111-2222-3333-4444-555555555555';
    assert.ok(buildSupportAttachmentPath(uuid, 'a.png', 'x1').startsWith('support/'));
  });

  it('allows only images and PDFs, and never an executable', () => {
    assert.deepEqual([...SUPPORT_ATTACHMENT_MIME_TYPES], [
      'image/png',
      'image/jpeg',
      'image/webp',
      'application/pdf',
    ]);
    for (const forbidden of [
      'application/x-msdownload',
      'application/x-sh',
      'text/html',
      'application/zip',
      'application/javascript',
      'image/svg+xml',
    ]) {
      assert.equal(
        (SUPPORT_ATTACHMENT_MIME_TYPES as readonly string[]).includes(forbidden),
        false,
        `${forbidden} must not be an accepted attachment type`,
      );
    }
  });

  it('the bucket name matches the migration', () => {
    assert.equal(SUPPORT_ATTACHMENT_BUCKET, 'support-attachments');
    assert.ok(SUPPORT_MIGRATION.includes(`'${SUPPORT_ATTACHMENT_BUCKET}'`));
  });
});

// ===========================================================================
// Domain: formatting
// ===========================================================================

describe('support formatting', () => {
  it('relative time reads naturally and handles a missing value', () => {
    const now = new Date('2026-10-15T12:00:00.000Z');
    assert.equal(relativeTime('2026-10-15T11:59:30.000Z', now), 'just now');
    assert.equal(relativeTime('2026-10-15T11:55:00.000Z', now), '5 min ago');
    assert.equal(relativeTime('2026-10-15T09:00:00.000Z', now), '3 hr ago');
    assert.equal(relativeTime('2026-10-13T12:00:00.000Z', now), '2 days ago');
    assert.equal(relativeTime(null), '');
    assert.equal(relativeTime('not-a-date'), '');
  });

  it('formats money the way the rest of the payment UI does', () => {
    assert.equal(formatInr(1499), '₹1,499');
    assert.equal(formatInr(0), '₹0');
    assert.equal(formatInr(null), '₹0');
  });

  it('a booking code must be the human format, so a UUID cannot be pasted in', () => {
    assert.ok(BOOKING_CODE_PATTERN.test('BK-1234'));
    assert.ok(BOOKING_CODE_PATTERN.test('BK-SESSION-A1B2'));
    assert.equal(isValidBookingCode('11111111-2222-3333-4444-555555555555'), false);
    assert.equal(isValidBookingCode('booking 123'), false);
    assert.equal(isValidBookingCode('BK-'), false);
  });
});

// ===========================================================================
// Notification copy
// ===========================================================================

describe('support notification copy', () => {
  it('always names the ticket, so a notification is actionable on its own', () => {
    const events = [
      'SUPPORT_TICKET_CREATED',
      'SUPPORT_TICKET_REPLY',
      'SUPPORT_TICKET_WAITING_FOR_USER',
      'SUPPORT_TICKET_RESOLVED',
      'SUPPORT_TICKET_REOPENED',
      'SUPPORT_TICKET_ASSIGNED',
      'SUPPORT_REFUND_UPDATED',
    ] as const;

    for (const event of events) {
      const copy = supportNotificationCopy(event, { ticketCode: 'SK-20261015-000042' });
      assert.ok(copy.title.length > 0, `${event} has no title`);
      assert.ok(copy.message.length > 0, `${event} has no message`);
    }
  });

  it('folds the resolution into the RESOLVED copy', () => {
    const withText = supportNotificationCopy('SUPPORT_TICKET_RESOLVED', {
      ticketCode: 'SK-20261015-000042',
      resolution: 'Your refund has been confirmed.',
    });
    assert.match(withText.message, /Your refund has been confirmed\./);

    const withoutText = supportNotificationCopy('SUPPORT_TICKET_RESOLVED', {
      ticketCode: 'SK-20261015-000042',
    });
    assert.match(withoutText.message, /has been resolved/);
  });
});

// ===========================================================================
// Security: the request schemas refuse what a client must not set
// ===========================================================================

describe('a client cannot spoof a support field through the request schema', () => {
  it('creating a ticket accepts no actor, role, priority, status or payment field', () => {
    const block = schemaSource('supportTicketCreate');
    for (const forbidden of [
      'requesterId',
      'userId',
      'role',
      'requesterRole',
      'priority',
      'status',
      'assignedAdminId',
      'paymentId',
      'bookingId',
      'isInternal',
    ]) {
      assert.equal(
        new RegExp(`\\b${forbidden}\\b`).test(block),
        false,
        `supportTicketCreate must not accept ${forbidden}`,
      );
    }
  });

  it('a public reply accepts no is_internal field', () => {
    // This is the public/internal boundary. If `isInternal` ever appears here, a
    // user could write themselves an admin note.
    const block = schemaSource('supportMessageCreate');
    assert.equal(/isInternal|is_internal/i.test(block), false);
  });

  it('the internal-note schema is a separate endpoint with only a note field', () => {
    const block = schemaSource('supportInternalNote');
    assert.match(block, /note:/);
    assert.equal(/isInternal/.test(block), false);
    assert.equal(/requesterId|senderId/.test(block), false);
  });

  it('the admin update schema refuses RESOLVED, so a status field cannot close a ticket', () => {
    const block = schemaSource('supportAdminUpdate');
    assert.match(
      block,
      /status: z\.enum\(\['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'CLOSED'\]\)/,
      'RESOLVED must be absent from the PATCH schema; it has its own endpoint with a required message',
    );
    assert.equal(/resolution/.test(block), false);
    assert.equal(/requesterId/.test(block), false);
  });

  it('resolving requires a real resolution message', () => {
    const schema = z.object({});
    assert.ok(schema, 'placeholder');
    assert.match(schemaSource('supportResolve'), /resolution: text\(\{/);
    const parsed = (VALIDATION.match(/supportResolve: z\.strictObject\(\{[\s\S]*?\}\),/) ?? [''])[0];
    assert.ok(parsed.includes('resolution'), 'supportResolve must carry a resolution');
    // The RPC enforces the length floor independently.
    assert.match(SUPPORT_MIGRATION, /length\(v_text\) < 5 OR length\(v_text\) > 4000/);
  });

  it('every support body schema is strict, so an unknown key is a 400', () => {
    for (const name of [
      'supportTicketCreate',
      'supportMessageCreate',
      'supportInternalNote',
      'supportResolve',
      'supportReopen',
      'supportAttachmentCreate',
      'supportAdminUpdate',
    ]) {
      assert.match(
        schemaSource(name),
        /z\.strictObject\(/,
        `${name} must be a strictObject so an unrecognised key is rejected`,
      );
    }
  });

  it('the queue query accepts no user_id, so a list can never be widened', () => {
    const block = schemaSource('supportQueueQuery');
    assert.equal(/userId|user_id|requesterId/.test(block), false);
    assert.match(block, /scope: z\.enum\(\['USER', 'ADMIN'\]\)/);
  });
});

// ===========================================================================
// Security: the routes
// ===========================================================================

describe('support route authorization', () => {
  const route = (pattern: string): string => {
    const match = SERVER.match(pattern);
    assert.ok(match, `server.ts has no route matching ${pattern}`);
    return match[0];
  };

  it('every support route requires authentication', () => {
    const routes = SERVER.match(/app\.(get|post|patch)\(\s*'\/api\/support\/[^']*'/g) ?? [];
    assert.ok(routes.length >= 9, `expected the full support surface, found ${routes.length}`);

    for (const declaration of routes) {
      const after = SERVER.slice(SERVER.indexOf(declaration), SERVER.indexOf(declaration) + 400);
      assert.match(after, /requireAuth/, `${declaration} must require authentication`);
    }
  });

  it('only the admin operations are admin-gated', () => {
    const adminRoutes = [
      "app.patch(\n    '/api/support/tickets/:ticketCode'",
      "app.post(\n    '/api/support/tickets/:ticketCode/internal-notes'",
      "app.post(\n    '/api/support/tickets/:ticketCode/resolve'",
      "'/api/support/tickets/metrics'",
    ];
    for (const declaration of adminRoutes) {
      const start = SERVER.indexOf(declaration);
      assert.ok(start > -1, `server.ts has no ${declaration}`);
      const body = SERVER.slice(start, start + 500);
      assert.match(body, /requireAdmin/, `${declaration} must require the admin role`);
    }
  });

  it('the rest of the surface is reachable by any authenticated role', () => {
    // Reopen is the one exception that is intentionally NOT admin-gated: it is
    // the requester's own action on their own ticket.
    const start = SERVER.indexOf("app.post(\n    '/api/support/tickets/:ticketCode/reopen'");
    assert.ok(start > -1);
    const body = SERVER.slice(start, start + 500);
    assert.match(body, /requireAuth/);
    assert.equal(/requireAdmin/.test(body), false, 'reopen belongs to the requester, not an admin');
  });

  it('creating a ticket takes no role guard, because every authenticated role may raise one', () => {
    // A guard here would be wrong: seekers, mentors and admins all use it.
    // Authorization is instead "your own ticket", enforced inside the RPC.
    const start = SERVER.indexOf("app.post(\n    '/api/support/tickets',");
    assert.ok(start > -1, 'the create-ticket route is missing');
    const block = SERVER.slice(start, start + 700);
    assert.equal(/requireRole/.test(block), false);
    assert.match(block, /requireAuth/);
  });

  it('no support route takes an actor id from the body', () => {
    const block = supportRouteCode();
    // The only body fields any support handler reads are these.
    const allowed = new Set([
      'category', 'subject', 'message', 'bookingCode',
      'note', 'resolution', 'reason',
      'storagePath', 'fileName', 'mimeType', 'fileSize',
      'status', 'priority', 'assignedAdminId',
    ]);
    const destructured = [...block.matchAll(/const \{ ([^}]+) \} = req\.body/g)]
      .flatMap((m) => m[1].split(',').map((s) => s.trim().split(':')[0].trim()));
    for (const field of destructured) {
      assert.ok(allowed.has(field), `a support handler destructures ${field} from req.body`);
    }
    for (const forbidden of ['requesterId', 'userId', 'senderId', 'isInternal', 'paymentId']) {
      assert.equal(
        new RegExp(`\\b${forbidden}\\b`).test(block),
        false,
        `the support routes must never read ${forbidden} from the request`,
      );
    }
  });

  it('every support write routes through an RPC, never a direct table write', () => {
    const block = supportRouteCode();
    // A direct .insert()/.update() would bypass the ownership checks in the RPC.
    assert.equal(
      /\.from\('support_(tickets|messages|audit_events)'\)\s*\.\s*(insert|update|delete)/.test(block),
      false,
      'support writes must go through a SECURITY DEFINER RPC, not a direct table write',
    );
    assert.match(block, /admin\.rpc\('create_support_ticket'/);
    assert.match(block, /admin\.rpc\('add_support_message'/);
    assert.match(block, /admin\.rpc\('add_support_internal_note'/);
    assert.match(block, /admin\.rpc\('resolve_support_ticket'/);
    assert.match(block, /admin\.rpc\('reopen_support_ticket'/);
    assert.match(block, /admin\.rpc\('update_support_ticket'/);
  });

  it('the metrics literal route is registered before the parameterised ticket route', () => {
    // Express matches in registration order; the reverse order would make
    // /metrics unreachable, returning TICKET_NOT_FOUND forever.
    const metrics = SERVER.indexOf("'/api/support/tickets/metrics'");
    const parameterised = SERVER.indexOf("'/api/support/tickets/:ticketCode'");
    assert.ok(metrics > -1 && parameterised > -1);
    assert.ok(metrics < parameterised, 'the metrics route must be declared first');
  });

  it('reads a ticket through the RPC, never by filtering a table in the handler', () => {
    assert.match(SERVER, /admin\.rpc\('get_support_ticket'/);
    assert.equal(
      /from\('support_messages'\)/.test(supportRouteCode()),
      false,
      'reading messages in the handler would re-implement the internal-note filter',
    );
  });

  it('an attachment is served as a short-lived signed URL, never a path or a public link', () => {
    const block = supportRouteCode();
    assert.match(block, /createSignedUrl\(attachment\.storage_path, 300/);
    assert.equal(
      /publicUrl|getPublicUrl/.test(block),
      false,
      'a public URL would defeat the private bucket',
    );
    // The storage path must not be returned to the browser on the read path.
    const readRoute = block.slice(block.indexOf('createSignedUrl(attachment.storage_path'));
    assert.equal(
      /storage_path:/.test(readRoute.slice(0, readRoute.indexOf('return res.json'))),
      false,
      'the signed-URL response must not echo the storage path back to the client',
    );
  });

  it('the upload URL is minted by the server for a path the server generated', () => {
    const block = supportRouteCode();
    assert.match(block, /createSignedUploadUrl\(safeName\)/);
    assert.match(block, /buildSupportAttachmentPath\(ticket\.id, fileName, randomUUID\(\)/);
    // The client must never be able to name its own upload path.
    assert.equal(
      /createSignedUploadUrl\(\s*(?!safeName)/.test(block),
      false,
      'the upload path argument must be the server-generated variable',
    );
  });

  it('the upload URL is validated by a schema that has no storagePath', () => {
    // Step 1 (mint) and step 3 (record) are different shapes. If step 1 used
    // the record schema, the required storagePath would reject every request
    // and - worse - invite a client to name its own object key.
    const block = schemaSource('supportAttachmentUploadRequest');
    assert.equal(/storagePath/.test(block), false, 'the upload request must not accept a storagePath');
    for (const field of ['fileName', 'mimeType', 'fileSize']) {
      assert.ok(block.includes(field), `the upload request must carry ${field}`);
    }
    assert.match(block, /z\.strictObject\(/);

    // And the route must use that schema, not the record schema.
    const uploadStart = SERVER.indexOf("app.get(\n    '/api/support/tickets/:ticketCode/attachments/upload-url'");
    assert.ok(uploadStart > -1, 'the upload-url route is missing');
    assert.match(
      SERVER.slice(uploadStart, uploadStart + 300),
      /validateBody\(apiSchemas\.supportAttachmentUploadRequest\)/,
    );

    // The record schema is the only one that may accept the returned path.
    assert.match(schemaSource('supportAttachmentCreate'), /storagePath: idField/);
  });

  it('upload ownership is proved BEFORE a signed URL is minted', () => {
    const start = SERVER.indexOf("app.get(\n    '/api/support/tickets/:ticketCode/attachments/upload-url'");
    assert.ok(start > -1, 'the upload-url route is missing');
    const body = SERVER.slice(start, start + 3000);
    const mintAt = body.indexOf('createSignedUploadUrl');
    const ownershipAt = body.indexOf('FORBIDDEN_NOT_TICKET_OWNER');
    assert.ok(ownershipAt > -1, 'the upload route must check ticket ownership');
    assert.ok(mintAt > -1, 'the upload route must mint a signed URL');
    assert.ok(
      ownershipAt < mintAt,
      'ownership must be checked before a signed upload URL exists, or any code can get one',
    );
  });
});

// ===========================================================================
// Security: the migration
// ===========================================================================

describe('support tables are locked down in the database', () => {
  it('enables RLS on all four support tables', () => {
    for (const table of [
      'support_tickets',
      'support_messages',
      'support_attachments',
      'support_audit_events',
    ]) {
      assert.match(
        SUPPORT_MIGRATION,
        new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`),
        `RLS is not enabled on ${table}`,
      );
    }
  });

  it('gives no support table a direct INSERT, UPDATE or DELETE policy', () => {
    // A write policy would let a client bypass every check the RPCs perform. The
    // migration's own post-condition asserts this too; this is the regression net.
    //
    // Necessary but NOT sufficient: with only a SELECT policy, PostgreSQL still
    // applies it to UPDATE and DELETE. The privilege revoke is what actually
    // closes the direct-write path - see the test below.
    const policyBlocks = [...SUPPORT_MIGRATION.matchAll(
      /CREATE POLICY\s+"?([\w\s]+?)"?\s+ON\s+public\.(support_\w+)\s+(FOR\s+\w+)/gi,
    )];
    const expected = new Set([
      'support_tickets',
      'support_messages',
      'support_attachments',
      'support_audit_events',
    ]);
    for (const table of expected) {
      assert.ok(
        policyBlocks.some((m) => m[2] === table),
        `${table} has no read policy`,
      );
    }
    for (const [, name, table, command] of policyBlocks) {
      assert.match(
        command,
        /^FOR\s+SELECT$/i,
        `the policy on ${table} ("${name.trim()}") reads "${command}"; every support policy must be SELECT-only`,
      );
    }
  });

  it('a non-admin cannot read an internal note through any policy', () => {
    const policy = SUPPORT_MIGRATION.slice(
      SUPPORT_MIGRATION.indexOf('"Participants can view public support messages"'),
      SUPPORT_MIGRATION.indexOf('DROP POLICY IF EXISTS "Participants can view their own support attachments"'),
    );
    assert.match(policy, /is_internal = FALSE/, 'the policy itself must exclude internal rows');
    assert.match(policy, /is_admin\(\)/, 'the admin branch must be present');
    assert.equal(
      /is_internal\s*=\s*TRUE/.test(policy),
      false,
      'no policy may expose internal notes to a non-admin',
    );
  });

  it('audit events are admin-only', () => {
    const policy = SUPPORT_MIGRATION.slice(
      SUPPORT_MIGRATION.indexOf('"Admins can view support audit events"'),
    );
    assert.match(policy, /USING \(public\.is_admin\(\)\)/);
  });

  it('the attachment bucket is private and the migration fails closed if it is not', () => {
    assert.match(SUPPORT_MIGRATION, /'support-attachments',\s*'support-attachments',\s*FALSE/);
    assert.match(
      SUPPORT_MIGRATION,
      /support-attachments must be private/,
      'the migration must abort rather than finish with a public attachment bucket',
    );
  });

  it('anon cannot execute any support function, and the migration proves it', () => {
    for (const fn of [
      'create_support_ticket',
      'add_support_message',
      'add_support_internal_note',
      'update_support_ticket',
      'resolve_support_ticket',
      'reopen_support_ticket',
      'add_support_attachment',
      'get_support_ticket',
      'list_support_tickets',
      'support_ticket_metrics',
      'next_support_ticket_code',
    ]) {
      assert.match(
        SUPPORT_MIGRATION,
        new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\)\\s+FROM PUBLIC, anon, authenticated`),
        `EXECUTE on ${fn} is not revoked from anon`,
      );
      assert.match(
        SUPPORT_MIGRATION,
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\)\\s+TO service_role`),
        `${fn} is not granted to service_role`,
      );
    }
    assert.match(SUPPORT_MIGRATION, /PHASE-41 containment incomplete: anon can EXECUTE/);
  });

  it('every mutating RPC re-verifies the actor against user_roles', () => {
    const fns = [
      'create_support_ticket',
      'add_support_message',
      'add_support_internal_note',
      'update_support_ticket',
      'resolve_support_ticket',
      'reopen_support_ticket',
      'add_support_attachment',
    ];
    for (const fn of fns) {
      const start = SUPPORT_MIGRATION.indexOf(
        `CREATE OR REPLACE FUNCTION public.${fn}(`,
      );
      assert.ok(start > -1, `${fn} is missing`);
      const body = SUPPORT_MIGRATION.slice(start, SUPPORT_MIGRATION.indexOf('$$;', start));
      assert.match(
        body,
        /public\.has_role\(/,
        `${fn} trusts its actor argument without re-checking the role`,
      );
      assert.match(
        body,
        /auth\.uid\(\) IS NOT NULL AND auth\.uid\(\) <> p_\w+/,
        `${fn} must refuse a session that does not belong to the named actor`,
      );
    }
  });

  it('an admin-only RPC names its admin argument p_admin_id, so it cannot be confused', () => {
    for (const fn of ['add_support_internal_note', 'update_support_ticket', 'resolve_support_ticket']) {
      assert.match(
        SUPPORT_MIGRATION,
        new RegExp(`FUNCTION public\\.${fn}\\(\\s*p_ticket_code TEXT,\\s*p_admin_id UUID`),
        `${fn} must take the admin as p_admin_id`,
      );
      assert.match(
        SUPPORT_MIGRATION.slice(
          SUPPORT_MIGRATION.indexOf(`FUNCTION public.${fn}(`),
          SUPPORT_MIGRATION.indexOf('$$;', SUPPORT_MIGRATION.indexOf(`FUNCTION public.${fn}(`)),
        ),
        /NOT public\.has_role\(p_admin_id, 'admin'\)/,
        `${fn} must refuse a non-admin`,
      );
    }
  });

  it('the ticket code is generated by the database and constrained to its format', () => {
    assert.match(
      SUPPORT_MIGRATION,
      /ticket_code TEXT NOT NULL UNIQUE\s*\n\s*CHECK \(ticket_code ~ '\^SK-\[0-9\]\{8\}-\[0-9\]\{6\}\$'\)/,
    );
    assert.match(SUPPORT_MIGRATION, /CREATE SEQUENCE IF NOT EXISTS public\.support_ticket_code_seq/);
    assert.match(SUPPORT_MIGRATION, /nextval\('public\.support_ticket_code_seq'\)/);
    // No client may pass a code in: create_support_ticket has no code parameter.
    const create = SUPPORT_MIGRATION.slice(
      SUPPORT_MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.create_support_ticket('),
      SUPPORT_MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.add_support_message('),
    );
    assert.equal(/p_ticket_code/.test(create), false);
    assert.match(create, /v_code := public\.next_support_ticket_code\(\)/);
  });

  it('create_support_ticket takes no payment id, and derives one from the booking', () => {
    const create = SUPPORT_MIGRATION.slice(
      SUPPORT_MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.create_support_ticket('),
      SUPPORT_MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.add_support_message('),
    );
    assert.equal(/p_payment_id/.test(create), false);
    assert.match(
      create,
      /SELECT id INTO v_payment FROM public\.payments WHERE booking_id = v_booking\.id/,
      'the payment must be resolved from the booking, not accepted',
    );
  });

  it('booking linkage is ownership-checked per role', () => {
    assert.match(SUPPORT_MIGRATION, /v_role = 'seeker' AND v_booking\.seeker_id <> p_requester_id/);
    assert.match(SUPPORT_MIGRATION, /v_role = 'mentor' AND v_booking\.mentor_id <> p_requester_id/);
    assert.match(SUPPORT_MIGRATION, /FORBIDDEN_NOT_BOOKING_PARTICIPANT/);
  });

  it('a user may only read and reply to their OWN ticket', () => {
    const fn = SUPPORT_MIGRATION.slice(
      SUPPORT_MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.get_support_ticket('),
      SUPPORT_MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.list_support_tickets('),
    );
    assert.match(fn, /NOT \(v_is_admin OR v_ticket\.requester_id = p_caller_id\)/);
    assert.match(fn, /FORBIDDEN_NOT_TICKET_OWNER/);
  });

  it('the list cannot be widened: a non-admin asking for the ADMIN queue is refused', () => {
    const fn = SUPPORT_MIGRATION.slice(
      SUPPORT_MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.list_support_tickets('),
      SUPPORT_MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.support_ticket_metrics('),
    );
    assert.match(fn, /p_scope = 'ADMIN' AND NOT v_is_admin/);
    // There is no user_id parameter at all.
    assert.equal(/p_user_id/.test(fn), false);
    assert.match(fn, /ELSE t\.requester_id = p_caller_id/);
  });

  it('the search is bounded, so it cannot enumerate accounts', () => {
    assert.match(SUPPORT_MIGRATION, /LEAST\(GREATEST\(COALESCE\(p_limit, 100\), 1\), 200\)/);
  });

  it('a ticket code is matched case-insensitively and trimmed', () => {
    assert.match(SUPPORT_MIGRATION, /WHERE ticket_code = upper\(btrim\(p_ticket_code\)\)/);
  });

  it('the metrics function counts real rows and refuses a non-admin', () => {
    // Read from the comment-stripped text so the prose that explains the
    // auth.uid() rule cannot satisfy - or break - the assertions below.
    const body = SUPPORT_MIGRATION_CODE.slice(
      SUPPORT_MIGRATION_CODE.indexOf('CREATE OR REPLACE FUNCTION public.support_ticket_metrics('),
    );
    assert.match(body, /NOT public\.has_role\(p_caller_id, 'admin'\)/);
    for (const count of ['open', 'inProgress', 'waitingForUser', 'urgent', 'resolvedToday']) {
      assert.match(
        body,
        new RegExp(`'${count}',\\s*\\(\\s*SELECT count\\(\\*\\) FROM public\\.support_tickets`),
        `${count} must be a real COUNT`,
      );
    }
    const fn = body.slice(0, body.indexOf('$$;'));
    assert.equal(
      /auth\.uid\(\)/.test(fn),
      false,
      'an auth.uid()-based check would reject every real admin, because the service role has no uid',
    );
    assert.match(fn, /p_caller_id UUID/);
  });

  it('the migration writes no secret, token or payment credential into an audit event', () => {
    for (const forbidden of ['secret', 'token', 'password', 'card_number', 'api_key']) {
      assert.equal(
        new RegExp(`metadata[^;]*${forbidden}`, 'i').test(SUPPORT_MIGRATION),
        false,
        `an audit metadata payload references ${forbidden}`,
      );
    }
  });

  it('the payment context it exposes carries no gateway credential', () => {
    const fn = SUPPORT_MIGRATION.slice(
      SUPPORT_MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.get_support_ticket('),
      SUPPORT_MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.list_support_tickets('),
    );
    assert.match(fn, /'refundStatus', pay\.refund_status/);
    for (const forbidden of ['gateway_payload', 'razorpay_order_id', 'razorpay_payment_id', 'signature']) {
      assert.equal(
        fn.includes(forbidden),
        false,
        `the support payment context must not expose ${forbidden}`,
      );
    }
  });

  it('the support feature moves no money', () => {
    // No RPC may write to `payments`, and no support endpoint may accept an
    // amount. A refund is settled by the payments feature, not by a ticket.
    const supportFns = SUPPORT_MIGRATION.slice(
      SUPPORT_MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.create_support_ticket('),
      SUPPORT_MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.support_ticket_metrics('),
    );
    assert.equal(
      /UPDATE public\.payments/.test(supportFns),
      false,
      'a support function must never update a payment',
    );
    assert.equal(/p_amount/.test(supportFns), false, 'no support function may accept an amount');
    // The routes carry a long comment about why there is no refund action here,
    // so the code is checked with comments stripped.
    assert.equal(
      /refund/i.test(supportRouteCode()),
      false,
      'the support routes must not expose a refund action',
    );
    // The refund lifecycle it defers to really does exist.
    assert.match(
      read('supabase/migrations/20261014000000_phase40_manual_refund_completion.sql'),
      /complete_manual_refund/,
      'the payments feature must be the thing that moves money',
    );
  });

  it('get_support_ticket never selects a partial column list into a composite variable', () => {
    // Regression: `v_requester public.profiles` + `SELECT p.full_name, p.email
    // INTO v_requester` makes Postgres fill the row variable's attributes
    // positionally, so the name is cast into profiles.id (a uuid) and EVERY
    // ticket read dies with `22P02: invalid input syntax for type uuid`. It only
    // showed up against a live database; no source-level check can see it.
    const fn = SUPPORT_MIGRATION.slice(
      SUPPORT_MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.get_support_ticket('),
      SUPPORT_MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.list_support_tickets('),
    );
    // The general rule behind the bug: a partial column list and the variable
    // list it is assigned to must have the same arity. `SELECT *` into a row
    // type is fine; `SELECT a, b` into a row type is what casts a name to a uuid.
    const arityMismatches = [...fn.matchAll(/SELECT\s+(.+?)\s+INTO\s+([a-z_0-9,\s]+?)\s+FROM/gi)]
      .filter(([, list, targets]) => {
        const columns = list.trim();
        if (columns === '*') return false;
        return columns.split(',').length !== targets.split(',').length;
      })
      .map(([, list, targets]) => `${list.trim()} -> ${targets.trim()}`);
    assert.deepEqual(
      arityMismatches,
      [],
      `a SELECT column list and its INTO targets disagree in length: ${arityMismatches.join(' | ')}`,
    );
    assert.match(fn, /SELECT p\.full_name, p\.email INTO v_requester_name, v_requester_email/);
    assert.equal(/v_requester\./.test(fn), false, 'no field access on the removed composite variable');
  });

  it('authenticated holds NO write privilege on a support table', () => {
    // Regression, and the important one. PostgreSQL applies a SELECT policy's
    // USING clause to UPDATE and DELETE when no UPDATE/DELETE policy exists, so
    // a lone read policy is not containment: verified live, a signed-in user
    // could UPDATE their own ticket (status, priority, assigned_admin_id,
    // resolution) and DELETE it, entirely around the RPC checks. INSERT was
    // already refused, which is exactly what hid it.
    for (const table of [
      'support_tickets',
      'support_messages',
      'support_attachments',
      'support_audit_events',
    ]) {
      assert.match(
        SUPPORT_MIGRATION,
        new RegExp(`REVOKE INSERT, UPDATE, DELETE ON public\\.${table}\\s+FROM authenticated`),
        `authenticated can still write ${table} directly`,
      );
    }
    // And the migration refuses to finish if that ever comes back.
    assert.match(
      SUPPORT_MIGRATION,
      /PHASE-41 containment incomplete: authenticated can WRITE/,
    );
    assert.match(
      SUPPORT_MIGRATION,
      /has_table_privilege\('authenticated',[\s\S]{0,160}'UPDATE'[\s\S]{0,160}'DELETE'/,
      'the post-condition must probe UPDATE and DELETE, not just INSERT',
    );
  });

  it('the RPCs are unaffected by that revoke, because they run as service_role', () => {
    // SECURITY DEFINER plus a service-role caller is why removing the client's
    // table privileges costs the application nothing.
    for (const fn of ['create_support_ticket', 'add_support_message', 'add_support_attachment']) {
      const start = SUPPORT_MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
      const body = SUPPORT_MIGRATION.slice(start, SUPPORT_MIGRATION.indexOf('$$;', start));
      assert.match(body, /SECURITY DEFINER/, `${fn} must be SECURITY DEFINER`);
    }
    assert.match(
      SUPPORT_MIGRATION,
      /GRANT EXECUTE ON FUNCTION public\.create_support_ticket\([^)]*\)\s+TO service_role/,
    );
  });

  it('every notification it writes goes to the existing notifications table', () => {
    assert.match(SUPPORT_MIGRATION, /INSERT INTO public\.notifications/);
    assert.equal(
      /CREATE TABLE[^;]*notification/i.test(SUPPORT_MIGRATION),
      false,
      'support must not create a second notification table',
    );
    // user_id is NOT NULL, so an admin alert has to be materialised per admin.
    assert.match(SUPPORT_MIGRATION, /SELECT u\.user_id FROM public\.user_roles u WHERE u\.role = 'admin'/);
  });
});

// ===========================================================================
// Formspree removal
// ===========================================================================

describe('Formspree is gone, not duplicated', () => {
  it('the Formspree support modules no longer exist', () => {
    for (const removed of [
      'src/config/support.ts',
      'src/components/support/SupportForm.tsx',
      'tests/support_form.test.ts',
    ]) {
      let exists = true;
      try {
        statSync(resolve(ROOT, removed));
      } catch {
        exists = false;
      }
      assert.equal(exists, false, `${removed} still exists`);
    }
  });

  it('no source file still posts to Formspree', () => {
    for (const file of [
      ...sourceFiles('src'),
      ...sourceFiles('tests'),
    ]) {
      const source = readFileSync(resolve(ROOT, file), 'utf8');
      assert.equal(
        /formspree/i.test(source),
        false,
        `${file} still references Formspree; the internal ticket system is the only support record`,
      );
    }
    assert.equal(/FORMSPREE/i.test(read('.env.example')), false);
  });
});

// ===========================================================================
// Routing
// ===========================================================================

describe('support routes are wired to the right pages', () => {
  it('the admin support path serves the queue, not the user form', () => {
    assert.match(
      ROUTER,
      /if \(pathname === '\/admin\/support'\) return <AdminSupportPage \/>/,
      '/admin/support must render the operational queue',
    );
    assert.match(ROUTER, /import \{ AdminSupportPage \} from/);
  });

  it('seeker and mentor support paths render the shared ticket page', () => {
    assert.match(ROUTER, /pathname === '\/seeker\/support'\) return <SupportPage \/>/);
    assert.match(ROUTER, /pathname === '\/mentor\/support'\) return <SupportPage \/>/);
  });

  it('/admin/support sits inside the admin guard', () => {
    const block = ROUTER.slice(ROUTER.indexOf("pathname.startsWith('/admin')"));
    const open = block.indexOf("<ProtectedRoute allowedRoles={['admin']}>");
    const adminSupport = block.indexOf("pathname === '/admin/support'");
    const close = block.indexOf('</ProtectedRoute>');
    assert.ok(open !== -1 && adminSupport > open && adminSupport < close,
      '/admin/support must be inside the admin-only guard');
  });

  it('both support pages are marked private and noindex', () => {
    const pageMeta = read('src/lib/pageMeta.ts');
    for (const path of ['/seeker/support', '/mentor/support', '/admin/support']) {
      const line = pageMeta.split('\n').find((l) => l.includes(`path: '${path}'`));
      assert.ok(line, `pageMeta has no entry for ${path}`);
      assert.match(line, /privatePage\(/, `${path} must be a private, noindex page`);
    }
  });

  it('the admin sidebar links to the queue', () => {
    assert.match(
      read('src/config/navigation.ts'),
      /href: '\/admin\/support'/,
      'the admin sidebar must link to the Support queue',
    );
  });

  it('the admin sidebar does not also link a seeker/mentor support page', () => {
    const nav = read('src/config/navigation.ts');
    const adminBlock = nav.slice(nav.indexOf("admin: {"));
    assert.equal(/\/seeker\/support|\/mentor\/support/.test(adminBlock), false);
  });

  it('a booking detail page carries a Contact support action with the booking code', () => {
    // The human code travels as UI context; the server still resolves it.
    const seeker = read('src/pages/seeker/SeekerBookingDetailPage.tsx');
    assert.match(seeker, /Contact support/);
    assert.match(
      seeker,
      /\/seeker\/support\?bookingCode=\$\{encodeURIComponent\(booking\.booking_code\)\}/,
      'the seeker action must pass the human booking code, not the booking UUID',
    );
  });

  it('the support pages never touch storage or a booking table directly', () => {
    for (const file of sourceFiles('src/components/support').concat([
      'src/pages/admin/AdminSupportPage.tsx',
    ])) {
      const source = readFileSync(resolve(ROOT, file), 'utf8');
      assert.equal(
        /from\('bookings'\)|from\('payments'\)|supabase\.storage/.test(source),
        false,
        `${file} must go through the authenticated API, not the database or storage directly`,
      );
    }
  });
});