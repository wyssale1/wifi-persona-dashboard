import { useRef, useEffect } from 'react'
import { useFloorMap } from './useFloorMap'
import { useDashboardStore } from '@/store/dashboardStore'
import { cn } from '@/lib/utils'

type FloorMapProps = { className?: string }

export function FloorMap({ className }: FloorMapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const connectionStatus = useDashboardStore((s) => s.connectionStatus)
  const latestFrame = useDashboardStore((s) => s.latestFrame)

  // Resize canvas resolution to match container — no setState, no re-render
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry || !canvasRef.current) return
      const w = Math.round(entry.contentRect.width)
      const h = Math.round(entry.contentRect.height)
      if (w > 0 && h > 0) {
        canvasRef.current.width = w
        canvasRef.current.height = h
      }
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  const { onMouseDown, onMouseMove, onMouseUp } = useFloorMap({ canvasRef })

  const isConnected = connectionStatus === 'connected'
  const hasData = latestFrame !== null

  return (
    <div
      ref={containerRef}
      className={cn('relative w-full overflow-hidden rounded-lg', className)}
    >
      <canvas
        ref={canvasRef}
        // Initial size — ResizeObserver will correct it immediately
        width={800}
        height={500}
        className="absolute inset-0 h-full w-full"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      />

      {/* Connecting overlay */}
      {!isConnected && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="text-center">
            <div className="mb-3 flex justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500/20 border-t-cyan-500" />
            </div>
            <p className="text-sm font-medium text-cyan-400">
              {connectionStatus === 'connecting' ? 'Connecting…' : 'Disconnected'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {connectionStatus === 'error' ? 'Retrying…' : 'ws://localhost:8765'}
            </p>
          </div>
        </div>
      )}

      {/* Waiting for first frame */}
      {isConnected && !hasData && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">Waiting for first frame…</p>
        </div>
      )}

      {/* Node drag hint (shown until first drag) */}
      {isConnected && hasData && (
        <div className="absolute left-2 top-2 rounded bg-black/50 px-2 py-1 text-[10px] text-cyan-500/50">
          Drag ◈ nodes to position them
        </div>
      )}

      {/* Tick / source */}
      {hasData && latestFrame && (
        <div className="absolute bottom-2 right-2 rounded bg-black/50 px-2 py-0.5 font-mono text-[10px] text-cyan-500/40">
          {latestFrame.source} · tick {latestFrame.tick}
        </div>
      )}
    </div>
  )
}
