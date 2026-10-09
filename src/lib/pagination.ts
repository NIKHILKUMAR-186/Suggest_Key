export const DEFAULT_PAGE_SIZE = 6;
export const MAX_PAGE_SIZE = 50;
export const MIN_PAGE_SIZE = 1;

export interface PaginationParams {
  cursor?: string | null;
  pageSize?: number;
  [key: string]: any;
}

export interface ParsedPaginationParams {
  cursor: string | null;
  pageSize: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
  pageSize: number;
}

export interface CursorData {
  lastId: string | number;
  lastSortValue?: string | number | Date;
  lastIsFeatured?: boolean;
  lastRating?: number;
  createdAt?: string;
}

export function parsePaginationParams(params: PaginationParams): ParsedPaginationParams {
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const clampedPageSize = Math.min(Math.max(pageSize, MIN_PAGE_SIZE), MAX_PAGE_SIZE);
  return {
    cursor: params.cursor ?? null,
    pageSize: clampedPageSize,
  };
}

export function encodeCursor(data: CursorData): string {
  try {
    const json = JSON.stringify(data);
    return btoa(json);
  } catch {
    return '';
  }
}

export function decodeCursor(cursor: string): CursorData | null {
  try {
    const json = atob(cursor);
    return JSON.parse(json) as CursorData;
  } catch {
    return null;
  }
}

export function buildCursorQuery<T>(
  query: any,
  cursorData: CursorData | null,
  sortColumn: string = 'created_at',
  sortDirection: 'asc' | 'desc' = 'desc'
): any {
  if (!cursorData) {
    return query;
  }

  const { lastId, lastSortValue } = cursorData;

  if (sortDirection === 'desc') {
    if (lastSortValue !== undefined) {
      return query.or(`${sortColumn}.lt.${lastSortValue},and(${sortColumn}.eq.${lastSortValue},id.lt.${lastId})`);
    }
    return query.lt('id', lastId);
  } else {
    if (lastSortValue !== undefined) {
      return query.or(`${sortColumn}.gt.${lastSortValue},and(${sortColumn}.eq.${lastSortValue},id.gt.${lastId})`);
    }
    return query.gt('id', lastId);
  }
}

export function createPaginatedResponse<T>(
  data: T[],
  pageSize: number,
  getCursorData: (item: T) => CursorData
): PaginatedResponse<T> {
  const hasMore = data.length > pageSize;
  const pageData = hasMore ? data.slice(0, pageSize) : data;
  const nextCursor = hasMore && pageData.length > 0
    ? encodeCursor(getCursorData(pageData[pageData.length - 1]))
    : null;

  return {
    data: pageData,
    nextCursor,
    hasMore,
    pageSize,
  };
}

export function createOffsetPaginationParams(params: PaginationParams): {
  offset: number;
  limit: number;
} {
  const { pageSize } = parsePaginationParams(params);
  const cursor = params.cursor ? decodeCursor(params.cursor) : null;
  const offset = cursor?.lastId ? Number(cursor.lastId) : 0;

  return { offset, limit: pageSize + 1 };
}

export function createOffsetPaginatedResponse<T>(
  data: T[],
  pageSize: number,
  getId: (item: T) => string | number
): PaginatedResponse<T> {
  const hasMore = data.length > pageSize;
  const pageData = hasMore ? data.slice(0, pageSize) : data;
  const nextCursor = hasMore && pageData.length > 0
    ? encodeCursor({ lastId: getId(pageData[pageData.length - 1]) })
    : null;

  return {
    data: pageData,
    nextCursor,
    hasMore,
    pageSize,
  };
}