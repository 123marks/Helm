import type { Platform } from '@shared/types'
import { hasLocalApply, hasOfficialAuth, hasPkceOAuth, hasQuota, localApplyLabel } from '@shared/platformFlags'

export interface PlatformMeta {
  key: Platform
  label: string
  color: string
  letter: string
}

export const PLATFORMS: PlatformMeta[] = [
  { key: 'google', label: 'Google', color: '#ea4335', letter: 'G' },
  { key: 'github', label: 'GitHub', color: '#24292f', letter: 'GH' },
  { key: 'microsoft', label: 'Microsoft', color: '#0067b8', letter: 'MS' },
  { key: 'apple', label: 'Apple', color: '#111111', letter: '' },
  { key: 'x', label: 'X (Twitter)', color: '#000000', letter: 'X' },
  { key: 'youtube', label: 'YouTube', color: '#ff0000', letter: '▶' },
  { key: 'discord', label: 'Discord', color: '#5865f2', letter: 'D' },
  { key: 'openai', label: 'OpenAI', color: '#000000', letter: 'AI' },
  { key: 'anthropic', label: 'Anthropic', color: '#191919', letter: 'A' },
  { key: 'cursor', label: 'Cursor', color: '#141414', letter: 'C' },
  { key: 'windsurf', label: 'Windsurf', color: '#0B100F', letter: 'W' },
  { key: 'kiro', label: 'Kiro', color: '#9046FF', letter: 'K' },
  { key: 'grok', label: 'Grok', color: '#111111', letter: 'G' },
  { key: 'antigravity', label: 'Antigravity', color: '#000000', letter: 'A' },
  { key: 'custom', label: '自定义', color: '#8b5cf6', letter: '★' }
]

export function platformMeta(p: Platform): PlatformMeta {
  return PLATFORMS.find((x) => x.key === p) ?? PLATFORMS[PLATFORMS.length - 1]
}

export { hasLocalApply, hasOfficialAuth, hasPkceOAuth, hasQuota, localApplyLabel }
