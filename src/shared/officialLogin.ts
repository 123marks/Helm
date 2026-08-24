import type { Platform } from './types'

/** Official sign-in page for each platform. Opens in the account's isolated Chrome. */
export const OFFICIAL_LOGIN: Partial<Record<Platform, string>> = {
  google: 'https://accounts.google.com/ServiceLogin',
  github: 'https://github.com/login',
  microsoft: 'https://login.live.com/',
  apple: 'https://account.apple.com/sign-in',
  x: 'https://x.com/i/flow/login',
  youtube: 'https://accounts.google.com/ServiceLogin?service=youtube',
  discord: 'https://discord.com/login',
  openai: 'https://chatgpt.com/auth/login',
  anthropic: 'https://claude.ai/login',
  cursor: 'https://authenticator.cursor.sh/sign-in',
  windsurf: 'https://windsurf.com/account/login',
  kiro: 'https://app.kiro.dev/signin',
  grok: 'https://accounts.x.ai/sign-in',
  antigravity: 'https://antigravity.google'
}

export function officialLoginUrl(platform: Platform): string {
  return OFFICIAL_LOGIN[platform] || 'about:blank'
}
