import { useRef, useEffect, useCallback } from 'react'
import { useDashboardStore } from '@/store/dashboardStore'
import type { RuViewFrame, LayerVisibility, DashboardSettings, NodePosition } from '@/types/ruview'

// ─── Timing ──────────────────────────────────────────────────────────────────
// Data updates (EMA, person tracking) run at this rate — decoupled from draw fps
const DATA_UPDATE_INTERVAL_MS = 120   // ~8 fps for state updates
const RSSI_UPDATE_INTERVAL_MS  = 2000 // RSSI labels update every 2 s

// ─── EMA alphas (applied at ~8 fps) ─────────────────────────────────────────
// τ = -1 / (fps * ln(1-α))
// α=0.05 at 8fps → τ ≈ 2.4 s   (very smooth heatmap)
const HEATMAP_ALPHA      = 0.05
// α=0.15 at 8fps → τ ≈ 0.75 s  (person position: responsive but not jittery)
const PERSON_POS_ALPHA   = 0.15
// α=0.12 at 8fps → τ ≈ 0.95 s  (confidence fading)
const PERSON_CONF_ALPHA  = 0.12

// ─── Heatmap hysteresis ──────────────────────────────────────────────────────
// Cell becomes visible only after reaching SHOW_THRESHOLD,
// and disappears only after dropping below HIDE_THRESHOLD.
// Prevents cells from flickering in/out.
const HEATMAP_SHOW_THRESHOLD = 0.12
const HEATMAP_HIDE_THRESHOLD = 0.04

// ─── Person visibility ───────────────────────────────────────────────────────
const PERSON_FADE_IN_MS  = 800   // fade-in after first detection
const PERSON_LINGER_MS   = 3000  // stay visible this long after last frame
const HEATMAP_ALPHA_MAX  = 0.60

// ─── Layout ──────────────────────────────────────────────────────────────────
const PADDING      = 32
const NODE_RADIUS  = 10
const PERSON_RADIUS = 12
const GRID_COLS    = 20
const GRID_ROWS    = 20

// ─── Coordinate helpers ──────────────────────────────────────────────────────
function roomToCanvas(
  rx: number, ry: number,
  roomW: number, roomD: number,
  canvasW: number, canvasH: number,
): [number, number] {
  const dw = canvasW - PADDING * 2
  const dh = canvasH - PADDING * 2
  return [PADDING + (rx / roomW) * dw, PADDING + (ry / roomD) * dh]
}

function canvasToRoom(
  cx: number, cy: number,
  roomW: number, roomD: number,
  canvasW: number, canvasH: number,
): NodePosition {
  const dw = canvasW - PADDING * 2
  const dh = canvasH - PADDING * 2
  return {
    x: Math.max(0, Math.min(roomW, ((cx - PADDING) / dw) * roomW)),
    y: Math.max(0, Math.min(roomD, ((cy - PADDING) / dh) * roomD)),
  }
}

function defaultNodePos(nodeId: number, roomW: number, roomD: number): NodePosition {
  const positions: Record<number, NodePosition> = {
    1: { x: roomW * 0.1,  y: roomD * 0.1  },
    2: { x: roomW * 0.9,  y: roomD * 0.1  },
    3: { x: roomW * 0.5,  y: roomD * 0.88 },
  }
  return positions[nodeId] ?? { x: roomW * 0.5, y: roomD * 0.5 }
}

// ─── Types ───────────────────────────────────────────────────────────────────
type TrackedPerson = {
  cx: number; cy: number
  firstSeenAt: number; lastSeenAt: number
  confidence: number
}

type SmoothedNode = { rssi: number }

// ─── Hook ────────────────────────────────────────────────────────────────────
type UseFloorMapOptions = { canvasRef: React.RefObject<HTMLCanvasElement | null> }

