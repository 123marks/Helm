import React from 'react'
import { Card, CardContent } from '@renderer/components/ui/card'

/** The KPI tile shared by the dashboard and the quota cockpit. */
export function StatCard({
  label,
  value,
  sub,
  icon,
  tone,
  onClick
}: {
  label: string
  value: React.ReactNode
  sub?: string
  icon: React.ReactNode
  /** Background of the icon chip, e.g. `hsl(var(--primary) / 0.15)`. */
  tone: string
  onClick?: () => void
}): React.JSX.Element {
  const body = (
    <CardContent className="flex h-[74px] items-center gap-3.5 p-4">
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
        style={{ background: tone }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold leading-tight tabular-nums">{value}</div>
        <div className="truncate text-xs text-muted-foreground">{label}</div>
        {sub && <div className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{sub}</div>}
      </div>
    </CardContent>
  )
  if (!onClick) return <Card>{body}</Card>
  return (
    <button type="button" onClick={onClick} className="text-left">
      <Card className="h-full transition-colors hover:border-primary/40">{body}</Card>
    </button>
  )
}
