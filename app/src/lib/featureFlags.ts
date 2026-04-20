import { useQuery } from '@tanstack/react-query';

export interface FeatureFlags {
  signup_v2: boolean;
  chat_v1:   boolean;
}

const DEFAULT_FLAGS: FeatureFlags = {
  // Fail open to the modern flows if the endpoint is unreachable.
  signup_v2: true,
  chat_v1:   true,
};

async function fetchFlags(): Promise<FeatureFlags> {
  try {
    const res = await fetch('/api/flags', {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return DEFAULT_FLAGS;
    const data = (await res.json()) as Partial<FeatureFlags>;
    return {
      // anything except literal false is "on"
      signup_v2: data.signup_v2 !== false,
      chat_v1:   data.chat_v1   !== false,
    };
  } catch {
    return DEFAULT_FLAGS;
  }
}

/**
 * useFeatureFlags — subscribes to /api/flags with react-query.
 *
 * The Worker caches the response for 30s, react-query caches in-memory for
 * 60s. Combined: operator flag flips propagate within ~90s to live clients.
 */
export function useFeatureFlags() {
  const q = useQuery({
    queryKey: ['feature-flags'],
    queryFn: fetchFlags,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    // Always have *something* to render against on first paint.
    placeholderData: DEFAULT_FLAGS,
  });

  return {
    flags: q.data ?? DEFAULT_FLAGS,
    isLoading: q.isLoading,
    isError: q.isError,
  };
}