export function useFloorMap({ canvasRef }: UseFloorMapOptions) {
  // ── Store → refs (synced every render, no RAF deps) ──────────────────────
  const frameRef    = useRef<RuViewFrame | null>(null)
  const layersRef   = useRef<LayerVisibility>({ heatmap: true, persons: true, nodes: true, trajectory: true })
  const settingsRef = useRef<DashboardSettings>({ wsUrl: '', roomWidth: 6, roomDepth: 4, nodePositions: {} })

  const frame           = useDashboardStore((s) => s.latestFrame)
  const layers          = useDashboardStore((s) => s.layers)
  const settings        = useDashboardStore((s) => s.settings)
  const updateNodePosition = useDashboardStore((s) => s.updateNodePosition)

  frameRef.current    = frame
  layersRef.current   = layers
  settingsRef.current = settings

  // ── Smoothed state (only updated at DATA_UPDATE_INTERVAL_MS) ─────────────
  const heatmapEma     = useRef<Float32Array>(new Float32Array(GRID_COLS * GRID_ROWS))
  const heatmapVisible = useRef<Uint8Array>(new Uint8Array(GRID_COLS * GRID_ROWS)) // hysteresis
  const trackedPersons = useRef<Map<number, TrackedPerson>>(new Map())
  const smoothedNodes  = useRef<Map<number, SmoothedNode>>(new Map())

  // ── Timing refs ──────────────────────────────────────────────────────────
  const lastDataUpdateMs  = useRef(0)
  const lastRssiUpdateMs  = useRef(0)

  // ── Drag ─────────────────────────────────────────────────────────────────
  const dragRef = useRef({ active: false, nodeId: -1 })

  // ── drawRef: assigned each render, called by RAF ─────────────────────────
  const drawRef = useRef<(rafTime: number) => void>(() => {})

  drawRef.current = (rafTime: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width; const H = canvas.height
    if (W === 0 || H === 0) return
    const dw = W - PADDING * 2; const dh = H - PADDING * 2

    const { roomWidth: rW, roomDepth: rD, nodePositions } = settingsRef.current
    const layers = layersRef.current
    const frame  = frameRef.current
    const now    = Date.now()

    // ──────────────────────────────────────────────────────────────────────
    // DATA UPDATE (throttled to DATA_UPDATE_INTERVAL_MS)
    // All EMA / state mutations happen here, not on every draw frame.
    // ──────────────────────────────────────────────────────────────────────
    if (now - lastDataUpdateMs.current >= DATA_UPDATE_INTERVAL_MS) {
      lastDataUpdateMs.current = now

      // Heatmap EMA + hysteresis
      if (frame?.signal_field.values.length) {
        const vals = frame.signal_field.values
        let maxRaw = 0
        for (const v of vals) if (v > maxRaw) maxRaw = v
        if (maxRaw > 0) {
          for (let i = 0; i < GRID_COLS * GRID_ROWS; i++) {
            const norm = Math.min(1, (vals[i] ?? 0) / maxRaw)
            const prev = heatmapEma.current[i] ?? 0
            const next = HEATMAP_ALPHA * norm + (1 - HEATMAP_ALPHA) * prev
            heatmapEma.current[i] = next
            // Hysteresis: flip visible bit only at threshold crossings
            if (!heatmapVisible.current[i] && next >= HEATMAP_SHOW_THRESHOLD) {
              heatmapVisible.current[i] = 1
            } else if (heatmapVisible.current[i] && next < HEATMAP_HIDE_THRESHOLD) {
              heatmapVisible.current[i] = 0
            }
          }
        }
      }

      // Person tracking EMA
      if (frame?.persons) {
        for (const person of frame.persons) {
          const leftHip  = person.keypoints.find((k) => k.name === 'left_hip')
          const rightHip = person.keypoints.find((k) => k.name === 'right_hip')
          let rawCx: number, rawCy: number

          if (leftHip && rightHip && leftHip.confidence > 0.1 && rightHip.confidence > 0.1) {
            rawCx = PADDING + ((leftHip.x + rightHip.x) / 2 / 480) * dw
            rawCy = PADDING + ((leftHip.y + rightHip.y) / 2 / 640) * dh
          } else {
            const valid = person.keypoints.filter((k) => k.confidence > 0.1)
            if (valid.length === 0) continue
            rawCx = PADDING + (valid.reduce((s, k) => s + k.x, 0) / valid.length / 480) * dw
            rawCy = PADDING + (valid.reduce((s, k) => s + k.y, 0) / valid.length / 640) * dh
          }

          const prev = trackedPersons.current.get(person.id)
          trackedPersons.current.set(person.id, {
            cx:         prev ? PERSON_POS_ALPHA  * rawCx           + (1 - PERSON_POS_ALPHA)  * prev.cx         : rawCx,
            cy:         prev ? PERSON_POS_ALPHA  * rawCy           + (1 - PERSON_POS_ALPHA)  * prev.cy         : rawCy,
            confidence: prev ? PERSON_CONF_ALPHA * person.confidence + (1 - PERSON_CONF_ALPHA) * prev.confidence : person.confidence,
            firstSeenAt: prev?.firstSeenAt ?? now,
            lastSeenAt:  now,
          })
        }

        // Decay persons not in current frame
        for (const [id, p] of trackedPersons.current) {
          if (now - p.lastSeenAt > PERSON_LINGER_MS) trackedPersons.current.delete(id)
        }
      }

      // RSSI smoothing (even slower)
      if (now - lastRssiUpdateMs.current >= RSSI_UPDATE_INTERVAL_MS) {
        lastRssiUpdateMs.current = now
        if (frame?.nodes) {
          for (const node of frame.nodes) {
            const prev = smoothedNodes.current.get(node.node_id)
            smoothedNodes.current.set(node.node_id, {
              rssi: prev ? 0.3 * node.rssi_dbm + 0.7 * prev.rssi : node.rssi_dbm,
            })
          }
        }
      }
    }

    // ──────────────────────────────────────────────────────────────────────
    // RENDER (runs at full RAF fps ~60)
    // Only reads from smoothed buffers, never from frameRef directly.
    // ──────────────────────────────────────────────────────────────────────

    ctx.clearRect(0, 0, W, H)

    // Room background
    ctx.fillStyle = 'rgba(10,12,18,0.97)'
    ctx.fillRect(PADDING, PADDING, dw, dh)

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'
    ctx.lineWidth = 1
    for (let x = 0; x <= rW; x++) {
      const cx = PADDING + (x / rW) * dw
      ctx.beginPath(); ctx.moveTo(cx, PADDING); ctx.lineTo(cx, PADDING + dh); ctx.stroke()
    }
    for (let y = 0; y <= rD; y++) {
      const cy = PADDING + (y / rD) * dh
      ctx.beginPath(); ctx.moveTo(PADDING, cy); ctx.lineTo(PADDING + dw, cy); ctx.stroke()
    }

    // Border
    ctx.strokeStyle = 'rgba(6,182,212,0.2)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(PADDING, PADDING, dw, dh)

    // Dimension labels
    ctx.fillStyle = 'rgba(90,150,170,0.45)'
    ctx.font = '11px monospace'
    ctx.textAlign = 'center'
    ctx.fillText(`${rW} m`, PADDING + dw / 2, PADDING - 10)
    ctx.save()
    ctx.translate(PADDING - 14, PADDING + dh / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = 'center'
    ctx.fillText(`${rD} m`, 0, 0)
    ctx.restore()

    // ── Heatmap (from smoothed EMA + hysteresis) ──────────────────────────
    if (layers.heatmap) {
      const cellW = dw / GRID_COLS
      const cellH = dh / GRID_ROWS
      for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
          const i = row * GRID_COLS + col
          if (!heatmapVisible.current[i]) continue
          const v = heatmapEma.current[i] ?? 0
          const alpha = Math.min(HEATMAP_ALPHA_MAX, v * HEATMAP_ALPHA_MAX * 1.4)
          const g = Math.round(182 - v * 55)
          ctx.fillStyle = `rgba(6,${g},212,${alpha.toFixed(2)})`
          ctx.fillRect(PADDING + col * cellW, PADDING + row * cellH, cellW, cellH)
        }
      }
    }

    // ── Nodes ─────────────────────────────────────────────────────────────
    if (layers.nodes) {
      const nodeIds = frameRef.current?.nodes.map((n) => n.node_id) ?? [1, 2, 3]
      for (const nodeId of nodeIds) {
        const pos = nodePositions[nodeId] ?? defaultNodePos(nodeId, rW, rD)
        const [cx, cy] = roomToCanvas(pos.x, pos.y, rW, rD, W, H)

        // Glow
        const grd = ctx.createRadialGradient(cx, cy, 2, cx, cy, NODE_RADIUS * 2.8)
        grd.addColorStop(0, 'rgba(6,182,212,0.3)')
        grd.addColorStop(1, 'rgba(6,182,212,0)')
        ctx.fillStyle = grd
        ctx.beginPath(); ctx.arc(cx, cy, NODE_RADIUS * 2.8, 0, Math.PI * 2); ctx.fill()

        // Diamond
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 4)
        ctx.fillStyle = '#06b6d4'
        ctx.fillRect(-NODE_RADIUS / 2, -NODE_RADIUS / 2, NODE_RADIUS, NODE_RADIUS)
        ctx.restore()

        // Ring
        ctx.strokeStyle = '#06b6d4'; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.arc(cx, cy, NODE_RADIUS, 0, Math.PI * 2); ctx.stroke()

        // Label
        ctx.fillStyle = '#22d3ee'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'
        ctx.fillText(`N${nodeId}`, cx, cy + NODE_RADIUS + 13)

        // RSSI (from slow-updated smoothedNodes — doesn't jump every frame)
        const sn = smoothedNodes.current.get(nodeId)
        if (sn) {
          ctx.fillStyle = 'rgba(100,200,220,0.5)'; ctx.font = '9px monospace'
          ctx.fillText(`${Math.round(sn.rssi)} dBm`, cx, cy + NODE_RADIUS + 23)
        }
      }
    }

    // ── Persons (smoothed positions, 60fps pulse animation) ───────────────
    if (layers.persons) {
      // Use rafTime for smooth 60fps pulse — independent of data throttling
      const pulse = (Math.sin(rafTime / 700) + 1) / 2

      for (const [, p] of trackedPersons.current) {
        const age       = now - p.firstSeenAt
        const staleness = now - p.lastSeenAt
        const fadeIn    = Math.min(1, age / PERSON_FADE_IN_MS)
        const fadeOut   = staleness > 1200
          ? Math.max(0, 1 - (staleness - 1200) / (PERSON_LINGER_MS - 1200))
          : 1
        const opacity   = fadeIn * fadeOut * Math.max(0.3, p.confidence)
        if (opacity < 0.05) continue

        const ringR = PERSON_RADIUS + pulse * 9

        ctx.strokeStyle = `rgba(6,182,212,${(opacity * 0.3).toFixed(2)})`
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(p.cx, p.cy, ringR, 0, Math.PI * 2); ctx.stroke()

        ctx.fillStyle = `rgba(6,182,212,${(opacity * 0.18).toFixed(2)})`
        ctx.beginPath(); ctx.arc(p.cx, p.cy, PERSON_RADIUS, 0, Math.PI * 2); ctx.fill()

        ctx.strokeStyle = `rgba(6,182,212,${opacity.toFixed(2)})`
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.arc(p.cx, p.cy, PERSON_RADIUS, 0, Math.PI * 2); ctx.stroke()

        ctx.fillStyle = `rgba(255,255,255,${(opacity * 0.85).toFixed(2)})`
        ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'
        ctx.fillText('●', p.cx, p.cy + 4)
      }
    }

    ctx.textAlign = 'left'
  }

  // ── RAF loop — stable, never restarts, passes rafTime for animations ──────
  useEffect(() => {
    let raf = 0
    const loop = (time: number) => {
      drawRef.current(time)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const getNodeAt = useCallback((cx: number, cy: number): number | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const { roomWidth: rW, roomDepth: rD, nodePositions } = settingsRef.current
    const W = canvas.width; const H = canvas.height
    const nodeIds = frameRef.current?.nodes.map((n) => n.node_id) ?? [1, 2, 3]
    for (const nodeId of nodeIds) {
      const pos = nodePositions[nodeId] ?? defaultNodePos(nodeId, rW, rD)
      const [ncx, ncy] = roomToCanvas(pos.x, pos.y, rW, rD, W, H)
      if (Math.hypot(cx - ncx, cy - ncy) < NODE_RADIUS + 10) return nodeId
    }
    return null
  }, [canvasRef])

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const cx = (e.clientX - rect.left) * (canvas.width / rect.width)
    const cy = (e.clientY - rect.top)  * (canvas.height / rect.height)
    const nodeId = getNodeAt(cx, cy)
    if (nodeId === null) return
    dragRef.current = { active: true, nodeId }
    canvas.style.cursor = 'grabbing'
  }, [canvasRef, getNodeAt])

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const cx = (e.clientX - rect.left) * (canvas.width / rect.width)
    const cy = (e.clientY - rect.top)  * (canvas.height / rect.height)
    if (!dragRef.current.active) {
      canvas.style.cursor = getNodeAt(cx, cy) !== null ? 'grab' : 'default'
      return
    }
    const { roomWidth: rW, roomDepth: rD } = settingsRef.current
    updateNodePosition(dragRef.current.nodeId, canvasToRoom(cx, cy, rW, rD, canvas.width, canvas.height))
  }, [canvasRef, getNodeAt, updateNodePosition])

  const onMouseUp = useCallback(() => {
    dragRef.current.active = false
    if (canvasRef.current) canvasRef.current.style.cursor = 'default'
  }, [canvasRef])

  return { onMouseDown, onMouseMove, onMouseUp }
}
