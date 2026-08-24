import type { PlanKind, Platform } from './types'

/**
 * One subscription tier of one platform.
 * `price` / `note` are public list information and are display-only:
 * we never use them for billing, only to explain what the card is showing.
 */
export interface PlanTier {
  /** Unique within the platform. */
  id: string
  /** Drives badge colour and card frame. */
  kind: PlanKind
  /** Official tier name. */
  label: string
  /** Short uppercase badge text. */
  badge: string
  /** Public list price, omitted when the vendor publishes none. */
  price?: string
  /** One line explaining what the tier buys. */
  note?: string
  /** Matches the raw plan string returned by the platform API. */
  match?: RegExp
}

/**
 * Tiers are matched top to bottom, so the most specific pattern comes first.
 * Prices verified against the vendors' own pricing pages in Aug 2026.
 */
const CATALOG: Partial<Record<Platform, PlanTier[]>> = {
  cursor: [
    {
      id: 'enterprise',
      kind: 'enterprise',
      label: 'Enterprise',
      badge: 'ENTERPRISE',
      price: '定制',
      note: '池化用量 · SCIM · 审计日志',
      match: /enterprise/
    },
    {
      id: 'team_premium',
      kind: 'team',
      label: 'Teams Premium',
      badge: 'TEAM+',
      price: '$120/席/月',
      note: '5× Standard 席位用量',
      match: /premium.*(seat|team)|team.*premium/
    },
    {
      id: 'team',
      kind: 'team',
      label: 'Teams Standard',
      badge: 'TEAM',
      price: '$40/席/月',
      note: '集中计费 · SSO · 用量分析',
      match: /team|business/
    },
    {
      id: 'ultra',
      kind: 'ultra',
      label: 'Ultra',
      badge: 'ULTRA',
      price: '$200/月',
      note: '含 $400 第三方模型额度（约 20× Pro）',
      match: /ultra|heavy/
    },
    {
      id: 'pro_plus',
      kind: 'pro_plus',
      label: 'Pro+',
      badge: 'PRO+',
      price: '$60/月',
      note: '含 $70 第三方模型额度（约 3× Pro）',
      match: /pro[\s_+-]*plus|pro\+/
    },
    {
      id: 'pro',
      kind: 'pro',
      label: 'Pro',
      badge: 'PRO',
      price: '$20/月',
      note: '含 $20 第三方模型额度，Auto 与 Tab 不限量',
      match: /\bpro\b|individual|paid/
    },
    {
      id: 'free',
      kind: 'free',
      label: 'Hobby',
      badge: 'FREE',
      price: '免费',
      note: '有限 Agent 请求，可用 Composer',
      match: /hobby|free|none|unpaid|trial/
    }
  ],
  openai: [
    {
      id: 'enterprise',
      kind: 'enterprise',
      label: 'ChatGPT Enterprise',
      badge: 'ENTERPRISE',
      price: '定制',
      match: /enterprise/
    },
    {
      id: 'business',
      kind: 'team',
      label: 'ChatGPT Business',
      badge: 'BUSINESS',
      price: '$25/席/月',
      note: '年付 $20/席，共享工作区',
      match: /business|team/
    },
    {
      id: 'pro',
      kind: 'pro',
      label: 'ChatGPT Pro',
      badge: 'PRO',
      price: '$200/月',
      note: '最高用量与 o 系列深度推理',
      match: /\bpro\b/
    },
    {
      id: 'plus',
      kind: 'plus',
      label: 'ChatGPT Plus',
      badge: 'PLUS',
      price: '$20/月',
      match: /plus/
    },
    {
      id: 'go',
      kind: 'go',
      label: 'ChatGPT Go',
      badge: 'GO',
      price: '$8/月',
      note: '入门付费档，用量低于 Plus',
      match: /\bgo\b/
    },
    {
      id: 'free',
      kind: 'free',
      label: 'ChatGPT Free',
      badge: 'FREE',
      price: '免费',
      match: /free|none/
    }
  ],
  anthropic: [
    {
      id: 'enterprise',
      kind: 'enterprise',
      label: 'Claude Enterprise',
      badge: 'ENTERPRISE',
      price: '$20/席 + API 用量',
      match: /enterprise/
    },
    {
      id: 'team_premium',
      kind: 'team',
      label: 'Claude Team Premium',
      badge: 'TEAM+',
      price: '$125/席/月',
      note: '5× Standard 席位用量',
      match: /team.*premium|premium.*team/
    },
    {
      id: 'team',
      kind: 'team',
      label: 'Claude Team',
      badge: 'TEAM',
      price: '$25/席/月',
      note: '年付 $20/席，最少 5 席',
      match: /team/
    },
    {
      id: 'max_20x',
      kind: 'max',
      label: 'Claude Max 20×',
      badge: 'MAX 20X',
      price: '$200/月',
      note: '每 5 小时会话额度为 Pro 的 20 倍',
      match: /max.*20|20\s*x/
    },
    {
      id: 'max_5x',
      kind: 'max',
      label: 'Claude Max 5×',
      badge: 'MAX 5X',
      price: '$100/月',
      note: '每 5 小时会话额度为 Pro 的 5 倍',
      match: /max/
    },
    {
      id: 'pro',
      kind: 'pro',
      label: 'Claude Pro',
      badge: 'PRO',
      price: '$20/月',
      note: '年付 $17/月，含 Claude Code',
      match: /\bpro\b/
    },
    {
      id: 'free',
      kind: 'free',
      label: 'Claude Free',
      badge: 'FREE',
      price: '免费',
      note: '每周用量上限较低',
      match: /free|default|none/
    }
  ],
  kiro: [
    {
      id: 'enterprise',
      kind: 'enterprise',
      label: 'Kiro Enterprise',
      badge: 'ENTERPRISE',
      price: '经 AWS 协商',
      match: /enterprise/
    },
    {
      id: 'power',
      kind: 'power',
      label: 'Kiro Power',
      badge: 'POWER',
      price: '$200/月',
      note: '10,000 credits，超出 $0.04/credit',
      match: /power/
    },
    {
      id: 'pro_max',
      kind: 'pro_max',
      label: 'Kiro Pro Max',
      badge: 'PRO MAX',
      price: '$100/月',
      note: '5,000 credits',
      match: /pro\s*max|max/
    },
    {
      id: 'pro_plus',
      kind: 'pro_plus',
      label: 'Kiro Pro+',
      badge: 'PRO+',
      price: '$40/月',
      note: '2,000 credits',
      match: /pro\s*\+|pro\s*plus/
    },
    {
      id: 'pro',
      kind: 'pro',
      label: 'Kiro Pro',
      badge: 'PRO',
      price: '$20/月',
      note: '1,000 credits',
      match: /\bpro\b/
    },
    {
      id: 'free',
      kind: 'free',
      label: 'Kiro Free',
      badge: 'FREE',
      price: '免费',
      note: '50 credits/月',
      match: /free|none/
    }
  ],
  windsurf: [
    {
      id: 'enterprise',
      kind: 'enterprise',
      label: 'Windsurf Enterprise',
      badge: 'ENTERPRISE',
      price: '定制',
      match: /enterprise/
    },
    {
      id: 'team',
      kind: 'team',
      label: 'Windsurf Teams',
      badge: 'TEAM',
      price: '$30/席/月',
      match: /team/
    },
    {
      id: 'pro',
      kind: 'pro',
      label: 'Windsurf Pro',
      badge: 'PRO',
      price: '$15/月',
      note: '每月 500 prompt credits',
      match: /\bpro\b|paid/
    },
    {
      id: 'free',
      kind: 'free',
      label: 'Windsurf Free',
      badge: 'FREE',
      price: '免费',
      match: /free|none/
    }
  ],
  grok: [
    {
      id: 'heavy',
      kind: 'ultra',
      label: 'SuperGrok Heavy',
      badge: 'HEAVY',
      note: '最高档，多智能体并行与最早期新功能',
      match: /heavy/
    },
    {
      id: 'plus',
      kind: 'pro_plus',
      label: 'SuperGrok Plus',
      badge: 'SUPERGROK+',
      price: '$100/月',
      note: '1080p 视频、峰值优先接入',
      match: /plus/
    },
    {
      id: 'supergrok',
      kind: 'pro',
      label: 'SuperGrok',
      badge: 'SUPERGROK',
      price: '$30/月',
      note: '前沿模型与更高速率上限',
      match: /supergrok|\bpro\b|premium/
    },
    {
      id: 'lite',
      kind: 'lite',
      label: 'SuperGrok Lite',
      badge: 'LITE',
      note: '入门付费档',
      match: /lite/
    },
    {
      id: 'free',
      kind: 'free',
      label: 'Grok Free',
      badge: 'FREE',
      price: '免费',
      match: /free|none|basic/
    }
  ],
  // Antigravity itself is free; paid quota rides on a Google AI subscription.
  antigravity: [
    {
      id: 'organization',
      kind: 'enterprise',
      label: 'Organization（Google Cloud）',
      badge: 'ORG',
      price: '按用量计费',
      note: '经 Google Cloud 接入，含 Antigravity 2.0 与 CLI',
      match: /enterprise|organization|cloud|workspace/
    },
    {
      id: 'ultra_20x',
      kind: 'ultra',
      label: 'Google AI Ultra 20×',
      badge: 'ULTRA 20X',
      price: '$199.99/月',
      note: 'Antigravity 额度为 Pro 的 20 倍',
      match: /ultra.*20|20\s*x/
    },
    {
      id: 'ultra_5x',
      kind: 'ultra',
      label: 'Google AI Ultra 5×',
      badge: 'ULTRA 5X',
      price: '$99.99/月',
      note: 'Antigravity 额度为 Pro 的 5 倍',
      match: /ultra|5\s*x/
    },
    {
      id: 'pro',
      kind: 'pro',
      label: 'Google AI Pro',
      badge: 'AI PRO',
      price: '$19.99/月',
      note: '额度每 5 小时刷新，直到周上限',
      match: /\bpro\b|paid|standard/
    },
    {
      id: 'plus',
      kind: 'plus',
      label: 'Google AI Plus',
      badge: 'AI PLUS',
      price: '$4.99/月',
      note: '在免费额度上小幅提升',
      match: /plus/
    },
    {
      id: 'free',
      kind: 'free',
      label: 'Individual',
      badge: 'FREE',
      price: '免费',
      note: '每周刷新额度，Tab 与命令请求不限量',
      match: /free|individual|legacy|none/
    }
  ]
}

export function planTiers(platform: Platform): PlanTier[] {
  return CATALOG[platform] ?? []
}

/** Find the tier a raw platform plan string belongs to. */
export function resolvePlanTier(platform: Platform, plan: string): PlanTier | null {
  const raw = (plan || '').toLowerCase().replace(/[_-]+/g, ' ').trim()
  if (!raw) return null
  for (const tier of planTiers(platform)) {
    if (tier.match?.test(raw)) return tier
  }
  return null
}

export function planTierById(platform: Platform, id: string): PlanTier | null {
  return planTiers(platform).find((t) => t.id === id) ?? null
}

/**
 * Monthly list price in USD, derived from `price` so the figure never drifts
 * from the label. Null for free tiers and anything quoted as "定制".
 */
export function tierMonthlyUsd(tier: PlanTier | null): number | null {
  if (!tier?.price) return null
  if (tier.price.includes('免费')) return 0
  const match = /\$\s*([\d.]+)/.exec(tier.price)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

export function planMonthlyUsd(platform: Platform, plan: string): number | null {
  return tierMonthlyUsd(resolvePlanTier(platform, plan))
}
