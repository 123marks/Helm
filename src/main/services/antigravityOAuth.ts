/**
 * Antigravity signs in through Google's installed-app OAuth flow using the
 * client that ships inside the Antigravity desktop binary. Those values are not
 * ours to publish, so they are injected at build time from
 * `HELM_ANTIGRAVITY_CLIENT_ID` / `HELM_ANTIGRAVITY_CLIENT_SECRET` (see
 * `.env.example`) and can also be overridden at run time by the same variables.
 */
const BUILD_CLIENT_ID = typeof __ANTIGRAVITY_CLIENT_ID__ === 'string' ? __ANTIGRAVITY_CLIENT_ID__ : ''
const BUILD_CLIENT_SECRET =
  typeof __ANTIGRAVITY_CLIENT_SECRET__ === 'string' ? __ANTIGRAVITY_CLIENT_SECRET__ : ''

export const AG_REDIRECT = 'http://localhost:51121/oauth-callback'

export const AG_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs'
].join(' ')

export const AG_META = {
  ideType: 'ANTIGRAVITY',
  platform: 'PLATFORM_UNSPECIFIED',
  pluginType: 'GEMINI'
} as const

const MISSING =
  'Antigravity 的 Google OAuth 凭据未配置。请在项目根目录建 .env 填 HELM_ANTIGRAVITY_CLIENT_ID / HELM_ANTIGRAVITY_CLIENT_SECRET 后重新构建，或改用「Token / JSON」粘贴 refresh_token / oauth_creds.json'

export function antigravityOAuthConfigured(): boolean {
  return !!(clientId() && clientSecret())
}

function clientId(): string {
  return process.env.HELM_ANTIGRAVITY_CLIENT_ID || BUILD_CLIENT_ID
}

function clientSecret(): string {
  return process.env.HELM_ANTIGRAVITY_CLIENT_SECRET || BUILD_CLIENT_SECRET
}

/** Throws with actionable guidance when the credentials were never supplied. */
export function antigravityClient(): { id: string; secret: string } {
  const id = clientId()
  const secret = clientSecret()
  if (!id || !secret) throw new Error(MISSING)
  return { id, secret }
}
