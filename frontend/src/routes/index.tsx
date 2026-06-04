import { createRoute } from '@tanstack/react-router'
import { rootRoute } from './__root'
import { FloorMap } from '@/components/canvas/FloorMap'
import { LayerControls } from '@/components/canvas/LayerControls'
import { VitalsPanel } from '@/components/vitals/VitalsPanel'

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Dashboard,
})

function Dashboard() {
  return (
    // Full height, two columns, no page scroll
    <div className="flex h-full w-full overflow-hidden">

      {/* LEFT: Scrollable sidebar */}
      <aside className="flex w-72 shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-border/40 p-4 xl:w-80">
        <VitalsPanel />
      </aside>

      {/* RIGHT: Canvas panel — never scrolls, fills remaining space */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-4">
        {/* Canvas takes all available vertical space */}
        <FloorMap className="min-h-0 flex-1" />
        {/* Layer controls pinned at bottom */}
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Layers
          </span>
          <LayerControls />
        </div>
      </div>

    </div>
  )
}
