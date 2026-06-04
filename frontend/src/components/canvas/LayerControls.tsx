import { useDashboardStore } from '@/store/dashboardStore'
import { Button } from '@/components/ui/button'
import type { LayerVisibility } from '@/types/ruview'

type LayerKey = keyof LayerVisibility

const LAYERS: { key: LayerKey; label: string }[] = [
  { key: 'heatmap', label: 'Heatmap' },
  { key: 'persons', label: 'Persons' },
  { key: 'nodes', label: 'Nodes' },
  { key: 'trajectory', label: 'Trajectory' },
]

export function LayerControls() {
  const layers = useDashboardStore((s) => s.layers)
  const setLayers = useDashboardStore((s) => s.setLayers)

  return (
    <div className="flex flex-wrap gap-1.5">
      {LAYERS.map(({ key, label }) => (
        <Button
          key={key}
          size="sm"
          variant={layers[key] ? 'default' : 'outline'}
          onClick={() => setLayers({ [key]: !layers[key] })}
          className={
            layers[key]
              ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40 hover:bg-cyan-500/30 hover:text-cyan-300'
              : 'text-muted-foreground'
          }
        >
          {label}
        </Button>
      ))}
    </div>
  )
}
