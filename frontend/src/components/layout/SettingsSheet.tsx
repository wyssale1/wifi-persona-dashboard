import { useState, useEffect } from 'react'
import { useDashboardStore } from '@/store/dashboardStore'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import type { LayerVisibility } from '@/types/ruview'

type SettingsSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type LayerKey = keyof LayerVisibility

const LAYER_LABELS: Record<LayerKey, string> = {
  heatmap: 'Heatmap',
  persons: 'Persons',
  nodes: 'Nodes',
  trajectory: 'Trajectory',
}

export function SettingsSheet({ open, onOpenChange }: SettingsSheetProps) {
  const { settings, layers, setSettings, setLayers, resetNodePositions } = useDashboardStore()

  const [wsUrl, setWsUrl] = useState(settings.wsUrl)
  const [roomWidth, setRoomWidth] = useState(settings.roomWidth)
  const [roomDepth, setRoomDepth] = useState(settings.roomDepth)

  // Sync local state when sheet opens
  useEffect(() => {
    if (open) {
      setWsUrl(settings.wsUrl)
      setRoomWidth(settings.roomWidth)
      setRoomDepth(settings.roomDepth)
    }
  }, [open, settings])

  function handleApply() {
    setSettings({ wsUrl, roomWidth, roomDepth })
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-80 flex-col gap-6 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
        </SheetHeader>

        {/* WebSocket URL */}
        <div className="space-y-2">
          <Label htmlFor="ws-url" className="text-xs text-muted-foreground">
            WebSocket URL
          </Label>
          <Input
            id="ws-url"
            value={wsUrl}
            onChange={(e) => setWsUrl(e.target.value)}
            placeholder="ws://localhost:8765/ws/sensing"
            className="font-mono text-xs"
          />
        </div>

        <Separator />

        {/* Room Dimensions */}
        <div className="space-y-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Room Dimensions
          </p>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Width</Label>
              <span className="font-mono text-xs text-cyan-400">{roomWidth}m</span>
            </div>
            <Slider
              value={[roomWidth]}
              min={2}
              max={20}
              step={0.5}
              onValueChange={([v]) => { if (v !== undefined) setRoomWidth(v) }}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Depth</Label>
              <span className="font-mono text-xs text-cyan-400">{roomDepth}m</span>
            </div>
            <Slider
              value={[roomDepth]}
              min={2}
              max={20}
              step={0.5}
              onValueChange={([v]) => { if (v !== undefined) setRoomDepth(v) }}
            />
          </div>
        </div>

        <Separator />

        {/* Layer Visibility */}
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Layer Visibility
          </p>
          {(Object.keys(LAYER_LABELS) as LayerKey[]).map((key) => (
            <div key={key} className="flex items-center justify-between">
              <Label className="text-xs">{LAYER_LABELS[key]}</Label>
              <Switch
                checked={layers[key]}
                onCheckedChange={(checked) => setLayers({ [key]: checked })}
              />
            </div>
          ))}
        </div>

        <Separator />

        {/* Node Positions */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Node Positions
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={resetNodePositions}
          >
            Reset Node Positions
          </Button>
          <p className="text-[10px] text-muted-foreground">
            Drag nodes on the floor map to reposition them. Positions are saved automatically.
          </p>
        </div>

        {/* Apply */}
        <div className="mt-auto">
          <Button className="w-full" onClick={handleApply}>
            Apply Settings
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
