import type { MentorApplicationStatus } from '@/src/types/database';

/**
 * Server-side query contract for GET /api/admin/mentor-applications.
 *
 * The mentor verification queue is database backed: filtering (status + search),
 * counting and pagination all happen in PostgREST/Supabase. The browser never
 * receives the whole table and never filters a static array.
 */

export const MENTOR_APPLICATION_STATUSES = [
  'draft',
  'pending_review',
  'approved',
  'rejected',
] as const satisfies readonly MentorApplicationStatus[];

export const MENTOR_APPLICATION_STATUS_FILTERS = [
  'ALL',
  'draft',
  'pending_review',
  'approved',
  'rejected',
] as const;

export type MentorApplicationStatusFilter = (typeof MENTOR_APPLICATION_STATUS_FILTERS)[number];

export const DEFAULT_MENTOR_APPLICATION_PAGE_SIZE = 20;
export const MAX_MENTOR_APPLICATION_PAGE_SIZE = 100;
export const MAX_MENTOR_APPLICATION_PAGE = 10000;
export const MAX_MENTOR_APPLICATION_SEARCH_LENGTH = 120;

export function isMentorApplicationStatus(value: unknown): value is MentorApplicationStatus {
  return typeof value === 'string' && (MENTOR_APPLICATION_STATUSES as readonly string[]).includes(value);
}

export function parseMentorApplicationStatusFilter(value: unknown): MentorApplicationStatusFilter {
  if (value === 'ALL' || value === undefined || value === null || value === '') return 'ALL';
  return isMentorApplicationStatus(value) ? value : 'ALL';
}

/**
 * Removes PostgREST filter metacharacters so a search term can be safely placed
 * inside an `or=(...)` filter without changing the filter grammar.
 */
export function sanitizeMentorApplicationSearch(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[,()*%\\'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MENTOR_APPLICATION_SEARCH_LENGTH);
}

/** PostgREST `or=` expression matching applicant profile name OR email. */
export function buildProfileSearchFilter(search: string): string {
  return `full_name.ilike.*${search}*,email.ilike.*${search}*`;
}

function parsePositiveInteger(value: unknown, fallback: number, max: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' && typeof raw !== 'number') return fallback;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export interface MentorApplicationListQuery {
  status: MentorApplicationStatusFilter;
  search: string;
  page: number;
  pageSize: number;
  /** Inclusive PostgREST range bounds (`.range(from, to)`). */
  from: number;
  to: number;
}

export function parseMentorApplicationListQuery(
  query: Record<string, unknown> | undefined,
): MentorApplicationListQuery {
  const source = query ?? {};
  const status = parseMentorApplicationStatusFilter(source.status);
  const search = sanitizeMentorApplicationSearch(source.search);
  const page = parsePositiveInteger(source.page, 1, MAX_MENTOR_APPLICATION_PAGE);
  const pageSize = parsePositiveInteger(
    source.pageSize,
    DEFAULT_MENTOR_APPLICATION_PAGE_SIZE,
    MAX_MENTOR_APPLICATION_PAGE_SIZE,
  );
  const from = (page - 1) * pageSize;

  return { status, search, page, pageSize, from, to: from + pageSize - 1 };
}

export interface MentorApplicationPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export function buildMentorApplicationPagination(
  page: number,
  pageSize: number,
  total: number,
): MentorApplicationPagination {
  const safeTotal = Math.max(0, total);
  const totalPages = Math.max(1, Math.ceil(safeTotal / pageSize));
  return {
    page,
    pageSize,
    total: safeTotal,
    totalPages,
    hasPrevious: page > 1,
    hasNext: page < totalPages,
  };
}

export interface MentorApplicationStatusCounts {
  all: number;
  draft: number;
  pending_review: number;
  approved: number;
  rejected: number;
}

export function emptyMentorApplicationStatusCounts(): MentorApplicationStatusCounts {
  return { all: 0, draft: 0, pending_review: 0, approved: 0, rejected: 0 };
}
