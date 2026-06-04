import { useEffect, useRef, useCallback } from 'react'
import { useDashboardStore } from '@/store/dashboardStore'
import type { RuViewFrame } from '@/types/ruview'

const MIN_RECONNECT_MS = 1000
const MAX_RECONNECT_MS = 30_000

function isRuViewFrame(data: unknown): data is RuViewFrame {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    (data as Record<string, unknown>)['type'] === 'sensing_update'
  )
}

export function useRuViewSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectDelayRef = useRef(MIN_RECONNECT_MS)
  const mountedRef = useRef(true)

  const { settings, setFrame, setConnectionStatus } = useDashboardStore()
  const wsUrl = settings.wsUrl

  const connect = useCallback(() => {
    if (!mountedRef.current) return
    if (wsRef.current) {
      wsRef.current.onopen = null
      wsRef.current.onmessage = null
      wsRef.current.onerror = null
      wsRef.current.onclose = null
      wsRef.current.close()
      wsRef.current = null
    }

    setConnectionStatus('connecting')

    let ws: WebSocket
    try {
      ws = new WebSocket(wsUrl)
    } catch {
      setConnectionStatus('error')
      scheduleReconnect()
      return
    }
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) return
      reconnectDelayRef.current = MIN_RECONNECT_MS
      setConnectionStatus('connected')
    }

    ws.onmessage = (event: MessageEvent<string>) => {
      if (!mountedRef.current) return
      try {
        const parsed: unknown = JSON.parse(event.data)
        if (isRuViewFrame(parsed)) {
          setFrame(parsed)
        }
      } catch {
        // ignore malformed frames
      }
    }

    ws.onerror = () => {
      if (!mountedRef.current) return
      setConnectionStatus('error')
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      setConnectionStatus('disconnected')
      scheduleReconnect()
    }
  }, [wsUrl, setFrame, setConnectionStatus])

  function scheduleReconnect() {
    if (!mountedRef.current) return
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    reconnectTimerRef.current = setTimeout(() => {
      reconnectDelayRef.current = Math.min(
        reconnectDelayRef.current * 2,
        MAX_RECONNECT_MS
      )
      connect()
    }, reconnectDelayRef.current)
  }

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (wsRef.current) {
        wsRef.current.onopen = null
        wsRef.current.onmessage = null
        wsRef.current.onerror = null
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [connect])
}
