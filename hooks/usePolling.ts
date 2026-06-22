import { useState, useEffect, useCallback, useRef } from 'react'

export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number = 5000,
  immediate: boolean = true,
) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(immediate)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<NodeJS.Timeout>()
  const mountedRef = useRef(true)

  const run = useCallback(async () => {
    try {
      const result = await fetcher()
      if (mountedRef.current) { setData(result); setError(null); setLoading(false) }
    } catch (e: any) {
      if (mountedRef.current) { setError(e.message); setLoading(false) }
    }
  }, [fetcher])

  useEffect(() => {
    mountedRef.current = true
    if (immediate) run()
    timerRef.current = setInterval(run, intervalMs)
    return () => { mountedRef.current = false; clearInterval(timerRef.current) }
  }, [run, intervalMs, immediate])

  return { data, loading, error, refetch: run }
}
