import { useState, useEffect, useCallback, useRef } from "react";

export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number = 5000,
  immediate: boolean = true,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(immediate);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const runningRef = useRef(false);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      const result = await fetcher();
      if (mountedRef.current) {
        setData(result);
        setError(null);
        setLoading(false);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Request failed";
      if (mountedRef.current) {
        setError(message);
        setLoading(false);
      }
    } finally {
      runningRef.current = false;
    }
  }, [fetcher]);

  useEffect(() => {
    mountedRef.current = true;
    let initialId: ReturnType<typeof setTimeout> | undefined;
    if (immediate) {
      initialId = setTimeout(() => {
        void run();
      }, 0);
    }
    timerRef.current = setInterval(run, intervalMs);
    const onTransaction = () => {
      void run();
    };
    window.addEventListener("freelance-market:refresh", onTransaction);
    return () => {
      mountedRef.current = false;
      if (initialId) clearTimeout(initialId);
      if (timerRef.current) clearInterval(timerRef.current);
      window.removeEventListener("freelance-market:refresh", onTransaction);
    };
  }, [run, intervalMs, immediate]);

  return { data, loading, error, refetch: run };
}
