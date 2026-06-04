import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { RuViewFrame, DashboardSettings, LayerVisibility, NodePosition } from '@/types/ruview'

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

type NodeTimestamp = {
  nodeId: number
  lastSeen: number
}

type DashboardState = {
  settings: DashboardSettings
  layers: LayerVisibility
  latestFrame: RuViewFrame | null
  connectionStatus: ConnectionStatus
  activeNodes: number
  _nodeTimestamps: NodeTimestamp[]

  setSettings: (settings: Partial<DashboardSettings>) => void
  setLayers: (layers: Partial<LayerVisibility>) => void
  setFrame: (frame: RuViewFrame) => void
  setConnectionStatus: (status: ConnectionStatus) => void
  updateNodePosition: (nodeId: number, position: NodePosition) => void
  resetNodePositions: () => void
}

const DEFAULT_SETTINGS: DashboardSettings = {
  wsUrl: 'ws://localhost:8765/ws/sensing',
  roomWidth: 6,
  roomDepth: 4,
  nodePositions: {},
}

const DEFAULT_LAYERS: LayerVisibility = {
  heatmap: true,
  persons: true,
  nodes: true,
  trajectory: true,
}

const NODE_ACTIVE_WINDOW_MS = 5000

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      layers: DEFAULT_LAYERS,
      latestFrame: null,
      connectionStatus: 'disconnected',
      activeNodes: 0,
      _nodeTimestamps: [],

      setSettings: (partial) =>
        set((state) => ({
          settings: { ...state.settings, ...partial },
        })),

      setLayers: (partial) =>
        set((state) => ({
          layers: { ...state.layers, ...partial },
        })),

      setFrame: (frame) => {
        const now = Date.now()
        const existing = get()._nodeTimestamps.filter(
          (t) => now - t.lastSeen < NODE_ACTIVE_WINDOW_MS
        )
        const nodeIds = new Set(existing.map((t) => t.nodeId))
        for (const node of frame.nodes) {
          nodeIds.add(node.node_id)
        }
        const updated: NodeTimestamp[] = [
          ...existing.filter((t) => !frame.nodes.some((n) => n.node_id === t.nodeId)),
          ...frame.nodes.map((n) => ({ nodeId: n.node_id, lastSeen: now })),
        ]
        set({
          latestFrame: frame,
          activeNodes: nodeIds.size,
          _nodeTimestamps: updated,
        })
      },

      setConnectionStatus: (status) => set({ connectionStatus: status }),

      updateNodePosition: (nodeId, position) =>
        set((state) => ({
          settings: {
            ...state.settings,
            nodePositions: {
              ...state.settings.nodePositions,
              [nodeId]: position,
            },
          },
        })),

      resetNodePositions: () =>
        set((state) => ({
          settings: {
            ...state.settings,
            nodePositions: {},
          },
        })),
    }),
    {
      name: 'wifi-persona-dashboard-settings',
      partialize: (state) => ({
        settings: state.settings,
        layers: state.layers,
      }),
    }
  )
)
