import { useRef, useCallback, useEffect } from 'react'
import { useDashboardStore } from '@/store/dashboardStore'
import type { RuViewFrame, NodePosition } from '@/types/ruview'

type DragState = {
  active: boolean
  nodeId: number
  startCanvasX: number
  startCanvasY: number
  startRoomX: number
  startRoomY: number
}

type UseFloorMapOptions = {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
}

const PADDING = 32
const NODE_RADIUS = 10
const PERSON_RADIUS = 12
const HEATMAP_ALPHA_MAX = 0.7

// Heatmap grid dimensions
const GRID_COLS = 20
const GRID_ROWS = 20

function roomToCanvas(
  roomX: number,
  roomY: number,
  roomWidth: number,
  roomDepth: number,
  canvasW: number,
  canvasH: number
): [number, number] {
  const drawW = canvasW - PADDING * 2
  const drawH = canvasH - PADDING * 2
  return [
    PADDING + (roomX / roomWidth) * drawW,
    PADDING + (roomY / roomDepth) * drawH,
  ]
}

function canvasToRoom(
  cx: number,
  cy: number,
  roomWidth: number,
  roomDepth: number,
  canvasW: number,
  canvasH: number
): NodePosition {
  const drawW = canvasW - PADDING * 2
  const drawH = canvasH - PADDING * 2
  return {
    x: Math.max(0, Math.min(roomWidth, ((cx - PADDING) / drawW) * roomWidth)),
    y: Math.max(0, Math.min(roomDepth, ((cy - PADDING) / drawH) * roomDepth)),
  }
}

function getDefaultNodePosition(
  nodeId: number,
  totalNodes: number,
  roomWidth: number
): NodePosition {
  // Spread nodes evenly across the top edge by default
  const step = roomWidth / (totalNodes + 1)
  return { x: step * (nodeId + 1), y: 0.3 }
}

