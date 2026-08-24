import type { Flow } from '../types'
import type { AutomationActionDescriptor, Platform, TaskType } from '@shared/types'
import { googleFlows } from './google'
import { githubFlows } from './github'
import { xFlows } from './x'
import { youtubeFlows } from './youtube'
import { registerFlows } from './register'
import { oauthRegisterFlows, oauthRegisterablePlatforms } from './oauthRegister'
import { sessionCheckFlows } from './sessionCheck'

const ALL: Flow[] = [
  ...googleFlows,
  ...githubFlows,
  ...xFlows,
  ...youtubeFlows,
  ...registerFlows,
  ...oauthRegisterFlows,
  ...sessionCheckFlows
]

const byKey = new Map<string, Flow>()
for (const f of ALL) byKey.set(`${f.platform}:${f.action}`, f)

function toDescriptor(f: Flow): AutomationActionDescriptor {
  return {
    platform: f.platform,
    action: f.action,
    title: f.title,
    description: f.description,
    params: f.params
  }
}

export function getFlow(platform: Platform, action: TaskType): Flow | undefined {
  return byKey.get(`${platform}:${action}`)
}

export function actionsFor(platform: Platform): AutomationActionDescriptor[] {
  // `register` is driven from the dedicated "批量注册" entry, not the per-account
  // action picker (registration creates accounts rather than acting on one).
  return ALL.filter((f) => f.platform === platform && !String(f.action).startsWith('register')).map(
    toDescriptor
  )
}

const PLATFORM_ORDER: Platform[] = [
  'google',
  'github',
  'microsoft',
  'apple',
  'x',
  'youtube',
  'discord',
  'openai',
  'anthropic',
  'cursor',
  'windsurf',
  'kiro',
  'grok',
  'antigravity',
  'custom'
]

export function registerablePlatforms(): Platform[] {
  const set = new Set(ALL.filter((f) => f.action === 'register').map((f) => f.platform))
  return PLATFORM_ORDER.filter((p) => set.has(p))
}

export { oauthRegisterablePlatforms }
