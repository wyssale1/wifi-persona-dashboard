export type MotionLevel = 'absent' | 'present_still' | 'present_moving'

export type Keypoint = {
  name: string
  x: number
  y: number
  z: number
  confidence: number
}

export type Person = {
  id: number
  confidence: number
  keypoints: Keypoint[]
  bbox: { x: number; y: number; width: number; height: number }
  zone: string
}

export type NodeInfo = {
  node_id: number
  rssi_dbm: number
  position: [number, number, number]
  amplitude: number[]
  subcarrier_count: number
}

export type RuViewFrame = {
  type: 'sensing_update'
  timestamp: number
  source: 'esp32' | 'simulate' | string
  tick: number
  nodes: NodeInfo[]
  features: {
    mean_rssi: number
    variance: number
    motion_band_power: number
    breathing_band_power: number
    dominant_freq_hz: number
    change_points: number
    spectral_power: number
  }
  classification: {
    motion_level: MotionLevel
    presence: boolean
    confidence: number
  }
  signal_field: {
    grid_size: [number, number, number]
    values: number[]
  }
  vital_signs: {
    breathing_rate_bpm: number
    heart_rate_bpm: number
    breathing_confidence: number
    heartbeat_confidence: number
    signal_quality: number
  }
  persons: Person[]
  estimated_persons: number
}

export type NodePosition = { x: number; y: number }

export type DashboardSettings = {
  wsUrl: string
  roomWidth: number
  roomDepth: number
  nodePositions: Record<number, NodePosition>
}

export type LayerVisibility = {
  heatmap: boolean
  persons: boolean
  nodes: boolean
  trajectory: boolean
}