export function useFloorMap({ canvasRef }: UseFloorMapOptions) {
  const dragRef = useRef<DragState>({
    active: false,
    nodeId: -1,
    startCanvasX: 0,
    startCanvasY: 0,
    startRoomX: 0,
    startRoomY: 0,
  })

  const { settings, layers, latestFrame, updateNodePosition } = useDashboardStore()
  const { roomWidth, roomDepth, nodePositions } = settings

  const draw = useCallback(
    (frame: RuViewFrame | null) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const W = canvas.width
      const H = canvas.height
      const drawW = W - PADDING * 2
      const drawH = H - PADDING * 2

      // Clear
      ctx.clearRect(0, 0, W, H)

      // Room background
      ctx.fillStyle = 'rgba(15, 17, 23, 0.9)'
      ctx.fillRect(PADDING, PADDING, drawW, drawH)

      // Grid lines
      ctx.strokeStyle = 'rgba(255,255,255,0.04)'
      ctx.lineWidth = 1
      const gridStepX = drawW / roomWidth
      const gridStepY = drawH / roomDepth
      for (let x = 0; x <= roomWidth; x++) {
        const cx = PADDING + x * gridStepX
        ctx.beginPath()
        ctx.moveTo(cx, PADDING)
        ctx.lineTo(cx, PADDING + drawH)
        ctx.stroke()
      }
      for (let y = 0; y <= roomDepth; y++) {
        const cy = PADDING + y * gridStepY
        ctx.beginPath()
        ctx.moveTo(PADDING, cy)
        ctx.lineTo(PADDING + drawW, cy)
        ctx.stroke()
      }

      // Room border
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.3)'
      ctx.lineWidth = 1.5
      ctx.strokeRect(PADDING, PADDING, drawW, drawH)

      // Dimension labels
      ctx.fillStyle = 'rgba(100,120,140,0.7)'
      ctx.font = '11px monospace'
      ctx.textAlign = 'center'
      ctx.fillText(`${roomWidth}m`, PADDING + drawW / 2, PADDING - 10)
      ctx.textAlign = 'left'
      ctx.save()
      ctx.translate(PADDING - 12, PADDING + drawH / 2)
      ctx.rotate(-Math.PI / 2)
      ctx.textAlign = 'center'
      ctx.fillText(`${roomDepth}m`, 0, 0)
      ctx.restore()

      // Heatmap layer
      if (layers.heatmap && frame && frame.signal_field.values.length > 0) {
        const values = frame.signal_field.values
        const [gW, gH] = [GRID_COLS, GRID_ROWS]
        const cellW = drawW / gW
        const cellH = drawH / gH

        let maxVal = 0
        for (const v of values) {
          if (v > maxVal) maxVal = v
        }
        if (maxVal === 0) maxVal = 1

        for (let row = 0; row < gH; row++) {
          for (let col = 0; col < gW; col++) {
            const idx = row * gW + col
            const raw = values[idx] ?? 0
            const normalized = Math.min(1, raw / maxVal)
            if (normalized < 0.05) continue

            const alpha = normalized * HEATMAP_ALPHA_MAX
            // Cyan gradient: low = teal, high = bright cyan
            const r = Math.round(6 + normalized * 22)
            const g = Math.round(182 - normalized * 40)
            const b = Math.round(212)

            ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`
            ctx.fillRect(
              PADDING + col * cellW,
              PADDING + row * cellH,
              cellW,
              cellH
            )
          }
        }
      }

      // Node markers
      if (layers.nodes && frame) {
        const allNodeIds = frame.nodes.map((n) => n.node_id)
        const totalNodes = Math.max(allNodeIds.length, 1)

        for (const node of frame.nodes) {
          const savedPos = nodePositions[node.node_id]
          const pos: NodePosition =
            savedPos ?? getDefaultNodePosition(node.node_id, totalNodes, roomWidth)

          const [cx, cy] = roomToCanvas(pos.x, pos.y, roomWidth, roomDepth, W, H)

          // Glow
          const grd = ctx.createRadialGradient(cx, cy, 2, cx, cy, NODE_RADIUS * 2.5)
          grd.addColorStop(0, 'rgba(6,182,212,0.4)')
          grd.addColorStop(1, 'rgba(6,182,212,0)')
          ctx.fillStyle = grd
          ctx.beginPath()
          ctx.arc(cx, cy, NODE_RADIUS * 2.5, 0, Math.PI * 2)
          ctx.fill()

          // Diamond shape
          ctx.save()
          ctx.translate(cx, cy)
          ctx.rotate(Math.PI / 4)
          ctx.fillStyle = '#06b6d4'
          ctx.fillRect(-NODE_RADIUS / 2, -NODE_RADIUS / 2, NODE_RADIUS, NODE_RADIUS)
          ctx.restore()

          // Border circle
          ctx.strokeStyle = '#06b6d4'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(cx, cy, NODE_RADIUS, 0, Math.PI * 2)
          ctx.stroke()

          // RSSI label
          ctx.fillStyle = '#22d3ee'
          ctx.font = 'bold 10px monospace'
          ctx.textAlign = 'center'
          ctx.fillText(`N${node.node_id}`, cx, cy + NODE_RADIUS + 12)
          ctx.fillStyle = 'rgba(100,200,220,0.6)'
          ctx.font = '9px monospace'
          ctx.fillText(`${node.rssi_dbm}dBm`, cx, cy + NODE_RADIUS + 22)
        }
      }

      // Persons layer
      if (layers.persons && frame && frame.persons.length > 0) {
        const now = Date.now()

        for (const person of frame.persons) {
          // Find hip keypoints
          const leftHip = person.keypoints.find((k) => k.name === 'left_hip')
          const rightHip = person.keypoints.find((k) => k.name === 'right_hip')

          let personCanvasX: number
          let personCanvasY: number

          if (leftHip && rightHip && leftHip.confidence > 0.1 && rightHip.confidence > 0.1) {
            const midX = (leftHip.x + rightHip.x) / 2
            const midY = (leftHip.y + rightHip.y) / 2
            // Map from model space (480×640) to canvas
            personCanvasX = PADDING + (midX / 480) * drawW
            personCanvasY = PADDING + (midY / 640) * drawH
          } else if (person.keypoints.length > 0) {
            // Fallback: centroid of all keypoints with decent confidence
            const valid = person.keypoints.filter((k) => k.confidence > 0.1)
            if (valid.length === 0) continue
            const sumX = valid.reduce((s, k) => s + k.x, 0)
            const sumY = valid.reduce((s, k) => s + k.y, 0)
            personCanvasX = PADDING + (sumX / valid.length / 480) * drawW
            personCanvasY = PADDING + (sumY / valid.length / 640) * drawH
          } else {
            // Use bbox center
            personCanvasX = PADDING + ((person.bbox.x + person.bbox.width / 2) / 480) * drawW
            personCanvasY = PADDING + ((person.bbox.y + person.bbox.height / 2) / 640) * drawH
          }

          const opacity = Math.max(0.3, person.confidence)

          // Pulse rings (CSS animation not available on canvas, use time-based)
          const pulse = (Math.sin(now / 600 + person.id) + 1) / 2
          const ringRadius = PERSON_RADIUS + pulse * 12

          ctx.strokeStyle = `rgba(6, 182, 212, ${opacity * 0.4})`
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(personCanvasX, personCanvasY, ringRadius, 0, Math.PI * 2)
          ctx.stroke()

          // Person circle
          ctx.fillStyle = `rgba(6, 182, 212, ${opacity * 0.25})`
          ctx.beginPath()
          ctx.arc(personCanvasX, personCanvasY, PERSON_RADIUS, 0, Math.PI * 2)
          ctx.fill()

          ctx.strokeStyle = `rgba(6, 182, 212, ${opacity})`
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(personCanvasX, personCanvasY, PERSON_RADIUS, 0, Math.PI * 2)
          ctx.stroke()

          // Person ID
          ctx.fillStyle = `rgba(255,255,255,${opacity})`
          ctx.font = 'bold 10px monospace'
          ctx.textAlign = 'center'
          ctx.fillText(`P${person.id}`, personCanvasX, personCanvasY + 4)

          // Zone label below
          if (person.zone) {
            ctx.fillStyle = `rgba(100,200,220,${opacity * 0.7})`
            ctx.font = '9px monospace'
            ctx.fillText(person.zone, personCanvasX, personCanvasY + PERSON_RADIUS + 12)
          }
        }
      }

      ctx.textAlign = 'left'
    },
    [canvasRef, layers, roomWidth, roomDepth, nodePositions]
  )

  // Animation loop
  const animFrameRef = useRef<number>(0)
  const latestFrameRef = useRef<RuViewFrame | null>(null)
  latestFrameRef.current = latestFrame

  useEffect(() => {
    let running = true
    const loop = () => {
      if (!running) return
      draw(latestFrameRef.current)
      animFrameRef.current = requestAnimationFrame(loop)
    }
    animFrameRef.current = requestAnimationFrame(loop)
    return () => {
      running = false
      cancelAnimationFrame(animFrameRef.current)
    }
  }, [draw])

  // Drag handlers
  const getNodeAtCanvas = useCallback(
    (cx: number, cy: number): number | null => {
      if (!latestFrameRef.current) return null
      const canvas = canvasRef.current
      if (!canvas) return null
      const W = canvas.width
      const H = canvas.height
      const frame = latestFrameRef.current
      const totalNodes = frame.nodes.length

      for (const node of frame.nodes) {
        const savedPos = nodePositions[node.node_id]
        const pos =
          savedPos ?? getDefaultNodePosition(node.node_id, totalNodes, roomWidth)
        const [ncx, ncy] = roomToCanvas(pos.x, pos.y, roomWidth, roomDepth, W, H)
        const dist = Math.hypot(cx - ncx, cy - ncy)
        if (dist < NODE_RADIUS + 8) return node.node_id
      }
      return null
    },
    [canvasRef, nodePositions, roomWidth, roomDepth]
  )

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height
      const cx = (e.clientX - rect.left) * scaleX
      const cy = (e.clientY - rect.top) * scaleY

      const nodeId = getNodeAtCanvas(cx, cy)
      if (nodeId === null) return

      const frame = latestFrameRef.current
      if (!frame) return
      const totalNodes = frame.nodes.length
      const savedPos = nodePositions[nodeId]
      const pos = savedPos ?? getDefaultNodePosition(nodeId, totalNodes, roomWidth)

      dragRef.current = {
        active: true,
        nodeId,
        startCanvasX: cx,
        startCanvasY: cy,
        startRoomX: pos.x,
        startRoomY: pos.y,
      }
      canvas.style.cursor = 'grabbing'
    },
    [canvasRef, getNodeAtCanvas, nodePositions, roomWidth, roomDepth]
  )

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return

      if (!dragRef.current.active) {
        const rect = canvas.getBoundingClientRect()
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height
        const cx = (e.clientX - rect.left) * scaleX
        const cy = (e.clientY - rect.top) * scaleY
        const hit = getNodeAtCanvas(cx, cy)
        canvas.style.cursor = hit !== null ? 'grab' : 'default'
        return
      }

      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height
      const cx = (e.clientX - rect.left) * scaleX
      const cy = (e.clientY - rect.top) * scaleY

      const newPos = canvasToRoom(cx, cy, roomWidth, roomDepth, canvas.width, canvas.height)
      updateNodePosition(dragRef.current.nodeId, newPos)
    },
    [canvasRef, getNodeAtCanvas, roomWidth, roomDepth, updateNodePosition]
  )

  const onMouseUp = useCallback(() => {
    dragRef.current.active = false
    const canvas = canvasRef.current
    if (canvas) canvas.style.cursor = 'default'
  }, [canvasRef])

  return { onMouseDown, onMouseMove, onMouseUp }
}
