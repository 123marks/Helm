import React from 'react'

export interface DonutSegment {
  label: string
  value: number
  color: string
}

/** Lightweight multi-segment donut (no chart lib). */
export function Donut({
  segments,
  size = 148,
  thickness = 16,
  centerLabel,
  centerSub
}: {
  segments: DonutSegment[]
  size?: number
  thickness?: number
  centerLabel?: React.ReactNode
  centerSub?: React.ReactNode
}): React.JSX.Element {
  const total = segments.reduce((s, x) => s + x.value, 0)
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  let acc = 0

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={thickness} />
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s, i) => {
              const frac = s.value / total
              const len = c * frac
              const el = (
                <circle
                  key={i}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={thickness}
                  strokeDasharray={`${len} ${c - len}`}
                  strokeDashoffset={-acc}
                />
              )
              acc += len
              return el
            })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {centerLabel !== undefined && <span className="text-2xl font-bold tabular-nums">{centerLabel}</span>}
        {centerSub !== undefined && <span className="text-[11px] text-muted-foreground">{centerSub}</span>}
      </div>
    </div>
  )
}

export function DonutLegend({ segments }: { segments: DonutSegment[] }): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      {segments.map((s) => (
        <div key={s.label} className="flex items-center gap-2 text-sm">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
          <span className="flex-1 text-muted-foreground">{s.label}</span>
          <span className="tabular-nums font-medium">{s.value}</span>
        </div>
      ))}
    </div>
  )
}

export interface TrendSeries {
  key: string
  label: string
  color: string
  /** Null values leave a gap instead of dropping the line to zero. */
  points: (number | null)[]
}

/**
 * Multi-series area chart over a shared 0–max scale. Purposely dependency-free:
 * an SVG path per series plus a gradient fill for the highlighted one.
 */
export function TrendChart({
  labels,
  series,
  height = 200,
  max = 100,
  unit = '%',
  emptyHint = '暂无数据'
}: {
  labels: string[]
  series: TrendSeries[]
  height?: number
  max?: number
  unit?: string
  emptyHint?: string
}): React.JSX.Element {
  const [hover, setHover] = React.useState<number | null>(null)
  const n = labels.length
  const hasData = series.some((s) => s.points.some((p) => p != null))
  if (n === 0 || !hasData) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground"
        style={{ height }}
      >
        {emptyHint}
      </div>
    )
  }

  const w = 1000
  const h = 260
  const padL = 34
  const padR = 8
  const padT = 10
  const padB = 22
  const plotW = w - padL - padR
  const plotH = h - padT - padB
  const x = (i: number): number => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = (v: number): number => padT + plotH - (Math.min(max, Math.max(0, v)) / max) * plotH

  const linePath = (points: (number | null)[]): string => {
    let d = ''
    let open = false
    points.forEach((p, i) => {
      if (p == null) {
        open = false
        return
      }
      d += `${open ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p).toFixed(1)} `
      open = true
    })
    return d.trim()
  }

  const areaPath = (points: (number | null)[]): string => {
    const first = points.findIndex((p) => p != null)
    if (first < 0) return ''
    let last = first
    points.forEach((p, i) => {
      if (p != null) last = i
    })
    return `${linePath(points)} L${x(last).toFixed(1)} ${y(0)} L${x(first).toFixed(1)} ${y(0)} Z`
  }

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
  const tickEvery = Math.max(1, Math.ceil(n / 7))

  return (
    <div className="relative" style={{ height }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="h-full w-full overflow-visible"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`trend-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.32" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {gridLines.map((g) => (
          <g key={g}>
            <line
              x1={padL}
              x2={w - padR}
              y1={padT + plotH * (1 - g)}
              y2={padT + plotH * (1 - g)}
              stroke="hsl(var(--border))"
              strokeWidth="1"
              strokeDasharray={g === 0 ? undefined : '4 6'}
            />
            <text
              x={padL - 6}
              y={padT + plotH * (1 - g) + 4}
              textAnchor="end"
              fontSize="11"
              fill="hsl(var(--muted-foreground))"
            >
              {Math.round(max * g)}
            </text>
          </g>
        ))}

        {series.map((s) => (
          <g key={s.key}>
            <path d={areaPath(s.points)} fill={`url(#trend-${s.key})`} />
            <path
              d={linePath(s.points)}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}

        {labels.map((label, i) =>
          i % tickEvery === 0 ? (
            <text
              key={i}
              x={x(i)}
              y={h - 6}
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
              fontSize="11"
              fill="hsl(var(--muted-foreground))"
            >
              {label}
            </text>
          ) : null
        )}

        {hover != null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={padT}
            y2={padT + plotH}
            stroke="hsl(var(--primary))"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}
        {hover != null &&
          series.map((s) => {
            const v = s.points[hover]
            return v == null ? null : (
              <circle key={s.key} cx={x(hover)} cy={y(v)} r="3.5" fill={s.color} stroke="hsl(var(--card))" strokeWidth="1.5" />
            )
          })}

        {labels.map((_, i) => (
          <rect
            key={i}
            x={x(i) - plotW / (2 * Math.max(1, n - 1))}
            y={padT}
            width={plotW / Math.max(1, n - 1)}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      {hover != null && (
        <div className="pointer-events-none absolute right-2 top-1 rounded-md border bg-card/95 px-2 py-1.5 text-[11px] shadow-lg">
          <div className="mb-0.5 text-muted-foreground">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="ml-auto tabular-nums">
                {s.points[hover] == null ? '—' : `${Math.round(s.points[hover] as number)}${unit}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export interface BarPoint {
  label: string
  value: number
}

/** Simple activity bar chart scaled to the max value. */
export function MiniBars({
  data,
  height = 120,
  color = 'hsl(var(--primary))'
}: {
  data: BarPoint[]
  height?: number
  color?: string
}): React.JSX.Element {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.label}: ${d.value}`}>
          <div
            className="w-full rounded-t transition-all"
            style={{
              height: `${(d.value / max) * 100}%`,
              minHeight: d.value > 0 ? 4 : 0,
              backgroundColor: color,
              opacity: d.value > 0 ? 1 : 0.15
            }}
          />
        </div>
      ))}
    </div>
  )
}
