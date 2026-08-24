import type { Platform } from './types'

export function hasQuota(platform: Platform): boolean {
  return (
    platform === 'cursor' ||
    platform === 'openai' ||
    platform === 'anthropic' ||
    platform === 'windsurf' ||
    platform === 'kiro' ||
    platform === 'grok' ||
    platform === 'antigravity'
  )
}

/** Desktop PKCE / localhost-callback OAuth (Cursor / Codex / Kiro / Windsurf). */
export function hasPkceOAuth(platform: Platform): boolean {
  return (
    platform === 'cursor' ||
    platform === 'openai' ||
    platform === 'kiro' ||
    platform === 'windsurf' ||
    platform === 'antigravity'
  )
}

/** Official sign-in page, usually Google / GitHub / Apple / Microsoft SSO. */
export function hasOfficialAuth(platform: Platform): boolean {
  return platform !== 'custom'
}

/** Can push this account into a local IDE / CLI login slot. */
export function hasLocalApply(platform: Platform): boolean {
  return (
    platform === 'cursor' ||
    platform === 'kiro' ||
    platform === 'windsurf' ||
    platform === 'openai' ||
    platform === 'anthropic' ||
    platform === 'grok' ||
    platform === 'antigravity'
  )
}

export function localApplyLabel(platform: Platform): string {
  if (platform === 'cursor') return 'Cursor IDE / CLI'
  if (platform === 'kiro') return 'Kiro IDE'
  if (platform === 'windsurf') return 'Windsurf IDE'
  if (platform === 'openai') return 'Codex CLI'
  if (platform === 'anthropic') return 'Claude Code CLI'
  if (platform === 'grok') return 'Grok CLI'
  if (platform === 'antigravity') return 'Antigravity IDE'
  return '本地客户端'
}
