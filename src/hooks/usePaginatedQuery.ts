import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  PaginationParams,
  ParsedPaginationParams,
  PaginatedResponse,
  CursorData,
} from '@/src/lib/pagination';
import { DEFAULT_PAGE_SIZE, parsePaginationParams, encodeCursor, decodeCursor } from '@/src/lib/pagination';
import { apiFetch } from '@/src/lib/apiClient';

export interface UsePaginatedQueryOptions<T, TParams extends PaginationParams = PaginationParams> {
  url?: string;
  fetchFn?: (params: ParsedPaginationParams & TParams) => Promise<PaginatedResponse<T>>;
  initialParams?: TParams;
  enabled?: boolean;
  onError?: (error: Error) => void;
  params?: TParams;
  pageSize?: number;
}

export interface UsePaginatedQueryResult<T, TParams extends PaginationParams = PaginationParams> {
  data: T[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  nextCursor: string | null;
  pageSize: number;
  params: ParsedPaginationParams & TParams;
  setParams: (params: Partial<TParams & PaginationParams>) => void;
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
  refresh: () => Promise<void>;
  reset: () => void;
}

export function usePaginatedQuery<T, TParams extends PaginationParams = PaginationParams>({
  url,
  fetchFn,
  initialParams = {} as TParams,
  enabled = true,
  onError,
  params: defaultParams = {} as TParams,
  pageSize: defaultPageSize = DEFAULT_PAGE_SIZE,
}: UsePaginatedQueryOptions<T, TParams>): UsePaginatedQueryResult<T, TParams> {
  // If url is provided, create a fetch function
  const resolvedFetchFn = useRef(fetchFn);
  if (url && !fetchFn) {
    resolvedFetchFn.current = createPaginatedFetchOptions<T>(url, defaultParams as Record<string, string>);
  }

  const [data, setData] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<number>(defaultPageSize);
  const [params, setParamsState] = useState<ParsedPaginationParams & TParams>({
    cursor: null,
    pageSize: defaultPageSize,
    ...initialParams,
    ...defaultParams,
  } as ParsedPaginationParams & TParams);

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const executeFetch = useCallback(
    async (fetchParams: ParsedPaginationParams & TParams, isLoadMore = false) => {
      if (!enabled) return;

      if (isLoadMore) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const response = await resolvedFetchFn.current!(fetchParams);

        if (!isMountedRef.current) return;

        if (isLoadMore) {
          setData((prev) => [...prev, ...response.data]);
        } else {
          setData(response.data);
        }
        setHasMore(response.hasMore);
        setNextCursor(response.nextCursor);
        setPageSize(response.pageSize);
      } catch (err) {
        if (!isMountedRef.current) return;
        const errorObj = err instanceof Error ? err : new Error(String(err));
        setError(errorObj);
        onError?.(errorObj);
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [enabled, onError]
  );

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoadingMore || !nextCursor) return;

    const newParams = { ...params, cursor: nextCursor };
    setParamsState(newParams);
    await executeFetch(newParams, true);
  }, [hasMore, isLoadingMore, nextCursor, params, executeFetch]);

  const refetch = useCallback(async () => {
    const newParams = { ...params, cursor: null };
    setParamsState(newParams);
    await executeFetch(newParams, false);
  }, [params, executeFetch]);

  const refresh = refetch;

  const reset = useCallback(() => {
    setData([]);
    setHasMore(false);
    setNextCursor(null);
    setError(null);
    const newParams = { ...params, cursor: null };
    setParamsState(newParams);
  }, [params]);

  const setParams = useCallback(
    (newParams: Partial<TParams & PaginationParams>) => {
      const mergedParams = { ...params, ...newParams };
      const parsed = parsePaginationParams(mergedParams);
      const finalParams = { ...mergedParams, ...parsed } as ParsedPaginationParams & TParams;
      setParamsState(finalParams);
    },
    [params]
  );

  useEffect(() => {
    if (!enabled) return;
    const parsed = parsePaginationParams(params);
    const finalParams = { ...params, ...parsed } as ParsedPaginationParams & TParams;
    setParamsState(finalParams);
    executeFetch(finalParams, false);
  }, [enabled, params]);

  return {
    data,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    nextCursor,
    pageSize,
    params,
    setParams,
    loadMore,
    refetch,
    refresh,
    reset,
  };
}

export interface UseInfiniteQueryOptions<T, TParams extends PaginationParams = PaginationParams> {
  fetchFn: (params: ParsedPaginationParams & TParams) => Promise<PaginatedResponse<T>>;
  initialParams?: TParams;
  enabled?: boolean;
  onError?: (error: Error) => void;
  getKey?: (item: T) => string | number;
}

export interface UseInfiniteQueryResult<T, TParams extends PaginationParams = PaginationParams> {
  data: T[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  nextCursor: string | null;
  pageSize: number;
  params: ParsedPaginationParams & TParams;
  setParams: (params: Partial<TParams & PaginationParams>) => void;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  reset: () => void;
}

export function useInfiniteQuery<T, TParams extends PaginationParams = PaginationParams>({
  fetchFn,
  initialParams = {} as TParams,
  enabled = true,
  onError,
  getKey,
}: UseInfiniteQueryOptions<T, TParams>): UseInfiniteQueryResult<T, TParams> {
  return usePaginatedQuery<T, TParams>({
    fetchFn,
    initialParams,
    enabled,
    onError,
  });
}

export function createPaginatedFetchOptions<T>(
  baseUrl: string,
  defaultParams: Record<string, string> = {}
) {
  return async (params: ParsedPaginationParams): Promise<PaginatedResponse<T>> => {
    const searchParams = new URLSearchParams();

    Object.entries(defaultParams).forEach(([key, value]) => {
      searchParams.set(key, value);
    });

    if (params.cursor) {
      searchParams.set('cursor', params.cursor);
    }
    searchParams.set('pageSize', String(params.pageSize));

    const response = await apiFetch(`${baseUrl}?${searchParams.toString()}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.statusText}`);
    }

    return response.json();
  };
}