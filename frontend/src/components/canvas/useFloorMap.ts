import { useRef, useEffect, useCallback } from 'react'
import { useDashboardStore } from '@/store/dashboardStore'
import type { RuViewFrame, LayerVisibility, DashboardSettings, NodePosition } from '@/types/ruview'

// ─── Constants ───────────────────────────────────────────────────────────────
const PADDING = 32
const NODE_RADIUS = 10
const PERSON_RADIUS = 12
const HEATMAP_ALPHA_MAX = 0.65
const GRID_COLS = 20
const GRID_ROWS = 20

// Person position EMA: α=0.08 → ~0.4s smoothing at 34fps (responsive but smooth)
const PERSON_POS_ALPHA = 0.08
// Person is shown faded until it has been tracked for this long
const PERSON_FADE_IN_MS = 600
// Person stays visible for this long after last frame mention
const PERSON_LINGER_MS = 2500

// ─── Coordinate helpers ──────────────────────────────────────────────────────
function roomToCanvas(
  rx: number, ry: number,
  roomW: number, roomD: number,
  canvasW: number, canvasH: number
): [number, number] {
  const dw = canvasW - PADDING * 2
  const dh = canvasH - PADDING * 2
  return [PADDING + (rx / roomW) * dw, PADDING + (ry / roomD) * dh]
}

function canvasToRoom(
  cx: number, cy: number,
  roomW: number, roomD: number,
  canvasW: number, canvasH: number
): NodePosition {
  const dw = canvasW - PADDING * 2
  const dh = canvasH - PADDING * 2
  return {
    x: Math.max(0, Math.min(roomW, ((cx - PADDING) / dw) * roomW)),
    y: Math.max(0, Math.min(roomD, ((cy - PADDING) / dh) * roomD)),
  }
}

function defaultNodePos(nodeId: number, roomW: number, roomD: number): NodePosition {
  // Triangle formation in corners by default
  const positions: Record<number, NodePosition> = {
    1: { x: roomW * 0.1, y: roomD * 0.1 },
    2: { x: roomW * 0.9, y: roomD * 0.1 },
    3: { x: roomW * 0.5, y: roomD * 0.9 },
  }
  return positions[nodeId] ?? { x: roomW * 0.5, y: roomD * 0.5 }
}

// ─── Tracked person state ────────────────────────────────────────────────────
type TrackedPerson = {
  cx: number
  cy: number
  firstSeenAt: number
  lastSeenAt: number
  confidence: number
}

// ─── Hook ────────────────────────────────────────────────────────────────────
type UseFloorMapOptions = { canvasRef: React.RefObject<HTMLCanvasElement | null> }

