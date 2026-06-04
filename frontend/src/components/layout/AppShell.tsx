import { type ReactNode } from 'react'
import { useDashboardStore } from '@/store/dashboardStore'
import { useRuViewSocket } from '@/hooks/useRuViewSocket'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import { SettingsSheet } from './SettingsSheet'
import { useState } from 'react'
import { cn } from '@/lib/utils'

type AppShellProps = {
  children: ReactNode
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'connected'
      ? 'bg-emerald-500'
      : status === 'connecting'
        ? 'bg-amber-500 animate-pulse'
        : status === 'error'
          ? 'bg-rose-500'
          : 'bg-zinc-500'
  return <span className={cn('inline-block h-2 w-2 rounded-full', color)} />
}

export function AppShell({ children }: AppShellProps) {
  // Initialize WebSocket connection
  useRuViewSocket()

  const connectionStatus = useDashboardStore((s) => s.connectionStatus)
  const activeNodes = useDashboardStore((s) => s.activeNodes)
  const latestFrame = useDashboardStore((s) => s.latestFrame)

  const [settingsOpen, setSettingsOpen] = useState(false)

  const totalNodes = latestFrame?.nodes.length ?? 0

  return (
    <div className="flex h-screen flex-col overflow-hidden" style={{ background: '#0f1117' }}>
      {/* Header */}
      <header className="sticky top-0 z-40 flex h-12 items-center border-b border-border/40 bg-black/40 px-4 backdrop-blur-md">
        <div className="flex flex-1 items-center gap-3">
          {/* Logo / Title */}
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-cyan-500/20">
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-cyan-400" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 20h9" strokeLinecap="round" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="font-semibold text-foreground text-sm">WiFi Persona</span>
          </div>

          <div className="mx-2 h-4 w-px bg-border/60" />

          {/* Connection status */}
          <div className="flex items-center gap-1.5">
            <StatusDot status={connectionStatus} />
            <span className="text-xs text-muted-foreground capitalize">{connectionStatus}</span>
          </div>

          {/* Node count */}
          {connectionStatus === 'connected' && (
            <Badge variant="cyan" className="text-[10px]">
              {activeNodes}/{totalNodes} Nodes
            </Badge>
          )}
        </div>

        {/* Settings */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSettingsOpen(true)}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
        </Button>

        <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
      </header>

      {/* Main content */}
      <main className="flex flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  )
}
