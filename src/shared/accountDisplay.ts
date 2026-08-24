import { accountIdentityTitle } from './identity'

export function accountTitle(a: { label: string; email: string; username: string; platform?: string }): string {
  return accountIdentityTitle(a)
}

/** Milder mask: keep up to 4 local chars so temp-mail accounts stay recognizable. */
export function maskEmail(email: string, revealed: boolean): string {
  if (revealed || !email.includes('@')) return email
  const [local, domain] = email.split('@')
  if (!local || !domain) return email
  const keep = Math.min(4, local.length)
  return `${local.slice(0, keep)}****@${domain}`
}

export function emailDomain(email: string): string {
  const domain = email.split('@')[1]
  return domain ? `@${domain}` : ''
}

export function accountSubtitle(
  a: { email: string; username: string },
  revealed: boolean
): string {
  if (a.email.includes('@')) return maskEmail(a.email, revealed)
  return a.username || a.email || '—'
}