export function useFloorMap({ canvasRef }: UseFloorMapOptions) {
  // ── Mirror store values into refs (no deps in RAF loop) ──────────────────
  const frameRef = useRef<RuViewFrame | null>(null)
  const layersRef = useRef<LayerVisibility>({ heatmap: true, persons: true, nodes: true, trajectory: true })
  const settingsRef = useRef<DashboardSettings>({ wsUrl: '', roomWidth: 6, roomDepth: 4, nodePositions: {} })

  const frame = useDashboardStore((s) => s.latestFrame)
  const layers = useDashboardStore((s) => s.layers)
  const settings = useDashboardStore((s) => s.settings)
  const updateNodePosition = useDashboardStore((s) => s.updateNodePosition)

  // Sync to refs every render — O(1), no re-render triggered
  frameRef.current = frame
  layersRef.current = layers
  settingsRef.current = settings

  // ── Person tracking (EMA smoothed positions) ─────────────────────────────
  const trackedPersons = useRef<Map<number, TrackedPerson>>(new Map())

  // ── Heatmap smoothing (per-cell EMA) ─────────────────────────────────────
  const heatmapEma = useRef<Float32Array>(new Float32Array(GRID_COLS * GRID_ROWS))
  const HEATMAP_ALPHA = 0.06

  // ── Drag state ───────────────────────────────────────────────────────────
  const dragRef = useRef({ active: false, nodeId: -1 })

  // ── Draw function assigned to ref (called from RAF, reads current refs) ──
  const drawRef = useRef(() => {})
  drawRef.current = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvas.width
    const H = canvas.height
    if (W === 0 || H === 0) return
    const dw = W - PADDING * 2
    const dh = H - PADDING * 2

    const { roomWidth: rW, roomDepth: rD, nodePositions } = settingsRef.current
    const layers = layersRef.current
    const frame = frameRef.current
    const now = Date.now()

    // ── Update heatmap EMA ─────────────────────────────────────────────────
    if (frame?.signal_field.values.length) {
      const vals = frame.signal_field.values
      let maxRaw = 0
      for (const v of vals) if (v > maxRaw) maxRaw = v
      if (maxRaw > 0) {
        for (let i = 0; i < heatmapEma.current.length; i++) {
          const norm = Math.min(1, (vals[i] ?? 0) / maxRaw)
          heatmapEma.current[i] = HEATMAP_ALPHA * norm + (1 - HEATMAP_ALPHA) * (heatmapEma.current[i] ?? 0)
        }
      }
    }

    // ── Update tracked persons ─────────────────────────────────────────────
    if (frame?.persons) {
      const seenIds = new Set<number>()

      for (const person of frame.persons) {
        seenIds.add(person.id)

        // Compute raw canvas position from keypoints
        const leftHip = person.keypoints.find((k) => k.name === 'left_hip')
        const rightHip = person.keypoints.find((k) => k.name === 'right_hip')

        let rawCx: number
        let rawCy: number

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
          cx: prev ? PERSON_POS_ALPHA * rawCx + (1 - PERSON_POS_ALPHA) * prev.cx : rawCx,
          cy: prev ? PERSON_POS_ALPHA * rawCy + (1 - PERSON_POS_ALPHA) * prev.cy : rawCy,
          firstSeenAt: prev?.firstSeenAt ?? now,
          lastSeenAt: now,
          confidence: PERSON_POS_ALPHA * person.confidence + (1 - PERSON_POS_ALPHA) * (prev?.confidence ?? person.confidence),
        })
      }

      // Remove persons not seen for PERSON_LINGER_MS
      for (const [id, p] of trackedPersons.current) {
        if (now - p.lastSeenAt > PERSON_LINGER_MS) trackedPersons.current.delete(id)
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DRAW
    // ─────────────────────────────────────────────────────────────────────────

    ctx.clearRect(0, 0, W, H)

    // Room background
    ctx.fillStyle = 'rgba(10, 12, 18, 0.95)'
    ctx.fillRect(PADDING, PADDING, dw, dh)

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.035)'
    ctx.lineWidth = 1
    for (let x = 0; x <= rW; x++) {
      const cx = PADDING + (x / rW) * dw
      ctx.beginPath(); ctx.moveTo(cx, PADDING); ctx.lineTo(cx, PADDING + dh); ctx.stroke()
    }
    for (let y = 0; y <= rD; y++) {
      const cy = PADDING + (y / rD) * dh
      ctx.beginPath(); ctx.moveTo(PADDING, cy); ctx.lineTo(PADDING + dw, cy); ctx.stroke()
    }

    // Room border
    ctx.strokeStyle = 'rgba(6,182,212,0.25)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(PADDING, PADDING, dw, dh)

    // Dimension labels
    ctx.fillStyle = 'rgba(100,160,180,0.5)'
    ctx.font = '11px monospace'
    ctx.textAlign = 'center'
    ctx.fillText(`${rW} m`, PADDING + dw / 2, PADDING - 10)
    ctx.save()
    ctx.translate(PADDING - 14, PADDING + dh / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = 'center'
    ctx.fillText(`${rD} m`, 0, 0)
    ctx.restore()

    // ── Heatmap ────────────────────────────────────────────────────────────
    if (layers.heatmap) {
      const cellW = dw / GRID_COLS
      const cellH = dh / GRID_ROWS
      for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
          const v = heatmapEma.current[row * GRID_COLS + col] ?? 0
          if (v < 0.04) continue
          const alpha = v * HEATMAP_ALPHA_MAX
          const g = Math.round(182 - v * 50)
          ctx.fillStyle = `rgba(6,${g},212,${alpha})`
          ctx.fillRect(PADDING + col * cellW, PADDING + row * cellH, cellW, cellH)
        }
      }
    }

    // ── Node markers ───────────────────────────────────────────────────────
    if (layers.nodes) {
      // Determine which node IDs to show: from frame if available, else 1-3
      const nodeIds: number[] = frame?.nodes.map((n) => n.node_id) ?? [1, 2, 3]

      for (const nodeId of nodeIds) {
        const pos = nodePositions[nodeId] ?? defaultNodePos(nodeId, rW, rD)
        const [cx, cy] = roomToCanvas(pos.x, pos.y, rW, rD, W, H)

        // Glow
        const grd = ctx.createRadialGradient(cx, cy, 2, cx, cy, NODE_RADIUS * 2.8)
        grd.addColorStop(0, 'rgba(6,182,212,0.35)')
        grd.addColorStop(1, 'rgba(6,182,212,0)')
        ctx.fillStyle = grd
        ctx.beginPath()
        ctx.arc(cx, cy, NODE_RADIUS * 2.8, 0, Math.PI * 2)
        ctx.fill()

        // Diamond
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(Math.PI / 4)
        ctx.fillStyle = '#06b6d4'
        ctx.fillRect(-NODE_RADIUS / 2, -NODE_RADIUS / 2, NODE_RADIUS, NODE_RADIUS)
        ctx.restore()

        // Ring
        ctx.strokeStyle = '#06b6d4'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(cx, cy, NODE_RADIUS, 0, Math.PI * 2)
        ctx.stroke()

        // Label
        ctx.fillStyle = '#22d3ee'
        ctx.font = 'bold 10px monospace'
        ctx.textAlign = 'center'
        ctx.fillText(`N${nodeId}`, cx, cy + NODE_RADIUS + 13)

        // RSSI from frame if available
        const frameNode = frame?.nodes.find((n) => n.node_id === nodeId)
        if (frameNode) {
          ctx.fillStyle = 'rgba(100,200,220,0.55)'
          ctx.font = '9px monospace'
          ctx.fillText(`${frameNode.rssi_dbm.toFixed(0)} dBm`, cx, cy + NODE_RADIUS + 23)
        }
      }
    }

    // ── Persons (smoothed positions) ───────────────────────────────────────
    if (layers.persons) {
      for (const [, p] of trackedPersons.current) {
        const age = now - p.firstSeenAt
        const staleness = now - p.lastSeenAt
        // Fade in
        const fadeIn = Math.min(1, age / PERSON_FADE_IN_MS)
        // Fade out when not seen recently
        const fadeOut = staleness > 1000 ? Math.max(0, 1 - (staleness - 1000) / (PERSON_LINGER_MS - 1000)) : 1
        const opacity = fadeIn * fadeOut * Math.max(0.35, p.confidence)

        if (opacity < 0.05) continue

        // Animated pulse ring
        const pulse = (Math.sin(now / 700) + 1) / 2
        const ringR = PERSON_RADIUS + pulse * 10

        ctx.strokeStyle = `rgba(6,182,212,${opacity * 0.35})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(p.cx, p.cy, ringR, 0, Math.PI * 2)
        ctx.stroke()

        // Person fill
        ctx.fillStyle = `rgba(6,182,212,${opacity * 0.2})`
        ctx.beginPath()
        ctx.arc(p.cx, p.cy, PERSON_RADIUS, 0, Math.PI * 2)
        ctx.fill()

        ctx.strokeStyle = `rgba(6,182,212,${opacity})`
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(p.cx, p.cy, PERSON_RADIUS, 0, Math.PI * 2)
        ctx.stroke()

        // Person icon
        ctx.fillStyle = `rgba(255,255,255,${opacity * 0.9})`
        ctx.font = 'bold 10px monospace'
        ctx.textAlign = 'center'
        ctx.fillText('●', p.cx, p.cy + 4)
      }
    }

    ctx.textAlign = 'left'
  }

  // ── Single stable RAF loop — empty deps, never restarts ─────────────────
  useEffect(() => {
    let raf = 0
    const loop = () => {
      drawRef.current()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, []) // ← intentionally empty: loop runs once forever

  // ── Drag: find node at canvas coords ────────────────────────────────────
  const getNodeAt = useCallback((cx: number, cy: number): number | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const { roomWidth: rW, roomDepth: rD, nodePositions } = settingsRef.current
    const W = canvas.width
    const H = canvas.height
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
    const cy = (e.clientY - rect.top) * (canvas.height / rect.height)
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
    const cy = (e.clientY - rect.top) * (canvas.height / rect.height)

    if (!dragRef.current.active) {
      canvas.style.cursor = getNodeAt(cx, cy) !== null ? 'grab' : 'default'
      return
    }

    const { roomWidth: rW, roomDepth: rD } = settingsRef.current
    const newPos = canvasToRoom(cx, cy, rW, rD, canvas.width, canvas.height)
    updateNodePosition(dragRef.current.nodeId, newPos)
  }, [canvasRef, getNodeAt, updateNodePosition])

  const onMouseUp = useCallback(() => {
    dragRef.current.active = false
    if (canvasRef.current) canvasRef.current.style.cursor = 'default'
  }, [canvasRef])

  return { onMouseDown, onMouseMove, onMouseUp }
}
