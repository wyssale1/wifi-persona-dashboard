import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { cn } from '@/lib/utils'

type VitalBarProps = {
  value: number
  max: number
  label: string
  unit: string
  colorClass: string
  barColor: string
  icon?: string
  active?: boolean
}

export function VitalBar({ value, max, label, unit, colorClass, barColor, icon, active = true }: VitalBarProps) {
  const countRef = useRef<HTMLSpanElement | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)
  const tweenRef = useRef<gsap.core.Tween | null>(null)

  useEffect(() => {
    if (!countRef.current || !barRef.current) return

    // Kill any running tween
    tweenRef.current?.kill()

    const displayObj = { val: parseFloat(countRef.current.dataset['val'] ?? '0') }

    tweenRef.current = gsap.to(displayObj, {
      val: value,
      duration: 0.8,
      ease: 'power2.out',
      onUpdate: () => {
        if (countRef.current) {
          countRef.current.textContent = Math.round(displayObj.val).toString()
          countRef.current.dataset['val'] = displayObj.val.toString()
        }
      },
    })

    const pct = Math.min(100, (value / max) * 100)
    gsap.to(barRef.current, {
      width: `${pct}%`,
      duration: 0.8,
      ease: 'power2.out',
    })

    return () => {
      tweenRef.current?.kill()
    }
  }, [value, max])

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {icon && <span>{icon}</span>}
          {label}
        </span>
        <div className="flex items-baseline gap-1">
          <span
            ref={countRef}
            className={cn(
              'font-mono text-lg font-semibold tabular-nums transition-opacity duration-500',
              colorClass,
              !active && 'opacity-30',
            )}
            data-val="0"
          >
            0
          </span>
          <span className="text-xs text-muted-foreground">{unit}</span>
        </div>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          ref={barRef}
          className={cn('h-full rounded-full transition-opacity duration-500', barColor, !active && 'opacity-20')}
          style={{ width: '0%' }}
        />
      </div>
    </div>
  )
}
