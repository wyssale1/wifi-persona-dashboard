import { useRef, useState, useEffect } from 'react'
import { useDashboardStore } from '@/store/dashboardStore'
import type { MotionLevel } from '@/types/ruview'

// EMA alpha: ~3s smoothing at 34fps (α = 1/(3*34+1) ≈ 0.01)
const ALPHA_SLOW = 0.01
// Faster EMA for confidence / signal quality
const ALPHA_FAST = 0.05

// Debounce: how long a new categorical value must hold before we show it
const MOTION_DEBOUNCE_MS = 2000
const MOTION_TO_ABSENT_DEBOUNCE_MS = 3500 // slower to declare "nobody there"
const PRESENCE_TRUE_DEBOUNCE_MS = 400
const PRESENCE_FALSE_DEBOUNCE_MS = 4000   // slow to drop presence
const PERSONS_UPDATE_INTERVAL_MS = 800    // update person count at most every 800ms

type SmoothedFrame = {
  // Vitals (EMA smoothed)
  heartRate: number
  breathingRate: number
  signalQuality: number
  // Classification (debounced / stable)
  motionLevel: MotionLevel
  presence: boolean
  confidence: number
  personCount: number
}

export function useSmoothedVitals(): SmoothedFrame {
  // ── Numeric EMA refs (no re-render needed, read on parent re-render) ──
  const heartRateRef = useRef(0)
  const breathingRateRef = useRef(0)
  const signalQualityRef = useRef(0)
  const confidenceEmaRef = useRef(0)
  const personsEmaRef = useRef(0)

  // ── Categorical stable state (re-renders only when debounce commits) ──
  const [motionLevel, setMotionLevel] = useState<MotionLevel>('absent')
  const [presence, setPresence] = useState(false)
  const [personCount, setPersonCount] = useState(0)

  // Debounce tracking refs
  const pendingMotion = useRef<{ value: MotionLevel; since: number } | null>(null)
  const pendingPresence = useRef<{ value: boolean; since: number } | null>(null)
  const lastPersonsCommit = useRef(0)

  const frame = useDashboardStore((s) => s.latestFrame)

  // ── Numeric EMA: runs synchronously in render via refs ──
  // Safe because we only mutate refs, no state set here.
  if (frame) {
    const v = frame.vital_signs
    if (v.heartbeat_confidence > 0.3) {
      heartRateRef.current = ALPHA_SLOW * v.heart_rate_bpm + (1 - ALPHA_SLOW) * heartRateRef.current
    }
    if (v.breathing_confidence > 0.3) {
      breathingRateRef.current = ALPHA_SLOW * v.breathing_rate_bpm + (1 - ALPHA_SLOW) * breathingRateRef.current
    }
    signalQualityRef.current = ALPHA_FAST * v.signal_quality + (1 - ALPHA_FAST) * signalQualityRef.current
    confidenceEmaRef.current = ALPHA_FAST * frame.classification.confidence + (1 - ALPHA_FAST) * confidenceEmaRef.current
    personsEmaRef.current = ALPHA_FAST * frame.estimated_persons + (1 - ALPHA_FAST) * personsEmaRef.current
  }

  // ── Categorical debounce: runs in useEffect (after render, safe to setState) ──
  useEffect(() => {
    if (!frame) return
    const cls = frame.classification
    const now = Date.now()

    // --- Motion level ---
    const newMotion = cls.motion_level
    if (newMotion === motionLevel) {
      pendingMotion.current = null
    } else {
      if (pendingMotion.current?.value !== newMotion) {
        // New pending value started
        pendingMotion.current = { value: newMotion, since: now }
      } else {
        // Same pending value — check if debounce expired
        const delay = newMotion === 'absent' ? MOTION_TO_ABSENT_DEBOUNCE_MS : MOTION_DEBOUNCE_MS
        if (now - pendingMotion.current.since >= delay) {
          setMotionLevel(newMotion)
          pendingMotion.current = null
        }
      }
    }

    // --- Presence ---
    const newPresence = cls.presence
    if (newPresence === presence) {
      pendingPresence.current = null
    } else {
      if (pendingPresence.current?.value !== newPresence) {
        pendingPresence.current = { value: newPresence, since: now }
      } else {
        const delay = newPresence ? PRESENCE_TRUE_DEBOUNCE_MS : PRESENCE_FALSE_DEBOUNCE_MS
        if (now - pendingPresence.current.since >= delay) {
          setPresence(newPresence)
          pendingPresence.current = null
        }
      }
    }

    // --- Person count: update at most every PERSONS_UPDATE_INTERVAL_MS ──
    if (now - lastPersonsCommit.current >= PERSONS_UPDATE_INTERVAL_MS) {
      const rounded = Math.round(personsEmaRef.current)
      setPersonCount(rounded)
      lastPersonsCommit.current = now
    }
  }, [frame, motionLevel, presence])

  return {
    heartRate: heartRateRef.current,
    breathingRate: breathingRateRef.current,
    signalQuality: signalQualityRef.current,
    confidence: confidenceEmaRef.current,
    motionLevel,
    presence,
    personCount,
  }
}
