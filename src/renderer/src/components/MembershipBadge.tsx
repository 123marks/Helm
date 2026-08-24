import React from 'react'
import type { AccountQuota, PlanKind, Platform } from '@shared/types'
import { planBadgeFor, planDisplayName, planKindOf, planNote } from '@shared/membership'

const TONE: Record<PlanKind, string> = {
  free: 'border-white/10 bg-zinc-800/80 text-zinc-300 font-semibold tracking-[0.14em]',
  lite: 'border-teal-400/40 bg-gradient-to-r from-teal-500/25 via-emerald-400/15 to-teal-500/25 text-teal-100 font-bold tracking-[0.14em]',
  go: 'border-teal-300/45 bg-gradient-to-r from-teal-400/30 via-cyan-300/20 to-teal-400/30 text-teal-50 font-bold tracking-[0.16em]',
  plus: 'border-sky-400/40 bg-gradient-to-r from-sky-500/30 via-cyan-400/20 to-sky-500/30 text-sky-100 shadow-[0_0_12px_rgba(56,189,248,0.28)] font-bold tracking-[0.16em]',
  pro: 'border-amber-400/50 bg-gradient-to-r from-amber-500/35 via-yellow-300/25 to-amber-600/35 text-amber-50 shadow-[0_0_14px_rgba(251,191,36,0.35)] font-bold tracking-[0.16em]',
  pro_plus:
    'border-yellow-300/60 bg-gradient-to-r from-yellow-400/40 via-amber-200/30 to-orange-400/35 text-yellow-50 shadow-[0_0_16px_rgba(250,204,21,0.4)] font-bold tracking-[0.16em]',
  pro_max:
    'border-orange-300/60 bg-gradient-to-r from-orange-500/40 via-amber-300/25 to-orange-600/35 text-orange-50 shadow-[0_0_16px_rgba(249,115,22,0.38)] font-bold tracking-[0.14em]',
  max: 'border-rose-300/50 bg-gradient-to-r from-rose-500/40 via-amber-300/25 to-fuchsia-500/30 text-rose-50 shadow-[0_0_16px_rgba(251,113,133,0.4)] font-bold tracking-[0.14em]',
  ultra:
    'border-violet-300/50 bg-gradient-to-r from-violet-500/40 via-fuchsia-400/25 to-amber-300/30 text-violet-50 shadow-[0_0_16px_rgba(167,139,250,0.4)] font-bold tracking-[0.14em]',
  power:
    'border-fuchsia-300/55 bg-gradient-to-r from-fuchsia-600/45 via-purple-400/25 to-rose-500/35 text-fuchsia-50 shadow-[0_0_18px_rgba(217,70,239,0.42)] font-bold tracking-[0.14em]',
  team: 'border-indigo-300/50 bg-gradient-to-r from-indigo-500/35 via-blue-400/25 to-indigo-600/35 text-indigo-50 shadow-[0_0_12px_rgba(129,140,248,0.35)] font-bold tracking-[0.14em]',
  enterprise:
    'border-slate-200/40 bg-gradient-to-r from-slate-100/20 via-zinc-300/15 to-slate-400/25 text-slate-100 shadow-[0_0_12px_rgba(226,232,240,0.25)] font-bold tracking-[0.14em]',
  unknown: 'border-primary/30 bg-primary/15 text-primary font-semibold tracking-[0.12em]'
}

export function MembershipBadge({
  platform,
  quota
}: {
  platform: Platform
  quota?: AccountQuota | null
}): React.JSX.Element | null {
  if (!quota?.plan && !quota?.planKind) return null
  const plan = quota.plan || ''
  const kind = planKindOf(platform, plan, quota.planKind)
  const note = planNote(platform, plan)
  return (
    <span
      title={[planDisplayName(platform, plan, kind), note].filter(Boolean).join(' · ')}
      className={`inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full border px-1.5 text-[9px] ${TONE[kind] || TONE.unknown}`}
    >
      {planBadgeFor(platform, plan, kind)}
    </span>
  )
}
