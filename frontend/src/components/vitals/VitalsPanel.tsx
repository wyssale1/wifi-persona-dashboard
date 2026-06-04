import { useSmoothedVitals } from '@/hooks/useSmoothedVitals'
import { useDashboardStore } from '@/store/dashboardStore'
import { VitalBar } from './VitalBar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import type { MotionLevel } from '@/types/ruview'

function motionLevelLabel(level: MotionLevel): string {
  switch (level) {
    case 'absent': return 'Absent'
    case 'present_still': return 'Still'
    case 'present_moving': return 'Moving'
  }
}

function motionLevelVariant(level: MotionLevel): 'secondary' | 'outline' | 'cyan' {
  switch (level) {
    case 'absent': return 'secondary'
    case 'present_still': return 'outline'
    case 'present_moving': return 'cyan'
  }
}

export function VitalsPanel() {
  const connectionStatus = useDashboardStore((s) => s.connectionStatus)
  const {
    heartRate,
    breathingRate,
    signalQuality,
    confidence,
    motionLevel,
    presence,
    personCount,
  } = useSmoothedVitals()

  const isConnected = connectionStatus === 'connected'

  return (
    <div className="flex flex-col gap-3">

      {/* Vital Signs */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-3 pt-4">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Vital Signs
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <VitalBar
            value={Math.round(heartRate)}
            max={200}
            label="Heart Rate"
            unit="bpm"
            colorClass="text-rose-400"
            barColor="bg-rose-500/70"
            icon="♥"
            active={isConnected && presence}
          />
          <VitalBar
            value={Math.round(breathingRate)}
            max={40}
            label="Breathing"
            unit="bpm"
            colorClass="text-sky-400"
            barColor="bg-sky-500/70"
            icon="~"
            active={isConnected && presence}
          />
          <VitalBar
            value={Math.round(signalQuality * 100)}
            max={100}
            label="Signal Quality"
            unit="%"
            colorClass="text-cyan-400"
            barColor="bg-cyan-500/70"
            active={isConnected}
          />
        </CardContent>
      </Card>

      <Separator className="opacity-20" />

      {/* Presence & Motion */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-3 pt-4">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Detection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">

          {/* Presence */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Presence</span>
            <div className="flex items-center gap-1.5">
              <span className={[
                'h-2 w-2 rounded-full transition-colors duration-700',
                presence ? 'bg-cyan-400' : 'bg-zinc-600',
              ].join(' ')} />
              <span className={[
                'text-xs font-medium transition-colors duration-700',
                presence ? 'text-cyan-400' : 'text-muted-foreground',
              ].join(' ')}>
                {presence ? 'Detected' : 'None'}
              </span>
            </div>
          </div>

          {/* Motion */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Motion</span>
            <Badge variant={motionLevelVariant(motionLevel)}>
              {motionLevelLabel(motionLevel)}
            </Badge>
          </div>

          {/* Person count */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Persons</span>
            <span className="font-mono text-sm font-semibold text-cyan-400">
              {personCount}
            </span>
          </div>

          {/* Confidence */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Confidence</span>
              <span className="font-mono text-xs text-foreground">
                {Math.round(confidence * 100)}%
              </span>
            </div>
            {/* Confidence bar */}
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted/40">
              <div
                className="h-full rounded-full bg-cyan-500/60 transition-all duration-[800ms] ease-out"
                style={{ width: `${Math.round(confidence * 100)}%` }}
              />
            </div>
          </div>

        </CardContent>
      </Card>

      {/* Node activity */}
      <NodeActivityCard />

    </div>
  )
}

function NodeActivityCard() {
  const activeNodes = useDashboardStore((s) => s.activeNodes)

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3 pt-4">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Sensor Nodes
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex flex-1 flex-col items-center gap-1">
              <div className={[
                'h-2 w-2 rounded-full transition-colors duration-500',
                n <= activeNodes ? 'bg-cyan-400' : 'bg-zinc-700',
              ].join(' ')} />
              <span className="text-[10px] text-muted-foreground">N{n}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
