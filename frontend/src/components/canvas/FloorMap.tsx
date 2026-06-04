import { useRef, useEffect, useState } from 'react'
import { useFloorMap } from './useFloorMap'
import { useDashboardStore } from '@/store/dashboardStore'
import { cn } from '@/lib/utils'

const CANVAS_ASPECT = 3 / 2 // width / height

type FloorMapProps = {
  className?: string
}

export function FloorMap({ className }: FloorMapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [dims, setDims] = useState({ width: 800, height: 533 })

  const connectionStatus = useDashboardStore((s) => s.connectionStatus)
  const latestFrame = useDashboardStore((s) => s.latestFrame)

  // Resize observer for responsive canvas
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const w = entry.contentRect.width
      const h = Math.round(w / CANVAS_ASPECT)
      setDims({ width: Math.round(w), height: h })
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const { onMouseDown, onMouseMove, onMouseUp } = useFloorMap({ canvasRef })

  const isConnected = connectionStatus === 'connected'
  const hasData = latestFrame !== null

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      <canvas
        ref={canvasRef}
        width={dims.width}
        height={dims.height}
        className="w-full rounded-lg"
        style={{ height: dims.height }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      />

      {/* Overlay states */}
      {!isConnected && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/60 backdrop-blur-sm">
          <div className="text-center">
            <div className="mb-2 flex justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500/30 border-t-cyan-500" />
            </div>
            <p className="text-sm font-medium text-cyan-400">
              {connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {connectionStatus === 'error' ? 'Connection error — retrying' : 'Waiting for WebSocket'}
            </p>
          </div>
        </div>
      )}

      {isConnected && !hasData && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg">
          <p className="text-sm text-muted-foreground">Waiting for first frame...</p>
        </div>
      )}

      {/* Tick counter */}
      {hasData && latestFrame && (
        <div className="absolute bottom-2 right-2 rounded bg-black/50 px-2 py-0.5 font-mono text-[10px] text-cyan-500/60">
          tick {latestFrame.tick} · {latestFrame.source}
        </div>
      )}
    </div>
  )
}
